const express = require('express');
const router = express.Router();
const angelService = require('../services/angelService');
const { makeDecision } = require('../services/decisionEngine');

router.get('/status', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'AI NSE Scanner V11.1 Market API',
    smartApiReady: Boolean(process.env.ANGEL_API_KEY && process.env.ANGEL_CLIENT_CODE),
    decisionEngine: true
  });
});

router.post('/login', async (req, res) => {
  try {
    const result = await angelService.login();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/quote', async (req, res) => {
  try {
    const result = await angelService.getQuote(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/scan', (req, res) => {
  const items = Array.isArray(req.body?.stocks) ? req.body.stocks : [];
  const results = items.map(item => makeDecision(item));
  res.json({ success: true, count: results.length, results });
});

router.post('/decision', (req, res) => {
  const decision = makeDecision(req.body || {});
  res.json(decision);
});

module.exports = router;
