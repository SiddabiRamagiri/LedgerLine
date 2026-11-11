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
const roles = ['ACCOUNT_HOLDER', 'ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'];

async function setupUsers() {
  const hash = await bcrypt.hash('transfer-test-password', 4);
  for (let i = 0; i < roles.length; i += 1) {
    const email = 'transfer-test-' + i + '-' + suffix + '@example.test';
    const result = await pool.query(
      'INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id',
      ['Transfer Test ' + i, email, hash, roles[i]]
    );
    const id = result.rows[0].id;
    userIds.push(id);
    const key = roles[i] === 'ACCOUNT_HOLDER' ? roles[i] + i : roles[i];
    fixtures[key] = {
      id,
      token: jwt.sign({ role: roles[i] }, process.env.JWT_SECRET, {
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
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}
async function createAccount(token) {
  const response = await request('/api/accounts', { method: 'POST', token, body: {} });
  assert.equal(response.status, 201);
  return (await response.json()).account;
}
async function getBalance(id) {
  const result = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [id]);
  return result.rows[0].balance_paise;
}
async function getTotal(ids) {
  const result = await pool.query('SELECT COALESCE(SUM(balance_paise),0)::text AS total FROM accounts WHERE id = ANY($1::uuid[])', [ids]);
  return result.rows[0].total;
}
function transfer(source, destination, token, amount, key) {
  return request('/api/accounts/' + source.id + '/transfers', {
    method: 'POST', token, key,
    body: { destination_account_id: destination.id, amount_paise: amount }
  });
}
function deposit(account, token, amount, key) {
  return request('/api/accounts/' + account.id + '/deposits', {
    method: 'POST', token, key, body: { amount_paise: amount }
  });
}
async function assertBalancedTransfer(transactionId, sourceId, destinationId, amount) {
  const result = await pool.query(
    'SELECT account_id, system_ledger_account_id, entry_side, amount_paise FROM ledger_entries WHERE transaction_id = $1 ORDER BY entry_side',
    [transactionId]
  );
  assert.equal(result.rows.length, 2);
  const debit = result.rows.find((row) => row.entry_side === 'DEBIT');
  const credit = result.rows.find((row) => row.entry_side === 'CREDIT');
  assert.equal(debit.account_id, sourceId);
  assert.equal(credit.account_id, destinationId);
  assert.equal(debit.system_ledger_account_id, null);
  assert.equal(credit.system_ledger_account_id, null);
  assert.equal(debit.amount_paise, String(amount));
  assert.equal(credit.amount_paise, String(amount));
}
test.before(async () => { await setupUsers(); });

test('successful transfer debits source, credits another owner and conserves money', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 50000, 'transfer-fund-' + suffix);
  const before = await getTotal([source.id, destination.id]);
  const response = await transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 20000, 'transfer-ok-' + suffix);
  assert.equal(response.status, 201);
  const { transaction } = await response.json();
  assert.equal(transaction.type, 'TRANSFER');
  assert.equal(transaction.sourceAccountId, source.id);
  assert.equal(transaction.destinationAccountId, destination.id);
  assert.equal(transaction.amountPaise, '20000');
  assert.equal(transaction.sourceBalanceAfterPaise, '30000');
  assert.equal(transaction.destinationBalanceAfterPaise, '20000');
  assert.equal(await getBalance(source.id), '30000');
  assert.equal(await getBalance(destination.id), '20000');
  assert.equal(await getTotal([source.id, destination.id]), before);
  await assertBalancedTransfer(transaction.id, source.id, destination.id, 20000);
  const history = await request('/api/accounts/' + destination.id + '/transactions', { token: fixtures.ACCOUNT_HOLDER1.token });
  const historyJson = await history.json();
  assert.ok(historyJson.transactions.some((row) => row.id === transaction.id && row.destinationAccountId === destination.id));
});

test('insufficient source balance leaves both accounts unchanged', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 50, 'short-fund-' + suffix);
  const response = await transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 51, 'short-' + suffix);
  assert.equal(response.status, 409);
  assert.equal(await getBalance(source.id), '50');
  assert.equal(await getBalance(destination.id), '0');
});

test('transfer requires account-holder authentication and source ownership', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  assert.equal((await transfer(source, destination, null, 1, 'no-auth-' + suffix)).status, 401);
  assert.equal((await transfer(source, destination, fixtures.ACCOUNT_HOLDER1.token, 1, 'wrong-owner-' + suffix)).status, 404);
  assert.equal((await transfer(source, destination, fixtures.ADMIN.token, 1, 'admin-' + suffix)).status, 403);
});

test('frozen source and destination accounts reject transfers', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 500, 'freeze-fund-' + suffix);
  await request('/api/accounts/' + source.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'FROZEN' } });
  assert.equal((await transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 1, 'frozen-source-' + suffix)).status, 409);
  const activeSource = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(activeSource, fixtures.ACCOUNT_HOLDER0.token, 500, 'dest-freeze-fund-' + suffix);
  await request('/api/accounts/' + destination.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'FROZEN' } });
  assert.equal((await transfer(activeSource, destination, fixtures.ACCOUNT_HOLDER0.token, 1, 'frozen-dest-' + suffix)).status, 409);
});

