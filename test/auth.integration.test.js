const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
const pool = require('../src/db/pool');
const createApp = require('../src/app');
const secret = process.env.JWT_SECRET;
const suffix = crypto.randomUUID();
const emails = [];
const server = createApp().listen(0);
const baseUrl = new Promise((resolve) => server.once('listening', () => resolve('http://127.0.0.1:' + server.address().port)));
function newEmail(label) {
  const email = 'ledgerline-' + label + '-' + suffix + '@example.test';
  emails.push(email);
  return email;
}
async function request(path, options = {}) {
  const headers = {};
  if (options.body) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  return fetch((await baseUrl) + path, {
    method: options.method || 'GET', headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}
async function register(label) {
  const email = newEmail(label);
  const response = await request('/api/auth/register', {
    method: 'POST', body: { fullName: 'Test Account', email, password: 'test-password-123' }
  });
  assert.equal(response.status, 201);
  return { email, user: (await response.json()).user };
}
async function signedToken(id, role) {
  return jwt.sign({ role }, secret, { subject: String(id), expiresIn: '10m', algorithm: 'HS256' });
}
test('successful registration returns safe ACCOUNT_HOLDER details', async () => {
  const { email, user } = await register('register');
  assert.equal(user.email, email);
  assert.equal(user.role, 'ACCOUNT_HOLDER');
  assert.equal(Object.hasOwn(user, 'password_hash'), false);
});
test('duplicate registration is rejected', async () => {
  const { email } = await register('duplicate');
  const response = await request('/api/auth/register', {
    method: 'POST', body: { fullName: 'Duplicate', email, password: 'test-password-123' }
  });
  assert.equal(response.status, 409);
});
test('successful login returns signed JWT with user id and role', async () => {
  const { email } = await register('login');
  const response = await request('/api/auth/login', {
    method: 'POST', body: { email, password: 'test-password-123' }
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  const claims = jwt.verify(result.token, secret, { algorithms: ['HS256'] });
  assert.ok(claims.sub);
  assert.equal(claims.role, 'ACCOUNT_HOLDER');
  assert.equal(Object.hasOwn(result.user, 'password_hash'), false);
});
test('incorrect password is rejected', async () => {
  const { email } = await register('bad-password');
  const response = await request('/api/auth/login', {
    method: 'POST', body: { email, password: 'incorrect-password' }
  });
  assert.equal(response.status, 401);
});
test('missing token is rejected', async () => {
  assert.equal((await request('/api/admin/users')).status, 401);
});
test('invalid token is rejected', async () => {
  assert.equal((await request('/api/admin/users', { token: 'invalid' })).status, 401);
});
test('database role overrides forged ADMIN role in token', async () => {
  const { user } = await register('role-block');
  const forgedRoleToken = await signedToken(user.id, 'ADMIN');
  const response = await request('/api/admin/auditors', {
    method: 'POST', token: forgedRoleToken,
    body: { fullName: 'Blocked Auditor', email: newEmail('forbidden'), password: 'test-password-123' }
  });
  assert.equal(response.status, 403);
});
test('inactive user cannot log in or reuse an existing token', async () => {
  const { email, user } = await register('inactive');
  const login = await request('/api/auth/login', {
    method: 'POST', body: { email, password: 'test-password-123' }
  });
  const token = (await login.json()).token;
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
  assert.equal((await request('/api/auth/login', {
    method: 'POST', body: { email, password: 'test-password-123' }
  })).status, 401);
  assert.equal((await request('/api/admin/users', { token })).status, 401);
});
test('admin-only auditor creation succeeds; auditor can read but cannot write', async () => {
  const adminEmail = newEmail('admin-fixture');
  const hash = await bcrypt.hash('fixture-password-123', 4);
  const inserted = await pool.query(
    "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id",
    ['Fixture Admin', adminEmail, hash]
  );
  const adminToken = await signedToken(inserted.rows[0].id, 'ADMIN');
  const auditorEmail = newEmail('auditor');
  const created = await request('/api/admin/auditors', {
    method: 'POST', token: adminToken,
    body: { fullName: 'Read Only Auditor', email: auditorEmail, password: 'auditor-password-123' }
  });
  assert.equal(created.status, 201);
  const auditor = (await created.json()).user;
  assert.equal(auditor.role, 'AUDITOR');
  assert.equal(Object.hasOwn(auditor, 'password_hash'), false);
  const auditorToken = await signedToken(auditor.id, 'AUDITOR');
  const listing = await request('/api/admin/users', { token: auditorToken });
  assert.equal(listing.status, 200);
  assert.ok(Array.isArray((await listing.json()).users));
  assert.equal((await request('/api/admin/auditors', {
    method: 'POST', token: auditorToken,
    body: { fullName: 'Second Auditor', email: newEmail('auditor-forbidden'), password: 'auditor-password-456' }
  })).status, 403);
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (emails.length) await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [emails]);
  await pool.end();
});

