'use strict';

const path = require('path');
const { redis } = require('../db/redis');
const mt5Connector = require('../services/mt5-connector.client');

const marketIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'market-intelligence', 'src');
const { evaluateMarketIntelligence, InsufficientDataError } = require(
  path.join(marketIntelligencePath, 'marketIntelligence.js')
);

/**
 * Module 2 — Market Intelligence Worker (08_Bot_Architecture.md
 * Section 9.0/9.2). Runs once per instrument in the watchlist, not
 * once per bot instance — the Redis cache below is keyed by symbol so
 * every bot instance evaluating the same instrument shares one read
 * instead of each re-fetching/re-computing (05_Database_Design.md
 * Section 2).
 */

const DEFAULT_TIMEFRAME = process.env.MARKET_INTELLIGENCE_TIMEFRAME || 'M15';
const DEFAULT_BAR_COUNT = Number(process.env.MARKET_INTELLIGENCE_BAR_COUNT) || 100;
// Section 9.2's proposed slow-path cadence: 15-30s, not per-tick (default
// tick is 2s) — forex structure doesn't meaningfully change tick-to-tick,
// so the fast path reuses this cached read between refreshes.
const CACHE_TTL_SECONDS = Number(process.env.MARKET_INTELLIGENCE_CACHE_TTL_SECONDS) || 20;

function cacheKey(symbol) {
  return `market:${symbol}:intelligence`;
}

/**
 * Section 9.1's existing failure fallback, reused as-is for Module 2:
 * neutral trend signal, volatility treated as HIGH (conservative) so
 * APIRS's downstream risk math still runs — just cautiously — instead
 * of the whole cycle stalling because one instrument's data was
 * temporarily unavailable.
 */
function fallbackResult(symbol, reason) {
  return {
    symbol,
    trend_quality: 0.5,
    market_volatility: 'HIGH',
    volatility_penalty: 1,
    stale: true,
    reason,
  };
}

async function computeFreshMarketIntelligence(symbol, { timeframe = DEFAULT_TIMEFRAME, count = DEFAULT_BAR_COUNT } = {}) {
  const { bars } = await mt5Connector.getRates(symbol, { timeframe, count });
  const result = evaluateMarketIntelligence(bars);
  // `bars` rides along in the same cached payload (same ~20s TTL) so
  // Module 4 (Selection) can compute its own signal indicators
  // (EMA/RSI/breakout) off the same fetch instead of hitting the MT5
  // connector a second time for the same instrument+timeframe every
  // tick — one connector call per instrument per cache window, shared
  // by both modules (08_Bot_Architecture.md Section 9, Module 4 note).
  return { ...result, symbol, bars, stale: false };
}

async function getMarketIntelligence(symbol, options = {}) {
  const key = cacheKey(symbol);

  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupt cache entry — fall through and recompute.
    }
  }

  let payload;
  try {
    payload = await computeFreshMarketIntelligence(symbol, options);
  } catch (err) {
    const reason = err instanceof InsufficientDataError ? 'insufficient_data' : err.message;
    console.error(`[market-intelligence] ${symbol}: ${reason}`);
    return fallbackResult(symbol, reason);
  }

  await redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((err) => {
    console.error(`[market-intelligence] cache write failed for ${symbol}: ${err.message}`);
  });
  return payload;
}

/**
 * Module 4's read of the same cached fetch Module 2 already made for
 * this instrument this cache window — `null` if Module 2 is in its
 * Section 9.1 fallback (stale) for this symbol, since there are no
 * real bars behind a fallback reading. Callers should treat `null` as
 * "no signal computable this tick for this instrument," the same
 * WAIT outcome as any other strategy that doesn't fire.
 */
async function getCachedBars(symbol, options = {}) {
  const intelligence = await getMarketIntelligence(symbol, options);
  return intelligence.stale ? null : intelligence.bars;
}

module.exports = {
  getMarketIntelligence,
  getCachedBars,
  computeFreshMarketIntelligence,
  cacheKey,
  CACHE_TTL_SECONDS,
};
