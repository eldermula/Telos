'use strict';

const { z } = require('zod');
const { AppError } = require('./app-error');

const uuidSchema = z.string().uuid();

/**
 * Shared UUID path-param check (Phase 8.5 / Zod group A).
 * Invalid IDs 422 instead of reaching Postgres and 500ing (`22P02`).
 */
function parseUuid(id, label = 'id') {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return parsed.data;
}

module.exports = { parseUuid, uuidSchema };
