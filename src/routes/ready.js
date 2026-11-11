const express = require('express');
const validate = require('../middleware/validate');

function createReadyRouter(pool) {
  const router = express.Router();
  router.get('/ready', validate((req) => {
    const hasQuery = Object.keys(req.query).length > 0;
    const hasParams = Object.keys(req.params).length > 0;
    const hasBody = req.body !== undefined && Object.keys(req.body).length > 0;
    return hasQuery || hasParams || hasBody ? 'This endpoint does not accept input' : true;
  }), async (_req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ready', database: 'ok' });
    } catch (error) {
      error.status = 503;
      next(error);
    }
  });
  return router;
}

module.exports = createReadyRouter;
