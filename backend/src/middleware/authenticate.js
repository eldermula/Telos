const { verifyToken, isTokenBlacklisted } = require('../services/session.service');
const { AppError } = require('../utils/app-error');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
    }

    const payload = verifyToken(token);
    const blacklisted = await isTokenBlacklisted(payload.sub, payload.jti);
    if (blacklisted) {
      throw new AppError(401, 'UNAUTHORIZED', 'Session has been invalidated');
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