test('closed source and destination accounts reject transfers', async () => {
  const closedSource = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await request('/api/accounts/' + closedSource.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'CLOSED' } });
  assert.equal((await transfer(closedSource, destination, fixtures.ACCOUNT_HOLDER0.token, 1, 'closed-source-' + suffix)).status, 409);
  const activeSource = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const closedDestination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(activeSource, fixtures.ACCOUNT_HOLDER0.token, 100, 'closed-dest-fund-' + suffix);
  await request('/api/accounts/' + closedDestination.id + '/status', { method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'CLOSED' } });
  assert.equal((await transfer(activeSource, closedDestination, fixtures.ACCOUNT_HOLDER0.token, 1, 'closed-dest-' + suffix)).status, 409);
});

test('same-account and invalid transfer requests are rejected', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  assert.equal((await transfer(account, account, fixtures.ACCOUNT_HOLDER0.token, 1, 'same-' + suffix)).status, 400);
  const missingKey = await request('/api/accounts/' + account.id + '/transfers', {
    method: 'POST', token: fixtures.ACCOUNT_HOLDER0.token,
    body: { destination_account_id: account.id, amount_paise: 1 }
  });
  assert.equal(missingKey.status, 400);
  const badAmount = await transfer(account, { id: crypto.randomUUID() }, fixtures.ACCOUNT_HOLDER0.token, 0, 'bad-amount-' + suffix);
  assert.equal(badAmount.status, 400);
});

test('same idempotency key replays one transfer and different payload conflicts', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  const otherDestination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 1000, 'idem-fund-' + suffix);
  const key = 'transfer-idem-' + suffix;
  const responses = await Promise.all([
    transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 300, key),
    transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 300, key)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results[0].transaction.id, results[1].transaction.id);
  assert.equal(await getBalance(source.id), '700');
  assert.equal(await getBalance(destination.id), '300');
  assert.equal((await transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 301, key)).status, 409);
  assert.equal((await transfer(source, otherDestination, fixtures.ACCOUNT_HOLDER0.token, 300, key)).status, 409);
  assert.equal(await getBalance(source.id), '700');
});

test('competing transfers cannot spend one source balance twice', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destinationA = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  const destinationB = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 1000, 'compete-fund-' + suffix);
  const before = await getTotal([source.id, destinationA.id, destinationB.id]);
  const responses = await Promise.all([
    transfer(source, destinationA, fixtures.ACCOUNT_HOLDER0.token, 700, 'compete-a-' + suffix),
    transfer(source, destinationB, fixtures.ACCOUNT_HOLDER0.token, 700, 'compete-b-' + suffix)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await getBalance(source.id), '300');
  assert.equal(await getTotal([source.id, destinationA.id, destinationB.id]), before);
});

test('opposite-direction concurrent transfers lock accounts consistently', async () => {
  const accountA = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const accountB = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await deposit(accountA, fixtures.ACCOUNT_HOLDER0.token, 1000, 'opposite-a-' + suffix);
  await deposit(accountB, fixtures.ACCOUNT_HOLDER0.token, 1000, 'opposite-b-' + suffix);
  const before = await getTotal([accountA.id, accountB.id]);
  const responses = await Promise.all([
    transfer(accountA, accountB, fixtures.ACCOUNT_HOLDER0.token, 700, 'opposite-ab-' + suffix),
    transfer(accountB, accountA, fixtures.ACCOUNT_HOLDER0.token, 700, 'opposite-ba-' + suffix)
  ]);
  assert.deepEqual(responses.map((response) => response.status), [201, 201], JSON.stringify(await Promise.all(responses.map((response) => response.clone().json()))));
  assert.equal(await getBalance(accountA.id), '1000');
  assert.equal(await getBalance(accountB.id), '1000');
  assert.equal(await getTotal([accountA.id, accountB.id]), before);
});

test('database failure rolls back both balances, transfer row, and ledger entries', async () => {
  const source = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const destination = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  await deposit(source, fixtures.ACCOUNT_HOLDER0.token, 100, 'rollback-fund-' + suffix);
  const key = 'transfer-rollback-' + suffix;
  const fn = "CREATE OR REPLACE FUNCTION transfer_test_reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entry_side = 'CREDIT' AND EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND transaction_type = 'TRANSFER') THEN RAISE EXCEPTION 'synthetic transfer test failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$";
  await pool.query(fn);
  await pool.query('DROP TRIGGER IF EXISTS transfer_test_reject_credit_trigger ON ledger_entries');
  await pool.query('CREATE TRIGGER transfer_test_reject_credit_trigger BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION transfer_test_reject_credit()');
  try {
    const response = await transfer(source, destination, fixtures.ACCOUNT_HOLDER0.token, 25, key);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS transfer_test_reject_credit_trigger ON ledger_entries');
    await pool.query('DROP FUNCTION IF EXISTS transfer_test_reject_credit()');
  }
  assert.equal(await getBalance(source.id), '100');
  assert.equal(await getBalance(destination.id), '0');
  const transaction = await pool.query('SELECT 1 FROM transactions WHERE initiated_by = $1 AND idempotency_key = $2', [fixtures.ACCOUNT_HOLDER0.id, key]);
  assert.equal(transaction.rowCount, 0);
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

