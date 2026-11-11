const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
const pool = require('../src/db/pool');
const createApp = require('../src/app');
const { reconcileLedger } = require('../src/services/reconciliation');
const { executeTransaction } = require('../src/services/transactions');
const server = createApp().listen(0);
const baseUrl = new Promise((resolve) => server.once('listening', () => resolve('http://127.0.0.1:' + server.address().port)));
const suffix = crypto.randomUUID();
const emails = [];
async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body) headers['content-type'] = 'application/json';
  return fetch((await baseUrl) + path, { method, headers, body: body && JSON.stringify(body) });
}
async function tokenFor(role, label) {
  const email = `audit-${label}-${suffix}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash('private-test-password-123', 4);
  const result = await pool.query('INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id', ['Audit Test', email, passwordHash, role]);
  return jwt.sign({ role }, process.env.JWT_SECRET, { subject: String(result.rows[0].id), expiresIn: '10m', algorithm: 'HS256' });
}

test('admin and auditor can read paginated filtered audit events; holder is denied', async () => {
  const admin = await tokenFor('ADMIN', 'admin');
  const auditor = await tokenFor('AUDITOR', 'auditor');
  const holder = await tokenFor('ACCOUNT_HOLDER', 'holder');
  const loginEmail = `failed-login-${suffix}@example.test`;
  const failed = await request('/api/auth/login', { method: 'POST', body: { email: loginEmail, password: 'not-a-real-password' } });
  assert.equal(failed.status, 401);
  const adminResponse = await request('/api/admin/audit-logs?action=LOGIN_FAILED&page=1&limit=10', { token: admin });
  assert.equal(adminResponse.status, 200);
  const payload = await adminResponse.json();
  assert.ok(payload.auditLogs.some((row) => row.action === 'LOGIN_FAILED'));
  assert.equal((await request('/api/admin/audit-logs?action=LOGIN_FAILED', { token: auditor })).status, 200);
  assert.equal((await request('/api/admin/audit-logs', { token: holder })).status, 403);
  assert.equal((await request('/api/admin/audit-logs')).status, 401);
  const adminReconciliation = await request('/api/admin/reconciliation', { token: admin });
  assert.equal(adminReconciliation.status, 200);
  assert.ok(Array.isArray((await adminReconciliation.json()).discrepancies));
  assert.equal((await request('/api/admin/reconciliation', { token: auditor })).status, 200);
  assert.equal((await request('/api/admin/reconciliation', { token: holder })).status, 403);
});

test('registration/login and sensitive values are audited without passwords or credentials', async () => {
  const email = `safe-audit-${suffix}@example.test`;
  const password = 'sensitive-test-password-777';
  const register = await request('/api/auth/register', { method: 'POST', body: { fullName: 'Safe Audit', email, password } });
  assert.equal(register.status, 201);
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  const logs = await pool.query('SELECT action, metadata::text AS metadata FROM audit_logs WHERE actor_user_id = (SELECT id FROM users WHERE email = $1)', [email]);
  assert.ok(logs.rows.some((r) => r.action === 'USER_REGISTERED'));
  assert.ok(logs.rows.some((r) => r.action === 'LOGIN_SUCCEEDED'));
  const serialized = JSON.stringify(logs.rows);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(process.env.JWT_SECRET), false);
});

test('audit rows reject application-role UPDATE and DELETE', async () => {
  const actor = await tokenFor('ADMIN', 'immutable');
  const list = await request('/api/admin/audit-logs?limit=1', { token: actor });
  const log = (await list.json()).auditLogs[0];
  assert.ok(log);
  await assert.rejects(pool.query("UPDATE audit_logs SET action = 'ALTERED' WHERE id = $1", [log.id]), (error) => ['55000', '42501'].includes(error.code));
  await assert.rejects(pool.query('DELETE FROM audit_logs WHERE id = $1', [log.id]), (error) => ['55000', '42501'].includes(error.code));
});

test('reconciliation detects account projection and ledger entry discrepancies without changing them', async () => {
  const actor = await tokenFor('ACCOUNT_HOLDER', 'reconcile');
  const accountId = (await pool.query('INSERT INTO accounts (account_number,owner_user_id) SELECT $1,id FROM users WHERE email LIKE $2 RETURNING id', ['LL' + crypto.randomInt(10_000_000_000_000, 100_000_000_000_000), `audit-reconcile-${suffix}@example.test`])).rows[0]?.id;
  assert.ok(accountId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE accounts DISABLE TRIGGER USER');
    await client.query('UPDATE accounts SET balance_paise = 7 WHERE id = $1', [accountId]);
    const report = await reconcileLedger(client);
    assert.ok(report.discrepancies.some((d) => d.type === 'ACCOUNT_PROJECTION_MISMATCH' && d.accountId === accountId));
    const unchanged = await client.query('SELECT balance_paise FROM accounts WHERE id = $1', [accountId]);
    assert.equal(unchanged.rows[0].balance_paise, '7');
    await client.query('ROLLBACK');
  } finally { client.release(); }
  void actor;
});

test('financial audit failure rolls back the deposit and ledger changes', async () => {
  const email = `audit-atomic-${suffix}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash('private-test-password-123', 4);
  const user = (await pool.query("INSERT INTO users (full_name,email,password_hash,role) VALUES ('Audit Atomic',$1,$2,'ACCOUNT_HOLDER') RETURNING id", [email, passwordHash])).rows[0];
  const account = (await pool.query('INSERT INTO accounts (account_number,owner_user_id) VALUES ($1,$2) RETURNING id', ['LL' + crypto.randomInt(10_000_000_000_000, 100_000_000_000_000), user.id])).rows[0];
  const requestId = crypto.randomUUID();
  const fn = `CREATE OR REPLACE FUNCTION audit_test_reject_financial_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DEPOSIT_COMPLETED' AND NEW.request_id = '${requestId}'::uuid THEN RAISE EXCEPTION 'audit test failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`;
  await pool.query(fn);
  await pool.query('DROP TRIGGER IF EXISTS audit_test_reject_financial_event_trigger ON audit_logs');
  await pool.query('CREATE TRIGGER audit_test_reject_financial_event_trigger BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_test_reject_financial_event()');
  try {
    await assert.rejects(executeTransaction({ pool, accountId: account.id, userId: user.id, type: 'DEPOSIT', amountPaise: 1000, idempotencyKey: `audit-${suffix}-rollback`, requestId }));
    const state = await pool.query('SELECT a.balance_paise, COUNT(t.id)::int AS transactions FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.initiated_by = $2 WHERE a.id = $1 GROUP BY a.id', [account.id, user.id]);
    assert.equal(state.rows[0].balance_paise, '0');
    assert.equal(state.rows[0].transactions, 0);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS audit_test_reject_financial_event_trigger ON audit_logs');
    await pool.query('DROP FUNCTION IF EXISTS audit_test_reject_financial_event()');
  }
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (emails.length) {
    await pool.query('DELETE FROM accounts WHERE owner_user_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))', [emails]);
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [emails]);
  }
  await pool.end();
});
