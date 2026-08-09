'use strict';

const syntheticTradingEngine = require('../engine/synthetic-trading-engine');
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

async function getSyntheticSession(req, res, next) {
  try {
    const data = await syntheticTradingEngine.getSyntheticSessionForUser(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startSynthetic(req, res, next) {
  try {
    const autoTick = process.env.SYNTHETIC_PAPER_AUTO_TICK !== '0';
    const data = await syntheticTradingEngine.startSyntheticSession(req.user.id, { autoTick });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopSynthetic(req, res, next) {
  try {
    const data = await syntheticTradingEngine.stopSyntheticSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function confirmSyntheticLive(req, res, next) {
  try {
    const body = parseBody(confirmLiveTradingSchema, req.body);
    const data = await syntheticTradingEngine.confirmSyntheticLiveTrading(
      req.user.id,
      body.confirmationPhrase
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSyntheticSession,
  startSynthetic,
  stopSynthetic,
  confirmSyntheticLive,
};
