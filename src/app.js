const express = require('express');
const healthRoutes = require('./routes/health');
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
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
module.exports = createApp;



