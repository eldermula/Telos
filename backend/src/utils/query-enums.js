'use strict';

const { z } = require('zod');
const { AppError } = require('./app-error');

/**
 * Phase 8.6 group C — query/path enums at the controller edge.
 */

const RANGE_VALUES = Object.freeze(['7d', '30d', '90d', 'all']);
const STRATEGY_STATUS_VALUES = Object.freeze([
  'proposed',
  'paper_testing',
  'active',
  'rejected',
]);

const rangeQuerySchema = z.object({
  range: z.enum(RANGE_VALUES).optional(),
});

const strategyStatusQuerySchema = z.object({
  status: z.enum(STRATEGY_STATUS_VALUES).optional(),
});

const riskTierParamSchema = z.coerce.number().int().min(0).max(7);

function parseRangeQuery(query = {}) {
  const parsed = rangeQuerySchema.safeParse({ range: query.range });
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid range query', {
      allowed: [...RANGE_VALUES],
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data.range;
}

function parseStrategyStatusQuery(query = {}) {
  const raw = query.status;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = strategyStatusQuerySchema.safeParse({ status: raw });
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid status query', {
      allowed: [...STRATEGY_STATUS_VALUES],
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data.status;
}

function parseRiskTierParam(tierParam) {
  const parsed = riskTierParamSchema.safeParse(tierParam);
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'tier must be an integer 0–7');
  }
  return parsed.data;
}

module.exports = {
  RANGE_VALUES,
  STRATEGY_STATUS_VALUES,
  parseRangeQuery,
  parseStrategyStatusQuery,
  parseRiskTierParam,
};
