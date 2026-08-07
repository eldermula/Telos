'use strict';

const { AppError } = require('../utils/app-error');

/**
 * Requires `req.user.role === 'admin'` after authenticate.
 * Returns 403 (never a filtered empty list) per 06 §13.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(
      new AppError(403, 'FORBIDDEN', 'Admin role required')
    );
  }
  return next();
}

module.exports = { requireAdmin };
