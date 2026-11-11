const express = require('express');
const crypto = require('node:crypto');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/require-role');
const {
  createAccount, listAccounts, findAccountById,
  findAccountByIdUnscoped, setAccountStatus
} = require('../db/accounts');
const { createAccountSchema, accountIdSchema, accountStatusSchema } = require('../validation/accounts');
const { recordAudit } = require('../db/audit');

function safeAccount(row) {
  return {
    id: row.id, accountNumber: row.account_number, ownerUserId: row.owner_user_id,
    balancePaise: row.balance_paise, currency: row.currency, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function parseAccountId(req, res) {
  const parsed = accountIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid account id' });
    return null;
  }
  return parsed.data.id;
}
function generateAccountNumber() {
  return 'LL' + crypto.randomInt(10_000_000_000_000, 100_000_000_000_000).toString();
}
function createAccountsRouter(pool) {
  const router = express.Router();
  router.use(authenticate);

  router.post('/', requireRole('ACCOUNT_HOLDER'), async (req, res, next) => {
    const parsed = createAccountSchema.safeParse(req.body === undefined ? {} : req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const client = await pool.connect();
          let row;
          try {
            await client.query('BEGIN');
            row = await createAccount({ accountNumber: generateAccountNumber(), ownerUserId: req.user.id }, client);
            await recordAudit({ actorUserId: req.user.id, action: 'ACCOUNT_CREATED', entityType: 'ACCOUNT', entityId: row.id, requestId: req.id }, client);
            await client.query('COMMIT');
          } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
          finally { client.release(); }
          return res.status(201).json({ account: safeAccount(row) });
        } catch (error) {
          if (error.code === '23505' && error.constraint === 'accounts_account_number_key') continue;
          return next(error);
        }
      }
      return res.status(503).json({ error: 'Unable to create account right now' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', requireRole('ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'), async (req, res, next) => {
    try {
      const rows = await listAccounts({ role: req.user.role, userId: req.user.id }, pool);
      res.json({ accounts: rows.map(safeAccount) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireRole('ACCOUNT_HOLDER', 'ADMIN', 'AUDITOR'), async (req, res, next) => {
    const id = parseAccountId(req, res);
    if (!id) return;
    try {
      const row = await findAccountById(id, { role: req.user.role, userId: req.user.id }, pool);
      if (!row) return res.status(404).json({ error: 'Account not found' });
      res.json({ account: safeAccount(row) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/status', requireRole('ADMIN'), async (req, res, next) => {
    const id = parseAccountId(req, res);
    if (!id) return;
    const parsed = accountStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
    try {
      const client = await pool.connect();
      let row;
      try {
        await client.query('BEGIN');
        const existing = await findAccountByIdUnscoped(id, client);
        if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Account not found' }); }
        if (existing.status === 'CLOSED') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Closed account status cannot be changed' }); }
        row = await setAccountStatus(id, parsed.data.status, client);
        if (!row) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Account status changed; reload and try again' }); }
        if (existing.status !== row.status) await recordAudit({ actorUserId: req.user.id, action: row.status === 'FROZEN' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_CLOSED', entityType: 'ACCOUNT', entityId: row.id, requestId: req.id, metadata: { previousStatus: existing.status, status: row.status } }, client);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      res.json({ account: safeAccount(row) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
module.exports = createAccountsRouter;
