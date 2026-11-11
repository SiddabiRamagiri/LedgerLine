const pool = require('./pool');
async function findByEmail(email, db = pool) {
  const result = await db.query(
    'SELECT id, full_name, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}
async function createUser({ fullName, email, passwordHash, role }, db = pool) {
  const result = await db.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, role, is_active, created_at, updated_at',
    [fullName, email, passwordHash, role]
  );
  return result.rows[0];
}
async function findById(id, db = pool) {
  const result = await db.query(
    'SELECT id, full_name, email, role, is_active, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}
async function listUsers(db = pool) {
  const result = await db.query(
    'SELECT id, full_name, email, role, is_active, created_at, updated_at FROM users ORDER BY id'
  );
  return result.rows;
}
module.exports = { findByEmail, createUser, findById, listUsers };
