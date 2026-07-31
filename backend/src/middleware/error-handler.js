const { NODE_ENV } = require('../config/env');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message =
    statusCode === 500 && NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message || 'An unexpected error occurred';

  if (statusCode >= 500) {
    console.error('[error]', {
      code,
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      details: err.details || {},
    },
  });
}

module.exports = { errorHandler };
