const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { findById } = require('../db/users');
async function authenticate(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer ([^\s]+)$/i);
  if (!match) return res.status(401).json({ error: 'Authentication required' });
  if (!config.jwtSecret) return next(new Error('JWT_SECRET is not configured'));
  let claims;
  try {
    claims = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!claims || typeof claims.sub !== 'string') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const user = await findById(claims.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid or expired token' });
    // Reload the current role from PostgreSQL; never authorize from a client-supplied role claim.
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
module.exports = authenticate;
