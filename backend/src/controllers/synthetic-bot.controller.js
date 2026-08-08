'use strict';

const syntheticTradingEngine = require('../engine/synthetic-trading-engine');

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

module.exports = {
  getSyntheticSession,
  startSynthetic,
  stopSynthetic,
};
