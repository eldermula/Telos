'use strict';

const jwt = require('jsonwebtoken');
const {
  ACCESS_GATE_PHRASE,
  ACCESS_GATE_SECRET,
  ACCESS_GATE_TTL_DAYS,
  ACCESS_GATE_COOKIE_NAME,
  isProduction,
} = require('../config/env');
const { phrasesMatch } = require('../utils/access-gate-normalize');
const { AppError } = require('../utils/app-error');

const PURPOSE = 'access_gate';

function isGateConfigured() {
  return Boolean(ACCESS_GATE_PHRASE && ACCESS_GATE_SECRET);
}

/**
 * In production the gate is mandatory — refuse to start a live stack
 * without both phrase + secret. Development/smoke can omit them and the
 * middleware becomes a no-op so existing test scripts keep working.
 */
function assertGateConfigAtStartup() {
  if (isProduction && !isGateConfigured()) {
    throw new Error(
      'ACCESS_GATE_PHRASE and ACCESS_GATE_SECRET are required when NODE_ENV=production'
    );
  }
}

function cookieOptions() {
  const maxAgeMs = ACCESS_GATE_TTL_DAYS * 24 * 60 * 60 * 1000;
  // Cross-origin (Vercel frontend → Tunnel API) needs SameSite=None; Secure.
  // Local same-origin / http://localhost cannot set Secure cookies reliably —
  // use Lax + non-Secure there so the gate still works in local smoke/dev.
  if (isProduction) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: maxAgeMs,
      path: '/',
    };
  }
  return {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

function signGateToken() {
  if (!ACCESS_GATE_SECRET) {
    throw new AppError(500, 'INTERNAL_ERROR', 'ACCESS_GATE_SECRET is not configured');
  }
  return jwt.sign({ purpose: PURPOSE }, ACCESS_GATE_SECRET, {
    expiresIn: `${ACCESS_GATE_TTL_DAYS}d`,
  });
}

function verifyGateToken(token) {
  if (!token || !ACCESS_GATE_SECRET) return false;
  try {
    const payload = jwt.verify(token, ACCESS_GATE_SECRET);
    return payload && payload.purpose === PURPOSE;
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function hasValidGateCookie(req) {
  if (!isGateConfigured()) return true; // gate off → treat as unlocked
  const token = readCookie(req, ACCESS_GATE_COOKIE_NAME);
  return verifyGateToken(token);
}

function verifyAttempt(attempt) {
  if (!isGateConfigured()) {
    throw new AppError(503, 'GATE_DISABLED', 'Access gate is not configured on this server');
  }
  if (!phrasesMatch(ACCESS_GATE_PHRASE, attempt)) {
    throw new AppError(401, 'GATE_DENIED', 'Incorrect passphrase');
  }
  return signGateToken();
}

module.exports = {
  PURPOSE,
  isGateConfigured,
  assertGateConfigAtStartup,
  cookieOptions,
  signGateToken,
  verifyGateToken,
  readCookie,
  hasValidGateCookie,
  verifyAttempt,
  ACCESS_GATE_COOKIE_NAME,
};
