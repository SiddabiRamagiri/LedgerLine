const pool = require('./pool');

async function findIdempotentTransaction(db, userId, key) {
  const result = await db.query(
    'SELECT id, reference, transaction_type, amount_paise, account_id, destination_account_id, status, initiated_by, idempotency_key, request_hash, balance_after_paise, destination_balance_after_paise, created_at FROM transactions WHERE initiated_by = $1 AND idempotency_key = $2',
    [userId, key]
  );
  return result.rows[0] || null;
}
async function insertPendingTransaction(db, value) {
  const result = await db.query(
    "INSERT INTO transactions (reference, transaction_type, amount_paise, account_id, status, initiated_by, idempotency_key, request_hash) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7) RETURNING id",
    [value.reference, value.type, value.amountPaise, value.accountId, value.userId, value.key, value.requestHash]
  );
  return result.rows[0].id;
}
async function findDemoClearingAccount(db) {
  const result = await db.query('SELECT id FROM system_ledger_accounts WHERE code = $1', ['DEMO_CLEARING']);
  return result.rows[0] || null;
}
async function updateProjectedBalance(db, accountId, balancePaise) {
  return db.query("UPDATE accounts SET balance_paise = $1 WHERE id = $2 AND status = 'ACTIVE'", [balancePaise, accountId]);
}
async function insertBalancedEntries(db, value) {
  const sql = value.type === 'DEPOSIT'
    ? "INSERT INTO ledger_entries (transaction_id, account_id, system_ledger_account_id, entry_side, amount_paise) VALUES ($1, NULL, $2, 'DEBIT', $3), ($1, $4, NULL, 'CREDIT', $3)"
    : "INSERT INTO ledger_entries (transaction_id, account_id, system_ledger_account_id, entry_side, amount_paise) VALUES ($1, $4, NULL, 'DEBIT', $3), ($1, NULL, $2, 'CREDIT', $3)";
  return db.query(sql, [value.transactionId, value.systemAccountId, value.amountPaise, value.accountId]);
}
async function completeTransaction(db, id, balanceAfter) {
  const result = await db.query(
    "UPDATE transactions SET status = 'COMPLETED', balance_after_paise = $2 WHERE id = $1 RETURNING id, reference, transaction_type, amount_paise, account_id, status, initiated_by, balance_after_paise, created_at",
    [id, balanceAfter]
  );
  return result.rows[0];
}
async function transactionHistory(db, accountId, { limit, offset }) {
  const count = await db.query("SELECT COUNT(*)::text AS total FROM transactions WHERE (account_id = $1 OR destination_account_id = $1) AND status = 'COMPLETED'", [accountId]);
  const rows = await db.query(
    "SELECT id, reference, transaction_type, amount_paise, account_id, destination_account_id, status, initiated_by, balance_after_paise, destination_balance_after_paise, created_at FROM transactions WHERE (account_id = $1 OR destination_account_id = $1) AND status = 'COMPLETED' ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
    [accountId, limit, offset]
  );
  return { total: count.rows[0].total, rows: rows.rows };
}
async function insertPendingTransfer(db, value) {
  const result = await db.query(
    "INSERT INTO transactions (reference, transaction_type, amount_paise, account_id, destination_account_id, status, initiated_by, idempotency_key, request_hash) VALUES ($1, 'TRANSFER', $2, $3, $4, 'PENDING', $5, $6, $7) RETURNING id",
    [value.reference, value.amountPaise, value.sourceAccountId, value.destinationAccountId, value.userId, value.key, value.requestHash]
  );
  return result.rows[0].id;
}
async function insertTransferEntries(db, value) {
  return db.query(
    "INSERT INTO ledger_entries (transaction_id, account_id, system_ledger_account_id, entry_side, amount_paise) VALUES ($1, $2, NULL, 'DEBIT', $4), ($1, $3, NULL, 'CREDIT', $4)",
    [value.transactionId, value.sourceAccountId, value.destinationAccountId, value.amountPaise]
  );
}
async function completeTransfer(db, id, sourceAfter, destinationAfter) {
  const result = await db.query(
    "UPDATE transactions SET status = 'COMPLETED', balance_after_paise = $2, destination_balance_after_paise = $3 WHERE id = $1 RETURNING id, reference, transaction_type, amount_paise, account_id, destination_account_id, status, initiated_by, balance_after_paise, destination_balance_after_paise, created_at",
    [id, sourceAfter, destinationAfter]
  );
  return result.rows[0];
}
module.exports = {
  findIdempotentTransaction, insertPendingTransaction, findDemoClearingAccount, insertPendingTransfer, insertTransferEntries, completeTransfer,
  updateProjectedBalance, insertBalancedEntries, completeTransaction, transactionHistory
};

