const pool = require('./pool');
const columns = 'id, account_number, owner_user_id, balance_paise, currency, status, created_at, updated_at';

async function createAccount({ accountNumber, ownerUserId }, db = pool) {
  const result = await db.query(
    'INSERT INTO accounts (account_number, owner_user_id, balance_paise, currency, status) VALUES ($1, $2, 0, $3, $4) RETURNING ' + columns,
    [accountNumber, ownerUserId, 'INR', 'ACTIVE']
  );
  return result.rows[0];
}
async function listAccounts({ role, userId }, db = pool) {
  const result = role === 'ACCOUNT_HOLDER'
    ? await db.query('SELECT ' + columns + ' FROM accounts WHERE owner_user_id = $1 ORDER BY created_at DESC, id', [userId])
    : await db.query('SELECT ' + columns + ' FROM accounts ORDER BY created_at DESC, id');
  return result.rows;
}
async function findAccountById(id, { role, userId }, db = pool) {
  const result = role === 'ACCOUNT_HOLDER'
    ? await db.query('SELECT ' + columns + ' FROM accounts WHERE id = $1 AND owner_user_id = $2', [id, userId])
    : await db.query('SELECT ' + columns + ' FROM accounts WHERE id = $1', [id]);
  return result.rows[0] || null;
}
async function findAccountByIdUnscoped(id, db = pool) {
  const result = await db.query('SELECT ' + columns + ' FROM accounts WHERE id = $1', [id]);
  return result.rows[0] || null;
}
async function setAccountStatus(id, status, db = pool) {
  const result = await db.query(
    "UPDATE accounts SET status = $2, updated_at = NOW() WHERE id = $1 AND status <> 'CLOSED' RETURNING " + columns,
    [id, status]
  );
  return result.rows[0] || null;
}
module.exports = { createAccount, listAccounts, findAccountById, findAccountByIdUnscoped, setAccountStatus };
