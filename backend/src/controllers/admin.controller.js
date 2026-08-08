'use strict';

const { z } = require('zod');
const adminService = require('../services/admin.service');
const { parsePagination } = require('../utils/pagination');
const { parseUuid } = require('../utils/parse-uuid');
const {
  parseStrategyStatusQuery,
  parseRiskTierParam,
} = require('../utils/query-enums');
const { AppError } = require('../utils/app-error');

function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid request body', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

const riskTierPatchSchema = z
  .object({
    step_size: z.number().positive().optional(),
    base_risk: z.number().positive().optional(),
    max_risk_ceiling: z.number().positive().optional(),
  })
  .strict();

const candidatePatchSchema = z
  .object({
    reviewed_by_admin: z.boolean().optional(),
    status: z.enum(['proposed', 'paper_testing', 'active', 'rejected']).optional(),
  })
  .strict();

async function listUsers(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await adminService.listUsers(pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getUser(req, res, next) {
  try {
    const id = parseUuid(req.params.id, 'user id');
    const data = await adminService.getUser(id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function systemHealth(req, res, next) {
  try {
    const data = await adminService.getSystemHealth();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function listRiskTiers(req, res, next) {
  try {
    const data = await adminService.listRiskTiers();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function patchRiskTier(req, res, next) {
  try {
    const body = parseBody(riskTierPatchSchema, req.body);
    const tier = parseRiskTierParam(req.params.tier);
    const data = await adminService.patchRiskTier(req.user.id, tier, body);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function listCandidateStrategies(req, res, next) {
  try {
    const status = parseStrategyStatusQuery(req.query);
    const data = await adminService.listCandidateStrategies({ status });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function patchCandidateStrategy(req, res, next) {
  try {
    const body = parseBody(candidatePatchSchema, req.body);
    const id = parseUuid(req.params.id, 'strategy id');
    const data = await adminService.patchCandidateStrategy(
      req.user.id,
      id,
      body
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  getUser,
  systemHealth,
  listRiskTiers,
  patchRiskTier,
  listCandidateStrategies,
  patchCandidateStrategy,
};
