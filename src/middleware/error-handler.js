function notFoundHandler(req, res, next) {
  const error = new Error('Route not found');
  error.status = 404;
  next(error);
}
function errorHandler(error, req, res, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error('Request failed', {
    method: req.method, status,
    code: typeof error.code === 'string' ? error.code : undefined
  });
  const message = status === 503 ? 'Service unavailable' : status >= 500 ? 'Internal server error' : error.message;
  res.status(status).json({ error: message });
}
module.exports = { notFoundHandler, errorHandler };

