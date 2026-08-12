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
const { confirmLiveTradingSchema } = require('../validators/trading.schemas');

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

const demoDispatchEnableSchema = z
  .object({
    minutes: z.number().int().min(1).max(30),
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

async function getSyntheticDemoDispatchStatus(req, res, next) {
  try {
    const data = await adminService.getSyntheticDemoDispatchStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableSyntheticDemoDispatch(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableSyntheticDemoDispatch(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableSyntheticDemoDispatch(req, res, next) {
  try {
    const data = await adminService.disableSyntheticDemoDispatch(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getSyntheticDemoConfirmStatus(req, res, next) {
  try {
    const data = await adminService.getSyntheticDemoConfirmStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableSyntheticDemoConfirm(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableSyntheticDemoConfirm(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableSyntheticDemoConfirm(req, res, next) {
  try {
    const data = await adminService.disableSyntheticDemoConfirm(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getSyntheticDemoManualTradeStatus(req, res, next) {
  try {
    const data = await adminService.getSyntheticDemoManualTradeStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableSyntheticDemoManualTrade(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableSyntheticDemoManualTrade(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableSyntheticDemoManualTrade(req, res, next) {
  try {
    const data = await adminService.disableSyntheticDemoManualTrade(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getForexDemoDispatchStatus(req, res, next) {
  try {
    const data = await adminService.getForexDemoDispatchStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableForexDemoDispatch(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableForexDemoDispatch(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableForexDemoDispatch(req, res, next) {
  try {
    const data = await adminService.disableForexDemoDispatch(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getForexDemoConfirmStatus(req, res, next) {
  try {
    const data = await adminService.getForexDemoConfirmStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableForexDemoConfirm(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableForexDemoConfirm(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableForexDemoConfirm(req, res, next) {
  try {
    const data = await adminService.disableForexDemoConfirm(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getForexDemoManualTradeStatus(req, res, next) {
  try {
    const data = await adminService.getForexDemoManualTradeStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableForexDemoManualTrade(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableForexDemoManualTrade(
      req.user.id,
      body.minutes
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableForexDemoManualTrade(req, res, next) {
  try {
    const data = await adminService.disableForexDemoManualTrade(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getM5PaperStatus(req, res, next) {
  try {
    const data = adminService.getM5PaperStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startM5PaperSession(req, res, next) {
  try {
    const data = await adminService.startM5PaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopM5PaperSession(req, res, next) {
  try {
    const data = await adminService.stopM5PaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getM1PaperStatus(req, res, next) {
  try {
    const data = adminService.getM1PaperStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startM1PaperSession(req, res, next) {
  try {
    const data = await adminService.startM1PaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopM1PaperSession(req, res, next) {
  try {
    const data = await adminService.stopM1PaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getXauVwapPaperStatus(req, res, next) {
  try {
    const data = adminService.getXauVwapPaperStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startXauVwapPaperSession(req, res, next) {
  try {
    const data = await adminService.startXauVwapPaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopXauVwapPaperSession(req, res, next) {
  try {
    const data = await adminService.stopXauVwapPaperSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

// M5 real-dispatch (UNPROVEN LIVE) — see admin.service.js's section header.
async function getM5RealStatus(req, res, next) {
  try {
    const data = adminService.getM5RealStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startM5RealSession(req, res, next) {
  try {
    const data = await adminService.startM5RealSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopM5RealSession(req, res, next) {
  try {
    const data = await adminService.stopM5RealSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function confirmM5RealLiveTrading(req, res, next) {
  try {
    const body = parseBody(confirmLiveTradingSchema, req.body);
    const data = await adminService.confirmM5RealLiveTrading(req.user.id, body.confirmationPhrase);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getM5RealDispatchStatus(req, res, next) {
  try {
    const data = await adminService.getM5RealDispatchStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableM5RealDispatch(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableM5RealDispatch(req.user.id, body.minutes);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableM5RealDispatch(req, res, next) {
  try {
    const data = await adminService.disableM5RealDispatch(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getM5RealConfirmStatus(req, res, next) {
  try {
    const data = await adminService.getM5RealConfirmStatus();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function enableM5RealConfirm(req, res, next) {
  try {
    const body = parseBody(demoDispatchEnableSchema, req.body);
    const data = await adminService.enableM5RealConfirm(req.user.id, body.minutes);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function disableM5RealConfirm(req, res, next) {
  try {
    const data = await adminService.disableM5RealConfirm(req.user.id);
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
  getSyntheticDemoDispatchStatus,
  enableSyntheticDemoDispatch,
  disableSyntheticDemoDispatch,
  getSyntheticDemoConfirmStatus,
  enableSyntheticDemoConfirm,
  disableSyntheticDemoConfirm,
  getSyntheticDemoManualTradeStatus,
  enableSyntheticDemoManualTrade,
  disableSyntheticDemoManualTrade,
  getForexDemoDispatchStatus,
  enableForexDemoDispatch,
  disableForexDemoDispatch,
  getForexDemoConfirmStatus,
  enableForexDemoConfirm,
  disableForexDemoConfirm,
  getForexDemoManualTradeStatus,
  enableForexDemoManualTrade,
  disableForexDemoManualTrade,
  getM5PaperStatus,
  startM5PaperSession,
  stopM5PaperSession,
  getM1PaperStatus,
  startM1PaperSession,
  stopM1PaperSession,
  getXauVwapPaperStatus,
  startXauVwapPaperSession,
  stopXauVwapPaperSession,
  getM5RealStatus,
  startM5RealSession,
  stopM5RealSession,
  confirmM5RealLiveTrading,
  getM5RealDispatchStatus,
  enableM5RealDispatch,
  disableM5RealDispatch,
  getM5RealConfirmStatus,
  enableM5RealConfirm,
  disableM5RealConfirm,
};
