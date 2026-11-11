const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../src/config/env');
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
const pool = require('../src/db/pool');
const createApp = require('../src/app');
const suffix = crypto.randomUUID();
const userIds = [];
const fixtures = {};
const server = createApp().listen(0);
const baseUrl = new Promise((resolve) => server.once('listening', () => resolve('http://127.0.0.1:' + server.address().port)));
const roleList = ['ACCOUNT_HOLDER', 'ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'];

async function setupUsers() {
  const hash = await bcrypt.hash('ledger-test-password', 4);
  for (let i = 0; i < roleList.length; i += 1) {
    const email = 'ledger-test-' + i + '-' + suffix + '@example.test';
    const result = await pool.query(
      'INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id',
      ['Ledger Test ' + i, email, hash, roleList[i]]
    );
    const id = result.rows[0].id;
    userIds.push(id);
    const key = roleList[i] === 'ACCOUNT_HOLDER' ? roleList[i] + i : roleList[i];
    fixtures[key] = {
      id,
      token: jwt.sign({ role: roleList[i] }, process.env.JWT_SECRET, {
        subject: String(id), expiresIn: '10m', algorithm: 'HS256'
      })
    };
  }
}
async function request(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.key) headers['Idempotency-Key'] = options.key;
  return fetch((await baseUrl) + path, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}
async function createAccount(token) {
  const response = await request('/api/accounts', { method: 'POST', token, body: {} });
  assert.equal(response.status, 201);
  return (await response.json()).account;
}
function transactionPath(account, type) { return '/api/accounts/' + account.id + '/' + type; }
function deposit(account, token, amount, key) {
  return request(transactionPath(account, 'deposits'), { method: 'POST', token, key, body: { amount_paise: amount } });
}
function withdraw(account, token, amount, key) {
  return request(transactionPath(account, 'withdrawals'), { method: 'POST', token, key, body: { amount_paise: amount } });
}
async function getBalance(id) {
  const result = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [id]);
  return result.rows[0].balance_paise;
}
async function ledgerTotals(id) {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'DEBIT'), 0)::text AS debits, COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'CREDIT'), 0)::text AS credits FROM ledger_entries WHERE transaction_id = $1",
    [id]
  );
  return result.rows[0];
}
test.before(async () => { await setupUsers(); });

test('deposit creates balanced entries and updates the cached balance', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const response = await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 12500, 'deposit-' + suffix);
  assert.equal(response.status, 201);
  const { transaction } = await response.json();
  assert.equal(transaction.type, 'DEPOSIT');
  assert.equal(transaction.amountPaise, '12500');
  assert.equal(transaction.balanceAfterPaise, '12500');
  assert.equal(await getBalance(account.id), '12500');
  assert.deepEqual(await ledgerTotals(transaction.id), { count: 2, debits: '12500', credits: '12500' });
});

test('withdrawal posts balanced entries and reduces integer-paise balance', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 10000, 'seed-' + suffix);
  const response = await withdraw(account, fixtures.ACCOUNT_HOLDER0.token, 3750, 'withdraw-' + suffix);
  assert.equal(response.status, 201);
  const { transaction } = await response.json();
  assert.equal(transaction.type, 'WITHDRAWAL');
  assert.equal(transaction.balanceAfterPaise, '6250');
  assert.equal(await getBalance(account.id), '6250');
  assert.deepEqual(await ledgerTotals(transaction.id), { count: 2, debits: '3750', credits: '3750' });
});

test('insufficient funds leave balance and transaction history unchanged', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 100, 'fund-' + suffix);
  const key = 'insufficient-' + suffix;
  assert.equal((await withdraw(account, fixtures.ACCOUNT_HOLDER0.token, 101, key)).status, 409);
  assert.equal(await getBalance(account.id), '100');
  const found = await pool.query('SELECT 1 FROM transactions WHERE initiated_by = $1 AND idempotency_key = $2', [fixtures.ACCOUNT_HOLDER0.id, key]);
  assert.equal(found.rowCount, 0);
});

test('zero, negative, excessive, and fractional amounts are rejected', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  for (const amount of [0, -1, 100_000_001, 1.5]) {
    assert.equal((await deposit(account, fixtures.ACCOUNT_HOLDER0.token, amount, 'invalid-' + amount + '-' + suffix)).status, 400);
  }
  assert.equal(await getBalance(account.id), '0');
});

test('idempotency key is required', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const response = await request(transactionPath(account, 'deposits'), {
    method: 'POST', token: fixtures.ACCOUNT_HOLDER0.token, body: { amount_paise: 100 }
  });
  assert.equal(response.status, 400);
  assert.equal(await getBalance(account.id), '0');
});

test('transactions require an account-holder token and account ownership', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  assert.equal((await deposit(account, null, 10, 'missing-' + suffix)).status, 401);
  assert.equal((await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 10, 'foreign-' + suffix)).status, 404);
  assert.equal((await deposit(account, fixtures.ADMIN.token, 10, 'admin-' + suffix)).status, 403);
});

