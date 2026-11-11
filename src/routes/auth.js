const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const config = require('../config/env');
const { findByEmail, createUser } = require('../db/users');
const { registrationSchema, loginSchema } = require('../validation/auth');
const { recordAudit } = require('../db/audit');
const dummyHash = bcrypt.hashSync('ledgerline-dummy-password', 12);
function safeUser(row) {
  return {
    id: row.id, fullName: row.full_name, email: row.email, role: row.role,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function createAuthRouter(pool) {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: config.loginRateWindowMs, limit: config.loginRateLimit,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' }
  });
  router.post('/register', async (req, res, next) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
    try {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const client = await pool.connect();
      let row;
      try {
        await client.query('BEGIN');
        row = await createUser({ fullName: parsed.data.fullName, email: parsed.data.email, passwordHash, role: 'ACCOUNT_HOLDER' }, client);
        await recordAudit({ actorUserId: row.id, action: 'USER_REGISTERED', entityType: 'USER', entityId: row.id, requestId: req.id }, client);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      return res.status(201).json({ user: safeUser(row) });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email is already registered' });
      return next(error);
    }
  });
  router.post('/login', loginLimiter, async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
    try {
      const user = await findByEmail(parsed.data.email, pool);
      const validPassword = await bcrypt.compare(parsed.data.password, user ? user.password_hash : dummyHash);
      if (!user || !user.is_active || !validPassword) {
        await recordAudit({ actorUserId: user ? user.id : null, action: 'LOGIN_FAILED', entityType: 'AUTHENTICATION', entityId: null, requestId: req.id, metadata: { reason: 'INVALID_CREDENTIALS' } }, pool);
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!config.jwtSecret) return next(new Error('JWT_SECRET is not configured'));
      const token = jwt.sign({ role: user.role }, config.jwtSecret, {
        subject: String(user.id), expiresIn: config.jwtExpiresIn, algorithm: 'HS256'
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await recordAudit({ actorUserId: user.id, action: 'LOGIN_SUCCEEDED', entityType: 'AUTHENTICATION', entityId: user.id, requestId: req.id }, client);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      return res.status(200).json({ token, user: safeUser(user) });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
module.exports = createAuthRouter;
