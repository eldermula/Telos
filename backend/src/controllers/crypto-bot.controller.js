'use strict';

const cryptoTradingEngine = require('../engine/crypto-trading-engine');

async function getCryptoSession(req, res, next) {
  try {
    const data = await cryptoTradingEngine.getCryptoSessionForUser(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startCrypto(req, res, next) {
  try {
    const autoTick = process.env.CRYPTO_PAPER_AUTO_TICK !== '0';
    const data = await cryptoTradingEngine.startCryptoSession(req.user.id, { autoTick });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopCrypto(req, res, next) {
  try {
    const data = await cryptoTradingEngine.stopCryptoSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCryptoSession,
  startCrypto,
  stopCrypto,
};
