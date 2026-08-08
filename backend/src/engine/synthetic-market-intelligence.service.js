'use strict';

/**
 * Synthetics Module 2 twin — Volatility Indices.
 * Reuses Wilder ATR/ADX evaluate; re-labels market_volatility with
 * first-cut classifySyntheticVolatility (0.95/1.05). Own Redis namespace.
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
const { classifySyntheticVolatility } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'volatilityThresholds.js'
));

const DEFAULT_TIMEFRAME = process.env.SYNTHETIC_MARKET_INTELLIGENCE_TIMEFRAME || 'M15';
const DEFAULT_BAR_COUNT = Number(process.env.SYNTHETIC_MARKET_INTELLIGENCE_BAR_COUNT) || 100;
const CACHE_TTL_SECONDS =
  Number(process.env.SYNTHETIC_MARKET_INTELLIGENCE_CACHE_TTL_SECONDS) || 20;

function cacheKey(symbol) {
  return `synthetic:market:${symbol}:intelligence`;
}

function fallbackResult(symbol, reason) {
  return {
    symbol,
    trend_quality: 0.5,
    market_volatility: 'HIGH',
    volatility_penalty: 1,
    stale: true,
    reason,
    asset_class: 'synthetic',
  };
}

async function computeFreshSyntheticMarketIntelligence(
  symbol,
  { timeframe = DEFAULT_TIMEFRAME, count = DEFAULT_BAR_COUNT } = {}
) {
  const { bars } = await mt5Connector.getRates(symbol, { timeframe, count });
  const result = evaluateMarketIntelligence(bars);
  const ratio = result.diagnostics?.volatilityRatio;
  const market_volatility =
    Number.isFinite(ratio) && ratio >= 0
      ? classifySyntheticVolatility(ratio)
      : result.market_volatility;
  return {
    ...result,
    market_volatility,
    symbol,
    bars,
    stale: false,
    asset_class: 'synthetic',
  };
}

async function getSyntheticMarketIntelligence(symbol, options = {}) {
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
    payload = await computeFreshSyntheticMarketIntelligence(symbol, options);
  } catch (err) {
    const reason = err instanceof InsufficientDataError ? 'insufficient_data' : err.message;
    console.error(`[synthetic-market-intelligence] ${symbol}: ${reason}`);
    return fallbackResult(symbol, reason);
  }

  await redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((err) => {
    console.error(
      `[synthetic-market-intelligence] cache write failed for ${symbol}: ${err.message}`
    );
  });
  return payload;
}

module.exports = {
  getSyntheticMarketIntelligence,
  computeFreshSyntheticMarketIntelligence,
  cacheKey,
  CACHE_TTL_SECONDS,
};
