const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');

router.get('/health', validate(() => true), (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
