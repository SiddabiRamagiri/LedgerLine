const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/require-role');
const { findAccountById } = require('../db/accounts');
const { transactionHistory } = require('../db/transactions');
const { executeTransaction } = require('../services/transactions');
const { accountIdSchema, transactionBodySchema, idempotencyKeySchema, historyQuerySchema } = require('../validation/transactions');

function createTransactionsRouter(pool) {
  const router = express.Router();
  router.use(authenticate);
  async function transact(req, res, next, type) {
    const idParsed = accountIdSchema.safeParse(req.params);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid account id' });
    const bodyParsed = transactionBodySchema.safeParse(req.body);
    if (!bodyParsed.success) return res.status(400).json({ error: 'Invalid request body' });
    const keyParsed = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
    if (!keyParsed.success) return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
    try {
      const result = await executeTransaction({
        pool, accountId: idParsed.data.id, userId: req.user.id, type,
        amountPaise: bodyParsed.data.amount_paise, idempotencyKey: keyParsed.data,
        requestId: req.id
      });
      res.status(result.replayed ? 200 : 201).json({ transaction: result.transaction });
    } catch (error) {
      next(error);
    }
  }
  router.post('/:id/deposits', requireRole('ACCOUNT_HOLDER'), (req, res, next) => transact(req, res, next, 'DEPOSIT'));
  router.post('/:id/withdrawals', requireRole('ACCOUNT_HOLDER'), (req, res, next) => transact(req, res, next, 'WITHDRAWAL'));
  router.get('/:id/transactions', requireRole('ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'), async (req, res, next) => {
    const idParsed = accountIdSchema.safeParse(req.params);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid account id' });
    const queryParsed = historyQuerySchema.safeParse(req.query);
    if (!queryParsed.success) return res.status(400).json({ error: 'Invalid pagination query' });
    try {
      const account = await findAccountById(idParsed.data.id, { role: req.user.role, userId: req.user.id }, pool);
      if (!account) return res.status(404).json({ error: 'Account not found' });
      const { page, limit } = queryParsed.data;
      const history = await transactionHistory(pool, idParsed.data.id, { limit, offset: (page - 1) * limit });
      res.json({
        transactions: history.rows.map((row) => ({
          id: row.id, reference: row.reference, type: row.transaction_type,
          amountPaise: row.amount_paise, accountId: row.account_id, status: row.status,
          initiatedBy: row.initiated_by, balanceAfterPaise: row.balance_after_paise, createdAt: row.created_at, ...(row.destination_account_id ? { destinationAccountId: row.destination_account_id, destinationBalanceAfterPaise: row.destination_balance_after_paise } : {})
        })),
        pagination: { page, limit, total: history.total }
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
module.exports = createTransactionsRouter;

