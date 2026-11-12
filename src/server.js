const createApp = require('./app');
const app = createApp();
const config = require('./config/env');
const pool = require('./db/pool');

config.assertRuntimeConfig();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`LedgerLine listening on port ${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

