'use strict';

/**
 * Shared with rate-limit-login.js's own (separately defined, untouched)
 * copy — extracted here so the new general rate-limit middleware
 * (Phase 8) doesn't duplicate it a second time. Behind Cloudflare
 * Tunnel (`app.set('trust proxy', 1)` in app.js), `X-Forwarded-For` is
 * the real client IP; `req.ip`/`req.socket.remoteAddress` are the
 * fallback for direct/local requests (e.g. smoke tests).
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

module.exports = { clientIp };
