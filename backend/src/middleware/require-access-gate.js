'use strict';

const accessGateService = require('../services/access-gate.service');
const { AppError } = require('../utils/app-error');

/**
 * Require a valid access-gate cookie on every /api/v1 route except the
 * gate endpoints themselves. GET /health lives outside /api/v1 and is
 * never gated (uptime monitors — Phase 8.4).
 *
 * When ACCESS_GATE_PHRASE / ACCESS_GATE_SECRET are unset (local/dev),
 * this is a no-op so existing smoke scripts keep working.
 */
function requireAccessGate(req, res, next) {
  try {
    if (!accessGateService.isGateConfigured()) {
      return next();
    }
    if (accessGateService.hasValidGateCookie(req)) {
      return next();
    }
    throw new AppError(403, 'GATE_LOCKED', 'Access gate required');
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAccessGate };
