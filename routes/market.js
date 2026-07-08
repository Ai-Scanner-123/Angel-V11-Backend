const express = require('express');
const router = express.Router();

const angelService = require('../services/angelService');
const eventService = require('../services/eventService');
const { buildDecision } = require('../services/decisionEngine');

router.get('/status', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'AI NSE Scanner V11 Backend',
    env: {
      apiKey: !!process.env.ANGEL_API_KEY,
      clientCode: !!(process.env.ANGEL_CLIENT_CODE || process.env.ANGEL_CLIENT_ID),
      password: !!(process.env.ANGEL_PASSWORD || process.env.ANGEL_PIN),
      totp: !!process.env.ANGEL_TOTP_SECRET
    }
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

router.post('/candles', async (req, res) => {
  try {
    const result = await angelService.getCandles(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/decision', (req, res) => {
  try {
    const decision = buildDecision(req.body || {});
    res.json({ success: true, data: decision });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/events', async (req, res) => {
  try {
    const { symbol } = req.body || {};
    const event = await eventService.getCorporateEvents(symbol);
    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
