const test = require('node:test');
const assert = require('node:assert/strict');
const createApp = require('../src/app');
const app = createApp({ pool: { query: async () => ({ rows: [{ '?column?': 1 }] }) } });
const server = app.listen(0);
const baseUrl = new Promise((resolve) => server.once('listening', () => {
  resolve(`http://127.0.0.1:${server.address().port}`);
}));

test('GET /api/health reports application health', async () => {
  const response = await fetch(`${await baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes use centralized not-found handling', async () => {
  const response = await fetch(`${await baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Route not found/);
});

test.after(() => new Promise((resolve) => server.close(resolve)));
