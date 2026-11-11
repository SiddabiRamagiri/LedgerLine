const crypto = require('node:crypto');
const { lockActiveAccount } = require('./account-transactions');
const {
  findIdempotentTransaction, insertPendingTransaction, findDemoClearingAccount,
  updateProjectedBalance, insertBalancedEntries, completeTransaction
} = require('../db/transactions');
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const { recordAudit } = require('../db/audit');
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function requestHash(type, accountId, amountPaise) {
  return crypto.createHash('sha256').update(JSON.stringify([type, accountId.toLowerCase(), String(amountPaise)])).digest('hex');
}
function toResponse(row) {
  return {
    id: row.id, reference: row.reference, type: row.transaction_type,
    amountPaise: row.amount_paise, accountId: row.account_id, status: row.status,
    initiatedBy: row.initiated_by, balanceAfterPaise: row.balance_after_paise, createdAt: row.created_at
  };
}
function resolveReplay(row, hash) {
  if (row.request_hash !== hash) throw httpError(409, 'Idempotency key was already used with a different request');
  if (row.status !== 'COMPLETED') throw httpError(409, 'The original transaction is not complete');
  return { transaction: toResponse(row), replayed: true };
}
async function executeTransaction({ pool, accountId, userId, type, amountPaise, idempotencyKey, requestId }) {
  const hash = requestHash(type, accountId, amountPaise);
  const client = await pool.connect();
  let idempotencyCollision = false;
  try {
    await client.query('BEGIN');
    const existing = await findIdempotentTransaction(client, userId, idempotencyKey);
    if (existing) {
      const replay = resolveReplay(existing, hash);
      await client.query('COMMIT');
      return replay;
    }
    const ownership = await client.query('SELECT owner_user_id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!ownership.rows[0] || String(ownership.rows[0].owner_user_id) !== String(userId)) {
      throw httpError(404, 'Account not found');
    }
    const account = await lockActiveAccount(client, accountId);
    const afterLockExisting = await findIdempotentTransaction(client, userId, idempotencyKey);
    if (afterLockExisting) {
      const replay = resolveReplay(afterLockExisting, hash);
      await client.query('COMMIT');
      return replay;
    }
    const amount = BigInt(amountPaise);
    const currentBalance = BigInt(account.balance_paise);
    let newBalance;
    if (type === 'DEPOSIT') {
      newBalance = currentBalance + amount;
      if (newBalance > MAX_BIGINT) throw httpError(409, 'Account balance limit exceeded');
    } else {
      if (amount > currentBalance) throw httpError(409, 'Insufficient funds');
      newBalance = currentBalance - amount;
    }
    const pendingId = await insertPendingTransaction(client, {
      reference: 'LLT-' + crypto.randomUUID().replaceAll('-', '').toUpperCase(),
      type, amountPaise: String(amountPaise), accountId, userId,
      key: idempotencyKey, requestHash: hash
    });
    const balanceUpdate = await updateProjectedBalance(client, accountId, newBalance.toString());
    if (balanceUpdate.rowCount !== 1) throw httpError(409, 'Account is no longer active');
    const systemAccount = await findDemoClearingAccount(client);
    if (!systemAccount) throw new Error('Synthetic clearing account is not configured');
    await insertBalancedEntries(client, {
      transactionId: pendingId, accountId, systemAccountId: systemAccount.id,
      amountPaise: String(amountPaise), type
    });
    const completed = await completeTransaction(client, pendingId, newBalance.toString());
    await recordAudit({ actorUserId: userId, action: type === 'DEPOSIT' ? 'DEPOSIT_COMPLETED' : 'WITHDRAWAL_COMPLETED', entityType: 'TRANSACTION', entityId: pendingId, requestId, metadata: { accountId, amountPaise: String(amountPaise), reference: completed.reference } }, client);
    await client.query('COMMIT');
    return { transaction: toResponse(completed), replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && error.constraint === 'transactions_user_idempotency_key_key') {
      idempotencyCollision = true;
    } else {
      throw error;
    }
  } finally {
    client.release();
  }
  if (idempotencyCollision) {
    const existing = await findIdempotentTransaction(pool, userId, idempotencyKey);
    if (existing) return resolveReplay(existing, hash);
  }
  throw new Error('Unable to resolve idempotent transaction');
}
module.exports = { executeTransaction, requestHash };
