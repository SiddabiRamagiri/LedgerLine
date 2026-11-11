const test = require('node:test');
const assert = require('node:assert/strict');
const createApp = require('../src/app');

function serve(pool) {
  const server = createApp({ pool }).listen(0);
  const baseUrl = new Promise((resolve) => server.once('listening', () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  }));
  return { server, baseUrl };
}

test('GET /api/ready returns ready when its database probe succeeds', async (t) => {
  let query;
  const { server, baseUrl } = serve({ query: async (sql) => {
    query = sql;
    return { rows: [{ '?column?': 1 }] };
  } });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${await baseUrl}/api/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready', database: 'ok' });
  assert.equal(query, 'SELECT 1');
});

test('GET /api/ready returns 503 when its database probe fails', async (t) => {
  const { server, baseUrl } = serve({ query: async () => { throw new Error('connection rejected'); } });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${await baseUrl}/api/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Service unavailable' });
});

test('GET /api/ready rejects unexpected query input', async (t) => {
  const { server, baseUrl } = serve({ query: async () => ({ rows: [] }) });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${await baseUrl}/api/ready?unexpected=yes`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'This endpoint does not accept input' });
});
