'use strict';

const tradingService = require('../services/trading.service');
const { parsePagination } = require('../utils/pagination');
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

async function getSession(req, res, next) {
  try {
    const data = await tradingService.getSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startSession(req, res, next) {
  try {
    const data = await tradingService.startSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopSession(req, res, next) {
  try {
    const data = await tradingService.stopSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function confirmLive(req, res, next) {
  try {
    const body = parseBody(confirmLiveTradingSchema, req.body);
    const data = await tradingService.confirmLive(req.user.id, body.confirmationPhrase);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getAccountInfo(req, res, next) {
  try {
    const data = await tradingService.getLiveAccountInfo(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getAttachedAccountInfo(req, res, next) {
  try {
    const data = await tradingService.getAttachedAccountInfo();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getPositions(req, res, next) {
  try {
    const data = await tradingService.getPositions(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getOrders(req, res, next) {
  try {
    const data = await tradingService.getOrders(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await tradingService.getHistory(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getDecisionLog(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await tradingService.getDecisionLog(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSession,
  startSession,
  stopSession,
  confirmLive,
  getAccountInfo,
  getAttachedAccountInfo,
  getPositions,
  getOrders,
  getHistory,
  getDecisionLog,
};
