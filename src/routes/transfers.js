const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/require-role');
const { executeTransfer } = require('../services/transfers');
const { accountIdSchema, transferBodySchema, idempotencyKeySchema } = require('../validation/transactions');
function createTransferRouter(pool) {
  const router = express.Router();
  router.use(authenticate);
  router.post('/:id/transfers', requireRole('ACCOUNT_HOLDER'), async (req, res, next) => {
    const source = accountIdSchema.safeParse(req.params);
    if (!source.success) return res.status(400).json({ error: 'Invalid account id' });
    const body = transferBodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid request body' });
    const key = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
    if (!key.success) return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
    try {
      const result = await executeTransfer({
        pool, sourceAccountId: source.data.id,
        destinationAccountId: body.data.destination_account_id,
        userId: req.user.id, amountPaise: body.data.amount_paise, idempotencyKey: key.data, requestId: req.id
      });
      res.status(result.replayed ? 200 : 201).json({ transaction: result.transaction });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
module.exports = createTransferRouter;
