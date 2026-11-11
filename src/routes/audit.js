const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/require-role');
const { listAuditLogs } = require('../db/audit');
const { auditQuerySchema } = require('../validation/audit');
const { reconcileLedger } = require('../services/reconciliation');
function createAuditRouter(pool) {
  const router = express.Router();
  router.get('/audit-logs', authenticate, requireRole('ADMIN', 'AUDITOR'), async (req, res, next) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid audit query' });
    try {
      const { page, limit, ...filters } = parsed.data;
      const result = await listAuditLogs(pool, { ...filters, userId: filters.user_id, limit, offset: (page - 1) * limit });
      res.json({ auditLogs: result.rows, pagination: { page, limit, total: result.total } });
    } catch (error) { next(error); }
  });
  router.get('/reconciliation', authenticate, requireRole('ADMIN', 'AUDITOR'), async (_req, res, next) => {
    try { res.json(await reconcileLedger(pool)); }
    catch (error) { next(error); }
  });
  return router;
}
module.exports = createAuditRouter;
