const crypto = require('node:crypto');
function requestId(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied.toLowerCase() : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
module.exports = requestId;
