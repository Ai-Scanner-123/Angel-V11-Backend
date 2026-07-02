const jwt = require('jsonwebtoken');

function optionalAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  const authHeader = req.headers.authorization;

  if (!authHeader || !secret) return next();

  try {
    const token = authHeader.replace('Bearer ', '');
    req.user = jwt.verify(token, secret);
  } catch (error) {
    req.user = null;
  }

  next();
}

module.exports = { optionalAuth };
