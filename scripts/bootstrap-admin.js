const bcrypt = require('bcrypt');
const { z } = require('zod');
const pool = require('../src/db/pool');
async function bootstrap() {
  const parsed = z.object({
    email: z.string().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72)
  }).safeParse({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD
  });
  if (!parsed.success) throw new Error('Set valid BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD environment variables');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [7349231]);
    const admins = await client.query("SELECT 1 FROM users WHERE role = 'ADMIN' LIMIT 1");
    if (admins.rowCount) throw new Error('An admin account already exists; bootstrap is one-time');
    const hash = await bcrypt.hash(parsed.data.password, 12);
    await client.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'ADMIN')",
      ['LedgerLine Administrator', parsed.data.email, hash]
    );
    await client.query('COMMIT');
    console.log('Bootstrap admin created.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
bootstrap().catch((error) => {
  console.error(error.message === 'An admin account already exists; bootstrap is one-time'
    ? error.message : 'Admin bootstrap failed; check required environment values and database status.');
  process.exitCode = 1;
}).finally(() => pool.end());
