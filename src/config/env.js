const dotenv = require('dotenv');
dotenv.config();
const nodeEnv = process.env.NODE_ENV || 'development';
function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(name + ' must be a positive integer');
  return parsed;
}
function parsePostgresUrl(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(name + ' must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error(name + ' must use PostgreSQL');
  return parsed;
}
function assertRuntimeConfig(config) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  if (!config.jwtSecret || Buffer.byteLength(config.jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 bytes');
  }
  const runtimeUrl = parsePostgresUrl(config.databaseUrl, 'DATABASE_URL');
  if (runtimeUrl.hostname.endsWith('.neon.tech')) {
    if (!runtimeUrl.hostname.includes('-pooler.')) throw new Error('DATABASE_URL must use the Neon pooled endpoint');
    if (!['require', 'verify-ca', 'verify-full'].includes(runtimeUrl.searchParams.get('sslmode'))) {
      throw new Error('DATABASE_URL must require TLS for Neon');
    }
  } else if (config.nodeEnv === 'production' && !['localhost', '127.0.0.1', '::1'].includes(runtimeUrl.hostname)
      && !['require', 'verify-ca', 'verify-full'].includes(runtimeUrl.searchParams.get('sslmode'))) {
    throw new Error('DATABASE_URL must require TLS in production');
  }
}
function assertMigrationConfig(config) {
  if (config.nodeEnv === 'production' && !config.migrationDatabaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL is required for production migrations');
  }
  const migrationUrlString = config.migrationDatabaseUrl || config.databaseUrl;
  const migrationUrl = parsePostgresUrl(migrationUrlString, 'MIGRATION_DATABASE_URL');
  if (config.nodeEnv === 'production') {
    const runtimeUrl = parsePostgresUrl(config.databaseUrl, 'DATABASE_URL');
    if (decodeURIComponent(migrationUrl.username) === decodeURIComponent(runtimeUrl.username)) {
      throw new Error('Production migration and runtime URLs must use distinct database roles');
    }
    if (migrationUrl.hostname.endsWith('.neon.tech')) {
      if (migrationUrl.hostname.includes('-pooler.')) throw new Error('MIGRATION_DATABASE_URL must use the direct Neon endpoint');
      if (!['require', 'verify-ca', 'verify-full'].includes(migrationUrl.searchParams.get('sslmode'))) {
        throw new Error('MIGRATION_DATABASE_URL must require TLS for Neon');
      }
      const normalizedRuntimeHost = runtimeUrl.hostname.replace('-pooler.', '.');
      if (migrationUrl.hostname !== normalizedRuntimeHost || migrationUrl.pathname !== runtimeUrl.pathname) {
        throw new Error('Migration and runtime URLs must target the same Neon database');
      }
    }
  }
  return migrationUrlString;
}
const config = {
  nodeEnv,
  port: positiveInteger(process.env.PORT, 3000, 'PORT'),
  databaseUrl: process.env.DATABASE_URL || (nodeEnv === 'production' ? undefined : 'postgresql://postgres:change_me@localhost:5432/ledgerline_db'),
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
  dbPoolMax: positiveInteger(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
  dbIdleTimeoutMs: positiveInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000, 'DB_IDLE_TIMEOUT_MS'),
  dbConnectionTimeoutMs: positiveInteger(process.env.DB_CONNECTION_TIMEOUT_MS, 5000, 'DB_CONNECTION_TIMEOUT_MS'),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  loginRateWindowMs: positiveInteger(process.env.LOGIN_RATE_WINDOW_MS, 900000, 'LOGIN_RATE_WINDOW_MS'),
  loginRateLimit: positiveInteger(process.env.LOGIN_RATE_LIMIT, 10, 'LOGIN_RATE_LIMIT'),
  assertRuntimeConfig: () => assertRuntimeConfig(config),
  assertMigrationConfig: () => assertMigrationConfig(config)
};
module.exports = config;
