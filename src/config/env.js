const dotenv = require('dotenv');
dotenv.config();
function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(name + ' must be a positive integer');
  return parsed;
}
if (process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must be at least 32 bytes');
}
module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: positiveInteger(process.env.PORT, 3000, 'PORT'),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:change_me@localhost:5432/ledgerline_db',
  dbPoolMax: positiveInteger(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
  dbIdleTimeoutMs: positiveInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000, 'DB_IDLE_TIMEOUT_MS'),
  dbConnectionTimeoutMs: positiveInteger(process.env.DB_CONNECTION_TIMEOUT_MS, 5000, 'DB_CONNECTION_TIMEOUT_MS'),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  loginRateWindowMs: positiveInteger(process.env.LOGIN_RATE_WINDOW_MS, 900000, 'LOGIN_RATE_WINDOW_MS'),
  loginRateLimit: positiveInteger(process.env.LOGIN_RATE_LIMIT, 10, 'LOGIN_RATE_LIMIT')
};
