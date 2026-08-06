const { redis } = require('../db/redis');
const {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
} = require('../config/env');
const { AppError } = require('../utils/app-error');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * 5 login attempts / 15 min per IP (06 Section 3).
 * Uses Redis key pattern ratelimit:{id}:{endpoint} with IP as the id slot.
 */
async function rateLimitLogin(req, res, next) {
  try {
    const ip = clientIp(req);
    const key = `ratelimit:${ip}:/auth/login`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOGIN_RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > LOGIN_RATE_LIMIT_MAX) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many login attempts. Try again later.'
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { rateLimitLogin };
