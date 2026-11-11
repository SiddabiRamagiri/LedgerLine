const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../src/config/env');
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
const pool = require('../src/db/pool');
const createApp = require('../src/app');
const { lockActiveAccount } = require('../src/services/account-transactions');
const suffix = crypto.randomUUID();
const userIds = [];
const server = createApp().listen(0);
const baseUrl = new Promise((resolve) => server.once('listening', () => resolve('http://127.0.0.1:' + server.address().port)));
const roles = ['ACCOUNT_HOLDER', 'ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'];
const fixtures = {};

async function seedUsers() {
  const hash = await bcrypt.hash('account-test-password', 4);
  for (let index = 0; index < roles.length; index += 1) {
    const email = 'account-test-' + index + '-' + suffix + '@example.test';
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Account Test ' + index, email, hash, roles[index]]
    );
    userIds.push(result.rows[0].id);
    const key = roles[index] === 'ACCOUNT_HOLDER' ? roles[index] + index : roles[index];
    fixtures[key] = {
      id: result.rows[0].id,
      token: jwt.sign({ role: roles[index] }, process.env.JWT_SECRET, {
        subject: String(result.rows[0].id), expiresIn: '10m', algorithm: 'HS256'
      })
    };
  }
}
async function request(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  return fetch((await baseUrl) + path, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}
async function createAccount(token, body = {}) {
  const response = await request('/api/accounts', { method: 'POST', token, body });
  assert.equal(response.status, 201);
  return (await response.json()).account;
}

test.before(async () => { await seedUsers(); });

test('account creation assigns authenticated owner, zero paise, and unique account numbers', async () => {
  const holder = fixtures.ACCOUNT_HOLDER0;
  const first = await createAccount(holder.token);
  const second = await createAccount(holder.token);
  assert.equal(first.ownerUserId, holder.id);
  assert.equal(first.balancePaise, '0');
  assert.equal(first.currency, 'INR');
  assert.equal(first.status, 'ACTIVE');
  assert.match(first.accountNumber, /^LL[0-9]{14}$/);
  assert.notEqual(first.accountNumber, second.accountNumber);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    assert.equal((await lockActiveAccount(client, first.id)).status, 'ACTIVE');
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('creation rejects owner and balance supplied by the client', async () => {
  const response = await request('/api/accounts', {
    method: 'POST', token: fixtures.ACCOUNT_HOLDER0.token,
    body: { owner_user_id: fixtures.ACCOUNT_HOLDER1.id, balance_paise: 99 }
  });
  assert.equal(response.status, 400);
});

test('account holders list only their own accounts', async () => {
  const accountA = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const accountB = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  const rowsA = (await (await request('/api/accounts', { token: fixtures.ACCOUNT_HOLDER0.token })).json()).accounts;
  const rowsB = (await (await request('/api/accounts', { token: fixtures.ACCOUNT_HOLDER1.token })).json()).accounts;
  assert.ok(rowsA.some((row) => row.id === accountA.id));
  assert.ok(rowsA.every((row) => row.ownerUserId === fixtures.ACCOUNT_HOLDER0.id));
  assert.ok(rowsB.some((row) => row.id === accountB.id));
  assert.ok(rowsB.every((row) => row.ownerUserId === fixtures.ACCOUNT_HOLDER1.id));
});

test('account holder cannot read another owners account (IDOR)', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  assert.equal((await request('/api/accounts/' + account.id, { token: fixtures.ACCOUNT_HOLDER1.token })).status, 200);
  const foreign = await request('/api/accounts/' + account.id, { token: fixtures.ACCOUNT_HOLDER0.token });
  assert.equal(foreign.status, 404);
});

test('missing authentication is rejected and admin can list all accounts', async () => {
  assert.equal((await request('/api/accounts')).status, 401);
  const account = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  assert.equal((await request('/api/accounts', { method: 'POST', token: fixtures.ADMIN.token, body: {} })).status, 403);
  const response = await request('/api/accounts', { token: fixtures.ADMIN.token });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).accounts.some((row) => row.id === account.id));
});

test('auditor can read lists/details but cannot change status', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  const anotherOwnersAccount = await createAccount(fixtures.ACCOUNT_HOLDER1.token);
  const listing = await request('/api/accounts', { token: fixtures.AUDITOR.token });
  assert.equal(listing.status, 200);
  assert.ok((await listing.json()).accounts.some((row) => row.id === anotherOwnersAccount.id));
  assert.equal((await request('/api/accounts/' + account.id, { token: fixtures.AUDITOR.token })).status, 200);
  assert.equal((await request('/api/accounts/' + account.id + '/status', {
    method: 'PATCH', token: fixtures.AUDITOR.token, body: { status: 'FROZEN' }
  })).status, 403);
});

test('only admin may freeze/close; non-active accounts fail the row-lock guard', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  assert.equal((await request('/api/accounts/' + account.id + '/status', {
    method: 'PATCH', token: fixtures.ACCOUNT_HOLDER0.token, body: { status: 'FROZEN' }
  })).status, 403);
  const frozenResponse = await request('/api/accounts/' + account.id + '/status', {
    method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'FROZEN' }
  });
  assert.equal(frozenResponse.status, 200);
  assert.equal((await frozenResponse.json()).account.status, 'FROZEN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(lockActiveAccount(client, account.id), (error) => error.status === 409);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  const closedResponse = await request('/api/accounts/' + account.id + '/status', {
    method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'CLOSED' }
  });
  assert.equal(closedResponse.status, 200);
  assert.equal((await closedResponse.json()).account.status, 'CLOSED');
  assert.equal((await request('/api/accounts/' + account.id + '/status', {
    method: 'PATCH', token: fixtures.ADMIN.token, body: { status: 'FROZEN' }
  })).status, 409);
  const closedClient = await pool.connect();
  try {
    await closedClient.query('BEGIN');
    await assert.rejects(lockActiveAccount(closedClient, account.id), (error) => error.status === 409);
    await closedClient.query('ROLLBACK');
  } finally { closedClient.release(); }
});

test('database rejects negative balances', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  await assert.rejects(
    pool.query('UPDATE accounts SET balance_paise = $1 WHERE id = $2', [-1, account.id]),
    (error) => error.code === '23514'
  );
});

test('admin and auditor can view details and malformed IDs are rejected', async () => {
  const account = await createAccount(fixtures.ACCOUNT_HOLDER0.token);
  assert.equal((await request('/api/accounts/' + account.id, { token: fixtures.ADMIN.token })).status, 200);
  assert.equal((await request('/api/accounts/' + account.id, { token: fixtures.AUDITOR.token })).status, 200);
  assert.equal((await request('/api/accounts/not-a-uuid', { token: fixtures.ADMIN.token })).status, 400);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (userIds.length) {
    await pool.query('DELETE FROM accounts WHERE owner_user_id = ANY($1::bigint[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
  }
  await pool.end();
});