test('frozen and closed accounts reject deposits and withdrawals', async () => {
  const frozen = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(frozen, fixtures.ACCOUNT_HOLDER0.token, 500, 'frozen-fund-' + suffix);
  await request('/api/accounts/' + frozen.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'FROZEN' } });
  assert.equal((await deposit(frozen, fixtures.ACCOUNT_HOLDER0.token, 10, 'frozen-dep-' + suffix)).status, 409);
  assert.equal((await withdraw(frozen, fixtures.ACCOUNT_HOLDER0.token, 10, 'frozen-wd-' + suffix)).status, 409);
  const closed = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await request('/api/accounts/' + closed.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'CLOSED' } });
  assert.equal((await deposit(closed, fixtures.ACCOUNT_HOLDER0.token, 10, 'closed-dep-' + suffix)).status, 409);
  assert.equal((await withdraw(closed, fixtures.ACCOUNT_HOLDER0.token, 10, 'closed-wd-' + suffix)).status, 409);
});

test('ledger customer projection equals credits less debits', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 900, 'projection-dep-' + suffix);
  await withdraw(account, fixtures.ACCOUNT_HOLDER0.token, 275, 'projection-wd-' + suffix);
  const result = await pool.query(
    "SELECT COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'CREDIT'), 0) - COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'DEBIT'), 0) AS net FROM ledger_entries WHERE account_id = $1",
    [account.id]
  );
  assert.equal(String(result.rows[0].net), await getBalance(account.id));
  await assert.rejects(pool.query('UPDATE accounts SET balance_paise = $1 WHERE id = $2', [1, account.id]), (error) => error.code === '23514');
  assert.equal(await getBalance(account.id), '625');
});

test('concurrent same-key requests replay once and do not double-post', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const key = 'same-key-' + suffix;
  const responses = await Promise.all([
    deposit(account, fixtures.ACCOUNT_HOLDER0.token, 250, key),
    deposit(account, fixtures.ACCOUNT_HOLDER0.token, 250, key)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results[0].transaction.id, results[1].transaction.id);
  assert.equal(await getBalance(account.id), '250');
  const rows = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE initiated_by = $1 AND idempotency_key = $2', [fixtures.ACCOUNT_HOLDER0.id, key]);
  assert.equal(rows.rows[0].count, 1);
});

test('same idempotency key with a different payload returns conflict', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const key = 'different-' + suffix;
  assert.equal((await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 250, key)).status, 201);
  assert.equal((await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 251, key)).status, 409);
  assert.equal(await getBalance(account.id), '250');
});

test('concurrent withdrawals cannot spend the same available balance twice', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 1000, 'concurrent-fund-' + suffix);
  const responses = await Promise.all([
    withdraw(account, fixtures.ACCOUNT_HOLDER0.token, 700, 'concurrent-a-' + suffix),
    withdraw(account, fixtures.ACCOUNT_HOLDER0.token, 700, 'concurrent-b-' + suffix)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await getBalance(account.id), '300');
});

test('database failure after projection update rolls back projection, transaction, and entries', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const key = 'rollback-' + suffix;
  const fn = "CREATE OR REPLACE FUNCTION ledger_test_reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entry_side = 'CREDIT' AND EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND idempotency_key LIKE 'rollback-%') THEN RAISE EXCEPTION 'synthetic test failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$";
  await pool.query(fn);
  await pool.query('DROP TRIGGER IF EXISTS ledger_test_reject_credit_trigger ON ledger_entries');
  await pool.query('CREATE TRIGGER ledger_test_reject_credit_trigger BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_test_reject_credit()');
  try {
    const failedResponse = await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 500, key);
    assert.equal(failedResponse.status, 500);
    assert.deepEqual(await failedResponse.json(), { error: 'Internal server error' });
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS ledger_test_reject_credit_trigger ON ledger_entries');
    await pool.query('DROP FUNCTION IF EXISTS ledger_test_reject_credit()');
  }
  assert.equal(await getBalance(account.id), '0');
  const transaction = await pool.query('SELECT 1 FROM transactions WHERE initiated_by = $1 AND idempotency_key = $2', [fixtures.ACCOUNT_HOLDER0.id, key]);
  assert.equal(transaction.rowCount, 0);
  const entries = await pool.query('SELECT COUNT(*)::int AS count FROM ledger_entries WHERE account_id = $1', [account.id]);
  assert.equal(entries.rows[0].count, 0);
});

test('history is paginated newest-first and owner-scoped', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const foreign = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 10, 'history-a-' + suffix);
  await deposit(account, fixtures.ACCOUNT_HOLDER0.token, 20, 'history-b-' + suffix);
  await deposit(foreign, fixtures.ACCOUNT_HOLDER1.token, 30, 'history-c-' + suffix);
  const one = await request('/api/accounts/' + account.id + '/transactions?page=1&limit=1', { token: fixtures.ACCOUNT_HOLDER0.token });
  const two = await request('/api/accounts/' + account.id + '/transactions?page=2&limit=1', { token: fixtures.ACCOUNT_HOLDER0.token });
  assert.equal(one.status, 200);
  const pageOne = await one.json();
  const pageTwo = await two.json();
  assert.equal(pageOne.pagination.total, '2');
  assert.equal(pageOne.transactions.length, 1);
  assert.equal(pageTwo.transactions.length, 1);
  assert.notEqual(pageOne.transactions[0].id, pageTwo.transactions[0].id);
  assert.equal((await request('/api/accounts/' + foreign.id + '/transactions', { token: fixtures.ACCOUNT_HOLDER0.token })).status, 404);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (userIds.length) {
    await pool.query('DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM transactions WHERE initiated_by = ANY($1::bigint[]))', [userIds]);
    await pool.query('DELETE FROM transactions WHERE initiated_by = ANY($1::bigint[])', [userIds]);
    await pool.query('DELETE FROM accounts WHERE owner_user_id = ANY($1::bigint[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
  }
  await pool.end();
});




