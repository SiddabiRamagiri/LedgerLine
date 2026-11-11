function validate(schema) {
  return (req, res, next) => {
    const result = schema(req);
    if (result !== true) {
      return res.status(400).json({ error: result || 'Invalid request' });
    }
    next();
  };
}

module.exports = validate;
