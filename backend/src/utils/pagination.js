'use strict';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Shared ?page=&limit= parsing (06_API_Specification.md Section 2):
 * default limit=25, max limit=100, page defaults to 1.
 */
function parsePagination(query = {}) {
  let page = Number.parseInt(query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  return { page, limit, offset: (page - 1) * limit };
}

function toMeta({ page, limit }, total) {
  return { page, limit, total };
}

module.exports = { parsePagination, toMeta, DEFAULT_LIMIT, MAX_LIMIT };
