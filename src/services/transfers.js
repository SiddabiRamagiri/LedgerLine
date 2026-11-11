const crypto = require('node:crypto');
const { lockAccountsInOrder } = require('./account-transactions');
const {
  findIdempotentTransaction, insertPendingTransfer, updateProjectedBalance,
  insertTransferEntries, completeTransfer
} = require('../db/transactions');
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const { recordAudit } = require('../db/audit');
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function transferHash(sourceId, destinationId, amountPaise) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(['TRANSFER', sourceId.toLowerCase(), destinationId.toLowerCase(), String(amountPaise)]))
    .digest('hex');
}
function transferResponse(row) {
  return {
    id: row.id, reference: row.reference, type: row.transaction_type,
    amountPaise: row.amount_paise, sourceAccountId: row.account_id,
    destinationAccountId: row.destination_account_id, status: row.status,
    initiatedBy: row.initiated_by, sourceBalanceAfterPaise: row.balance_after_paise,
    destinationBalanceAfterPaise: row.destination_balance_after_paise, createdAt: row.created_at
  };
}
function replay(row, hash) {
  if (row.request_hash !== hash) throw httpError(409, 'Idempotency key was already used with a different request');
  if (row.status !== 'COMPLETED') throw httpError(409, 'The original transfer is not complete');
  return { transaction: transferResponse(row), replayed: true };
}
async function executeTransfer({ pool, sourceAccountId, destinationAccountId, userId, amountPaise, idempotencyKey, requestId }) {
  if (sourceAccountId.toLowerCase() === destinationAccountId.toLowerCase()) throw httpError(400, 'Source and destination accounts must differ');
  const hash = transferHash(sourceAccountId, destinationAccountId, amountPaise);
  const client = await pool.connect();
  let idempotencyCollision = false;
  try {
    await client.query('BEGIN');
    const existing = await findIdempotentTransaction(client, userId, idempotencyKey);
    if (existing) {
      const result = replay(existing, hash);
      await client.query('COMMIT');
      return result;
    }
    if (sourceAccountId.toLowerCase() === destinationAccountId.toLowerCase()) throw httpError(400, 'Source and destination accounts must differ');
    const locked = await lockAccountsInOrder(client, [sourceAccountId, destinationAccountId]);
    const source = locked.get(sourceAccountId.toLowerCase());
    const destination = locked.get(destinationAccountId.toLowerCase());
    if (!source || !destination) throw httpError(404, 'Account not found');
    if (String(source.owner_user_id) !== String(userId)) throw httpError(404, 'Account not found');
    if (source.status !== 'ACTIVE' || destination.status !== 'ACTIVE') throw httpError(409, 'Both accounts must be active');
    if (source.currency !== 'INR' || destination.currency !== 'INR') throw httpError(409, 'Both accounts must use INR');

    const afterLockExisting = await findIdempotentTransaction(client, userId, idempotencyKey);
    if (afterLockExisting) {
      const result = replay(afterLockExisting, hash);
      await client.query('COMMIT');
      return result;
    }

    const amount = BigInt(amountPaise);
    const sourceBalance = BigInt(source.balance_paise);
    const destinationBalance = BigInt(destination.balance_paise);
    if (amount > sourceBalance) throw httpError(409, 'Insufficient funds');
    const sourceAfter = sourceBalance - amount;
    const destinationAfter = destinationBalance + amount;
    if (destinationAfter > MAX_BIGINT) throw httpError(409, 'Destination balance limit exceeded');

    const transactionId = await insertPendingTransfer(client, {
      reference: 'LLT-' + crypto.randomUUID().replaceAll('-', '').toUpperCase(),
      sourceAccountId, destinationAccountId, amountPaise: String(amountPaise),
      userId, key: idempotencyKey, requestHash: hash
    });
    const updates = [
      [sourceAccountId, sourceAfter.toString()],
      [destinationAccountId, destinationAfter.toString()]
    ].sort((left, right) => left[0].localeCompare(right[0]));
    for (const [accountId, balance] of updates) {
      const result = await updateProjectedBalance(client, accountId, balance);
      if (result.rowCount !== 1) throw httpError(409, 'Account is no longer active');
    }
    await insertTransferEntries(client, { transactionId, sourceAccountId, destinationAccountId, amountPaise: String(amountPaise) });
    const completed = await completeTransfer(client, transactionId, sourceAfter.toString(), destinationAfter.toString());
    await recordAudit({ actorUserId: userId, action: 'TRANSFER_COMPLETED', entityType: 'TRANSACTION', entityId: transactionId, requestId, metadata: { sourceAccountId, destinationAccountId, amountPaise: String(amountPaise), reference: completed.reference } }, client);
    await client.query('COMMIT');
    return { transaction: transferResponse(completed), replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && error.constraint === 'transactions_user_idempotency_key_key') idempotencyCollision = true;
    else throw error;
  } finally {
    client.release();
  }
  if (idempotencyCollision) {
    const existing = await findIdempotentTransaction(pool, userId, idempotencyKey);
    if (existing) return replay(existing, hash);
  }
  throw new Error('Unable to resolve idempotent transfer');
}
module.exports = { executeTransfer, transferHash };

