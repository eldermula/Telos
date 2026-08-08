'use strict';

const { z } = require('zod');
const { AppError } = require('./app-error');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Shared ?page=&limit= parsing (06_API_Specification.md Section 2).
 * Phase 8.6 group B: omitted/empty → defaults; present-but-invalid →
 * 422 VALIDATION_ERROR (no more silent coerce of garbage like page=abc).
 */
const paginationQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : v),
    z.coerce.number().int().min(1).optional()
  ),
  limit: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(MAX_LIMIT).optional()
  ),
});

function parsePagination(query = {}) {
  const parsed = paginationQuerySchema.safeParse({
    page: query.page,
    limit: query.limit,
  });
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid pagination query', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

function toMeta({ page, limit }, total) {
  return { page, limit, total };
}

module.exports = {
  parsePagination,
  toMeta,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  paginationQuerySchema,
};
