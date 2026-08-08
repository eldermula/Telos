'use strict';

/**
 * Crypto Increment E — Module 2 twin for BTC/ETH.
 * Reuses Wilder ATR/ADX evaluate, re-labels market_volatility with
 * Increment C's classifyCryptoVolatility. Own Redis namespace.
 * Read-only getRates only — never placeOrder.
 */

const path = require('path');
const { redis } = require('../db/redis');
const mt5Connector = require('../services/mt5-connector.client');

const marketIntelligencePath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'market-intelligence',
  'src'
);
const { evaluateMarketIntelligence, InsufficientDataError } = require(
  path.join(marketIntelligencePath, 'marketIntelligence.js')
);
const { classifyCryptoVolatility } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'crypto-market-intelligence',
  'src',
  'volatilityThresholds.js'
));

const DEFAULT_TIMEFRAME = process.env.CRYPTO_MARKET_INTELLIGENCE_TIMEFRAME || 'M15';
const DEFAULT_BAR_COUNT = Number(process.env.CRYPTO_MARKET_INTELLIGENCE_BAR_COUNT) || 100;
const CACHE_TTL_SECONDS = Number(process.env.CRYPTO_MARKET_INTELLIGENCE_CACHE_TTL_SECONDS) || 20;

function cacheKey(symbol) {
  return `crypto:market:${symbol}:intelligence`;
}

function fallbackResult(symbol, reason) {
  return {
    symbol,
    trend_quality: 0.5,
    market_volatility: 'HIGH',
    volatility_penalty: 1,
    stale: true,
    reason,
    asset_class: 'crypto',
  };
}

async function computeFreshCryptoMarketIntelligence(
  symbol,
  { timeframe = DEFAULT_TIMEFRAME, count = DEFAULT_BAR_COUNT } = {}
) {
  const { bars } = await mt5Connector.getRates(symbol, { timeframe, count });
  const result = evaluateMarketIntelligence(bars);
  const ratio = result.diagnostics?.volatilityRatio;
  const market_volatility =
    Number.isFinite(ratio) && ratio >= 0 ? classifyCryptoVolatility(ratio) : result.market_volatility;
  return {
    ...result,
    market_volatility,
    symbol,
    bars,
    stale: false,
    asset_class: 'crypto',
  };
}

async function getCryptoMarketIntelligence(symbol, options = {}) {
  const key = cacheKey(symbol);

  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through
    }
  }

  let payload;
  try {
    payload = await computeFreshCryptoMarketIntelligence(symbol, options);
  } catch (err) {
    const reason = err instanceof InsufficientDataError ? 'insufficient_data' : err.message;
    console.error(`[crypto-market-intelligence] ${symbol}: ${reason}`);
    return fallbackResult(symbol, reason);
  }

  await redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((err) => {
    console.error(`[crypto-market-intelligence] cache write failed for ${symbol}: ${err.message}`);
  });
  return payload;
}

module.exports = {
  getCryptoMarketIntelligence,
  computeFreshCryptoMarketIntelligence,
  cacheKey,
  CACHE_TTL_SECONDS,
};
