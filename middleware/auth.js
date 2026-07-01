function apiKeyAuth(req, res, next) {
  const requiredKey = process.env.SCANNER_API_KEY;

  if (!requiredKey) return next();

  const providedKey = req.headers['x-api-key'];
  if (providedKey !== requiredKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid scanner API key' });
  }

  next();
}

module.exports = { apiKeyAuth };
