const express = require('express');
const bcrypt = require('bcrypt');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/require-role');
const { createUser, listUsers } = require('../db/users');
const { auditorSchema } = require('../validation/auth');
const { recordAudit } = require('../db/audit');
function safeUser(row) {
  return {
    id: row.id, fullName: row.full_name, email: row.email, role: row.role,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function createAdminRouter(pool) {
  const router = express.Router();
  router.get('/users', authenticate, requireRole('ADMIN', 'AUDITOR'), async (_req, res, next) => {
    try {
      res.json({ users: (await listUsers(pool)).map(safeUser) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/auditors', authenticate, requireRole('ADMIN'), async (req, res, next) => {
    const parsed = auditorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
    try {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const client = await pool.connect();
      let row;
      try {
        await client.query('BEGIN');
        row = await createUser({ fullName: parsed.data.fullName, email: parsed.data.email, passwordHash, role: 'AUDITOR' }, client);
        await recordAudit({ actorUserId: req.user.id, action: 'AUDITOR_CREATED', entityType: 'USER', entityId: row.id, requestId: req.id, metadata: { role: 'AUDITOR' } }, client);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      res.status(201).json({ user: safeUser(row) });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email is already registered' });
      next(error);
    }
  });
  return router;
}
module.exports = createAdminRouter;
