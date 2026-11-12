const express = require('express');
const healthRoutes = require('./routes/health');
const path = require('node:path');
const createReadyRouter = require('./routes/ready');
const createAuthRouter = require('./routes/auth');
const createAdminRouter = require('./routes/admin');
const createAccountsRouter = require('./routes/accounts');
const createTransactionsRouter = require('./routes/transactions');
const createTransferRouter = require('./routes/transfers');
const createAuditRouter = require('./routes/audit');
const requestId = require('./middleware/request-id');
const { notFoundHandler, errorHandler } = require('./middleware/error-handler');
function createApp({ pool = require('./db/pool') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(requestId);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', healthRoutes);
  app.use('/api', createReadyRouter(pool));
  app.use('/api/auth', createAuthRouter(pool));
  app.use('/api/admin', createAdminRouter(pool));
  app.use('/api/admin', createAuditRouter(pool));
  app.use('/api/accounts', createAccountsRouter(pool));
  app.use('/api/accounts', createTransactionsRouter(pool));
  app.use('/api/accounts', createTransferRouter(pool));
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist, { index: false, maxAge: '1y', immutable: true }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.path === '/api' || req.path.startsWith('/api/') || !req.get('accept')?.includes('text/html')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDist, 'index.html'), (error) => { if (error) next(error); });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
module.exports = createApp;



