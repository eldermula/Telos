const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { redis } = require('../db/redis');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { AppError } = require('../utils/app-error');

function parseExpiryToSeconds(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn;
  const match = /^(\d+)([smhd])$/.exec(String(expiresIn));
  if (!match) return 24 * 60 * 60;
  const value = Number(match[1]);
  const unit = match[2];
  const mult = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * mult[unit];
}

function signToken(user) {
  if (!JWT_SECRET) {
    throw new AppError(500, 'INTERNAL_ERROR', 'JWT_SECRET is not configured');
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return { token, jti, expiresInSeconds: parseExpiryToSeconds(JWT_EXPIRES_IN) };
}

function verifyToken(token) {
  if (!JWT_SECRET) {
    throw new AppError(500, 'INTERNAL_ERROR', 'JWT_SECRET is not configured');
  }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

async function blacklistToken(userId, jti, ttlSeconds) {
  const key = `session:${userId}`;
  const ttl = Math.max(1, ttlSeconds || parseExpiryToSeconds(JWT_EXPIRES_IN));
  await redis.sadd(key, jti);
  await redis.expire(key, ttl);
}

async function isTokenBlacklisted(userId, jti) {
  const key = `session:${userId}`;
  const result = await redis.sismember(key, jti);
  return result === 1;
}

module.exports = {
  signToken,
  verifyToken,
  blacklistToken,
  isTokenBlacklisted,
  parseExpiryToSeconds,
};
