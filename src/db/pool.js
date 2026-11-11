const { Pool } = require('pg');
const config = require('../config/env');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectionTimeoutMs
});

pool.on('error', (error) => {
  // Do not log connection details or credentials.
  console.error('Unexpected idle PostgreSQL client error', { code: error.code || 'unknown' });
});

module.exports = pool;

