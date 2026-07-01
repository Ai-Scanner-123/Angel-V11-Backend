const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const angelService = require('../services/angelService');

router.get('/status', apiKeyAuth, async (req, res) => {
  try {
    const session = await angelService.getSession();
    res.json({
      status: 'connected',
      hasJwt: Boolean(session.jwtToken),
      hasFeedToken: Boolean(session.feedToken)
    });
  } catch (error) {
    res.status(500).json({ status: 'failed', error: error.message });
  }
});

router.post('/quote', apiKeyAuth, async (req, res) => {
  try {
    const { exchange, symboltoken, tradingsymbol } = req.body;
    const quote = await angelService.getQuote({ exchange, symboltoken, tradingsymbol });
    res.json({ success: true, quote });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/scan', apiKeyAuth, async (req, res) => {
  try {
    const stocks = req.body.stocks || [];
    if (!Array.isArray(stocks) || stocks.length === 0) {
      return res.status(400).json({ success: false, error: 'stocks array is required' });
    }

    const results = [];
    for (const stock of stocks) {
      try {
        const quote = await angelService.getQuote(stock);
        const decision = angelService.simpleSignalFromQuote(quote);
        results.push({ ...stock, quote: quote.raw, decision });
      } catch (err) {
        results.push({ ...stock, error: err.message });
      }
    }

    res.json({ success: true, count: results.length, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
