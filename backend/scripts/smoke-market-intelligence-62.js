/**
 * Increment 6.2 smoke — Module 2 (Market Intelligence Worker), wired
 * end-to-end: live MT5 connector `/rates` -> bot/market-intelligence's
 * ADX/ATR computation -> instrument-keyed Redis cache
 * (08_Bot_Architecture.md Section 9.0/9.2, 05_Database_Design.md
 * Section 2). Requires the MT5 connector + terminal + Redis to be up.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { connectRedis, redis } = require('../src/db/redis');
const marketIntelligence = require('../src/engine/market-intelligence.service');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();

  const symbol = 'EURUSD';
  const key = marketIntelligence.cacheKey(symbol);
  await redis.del(key);

  // 1. Fresh compute — real /rates call, real ADX/ATR math.
  const fresh = await marketIntelligence.getMarketIntelligence(symbol);
  console.log('fresh', fresh);
  assert(fresh.symbol === symbol, 'symbol mismatch');
  assert(fresh.stale === false, 'expected a fresh (non-fallback) result');
  assert(
    typeof fresh.trend_quality === 'number' && fresh.trend_quality >= 0 && fresh.trend_quality <= 1,
    `trend_quality out of range: ${fresh.trend_quality}`
  );
  assert(
    ['LOW', 'NORMAL', 'HIGH'].includes(fresh.market_volatility),
    `unexpected market_volatility: ${fresh.market_volatility}`
  );
  assert(
    typeof fresh.volatility_penalty === 'number' && fresh.volatility_penalty >= 0 && fresh.volatility_penalty <= 1,
    `volatility_penalty out of range: ${fresh.volatility_penalty}`
  );
  assert(fresh.diagnostics && fresh.diagnostics.currentATR > 0, 'expected a positive currentATR diagnostic');

  // 2. Cache hit — same values, without recomputing, TTL matches Section 9.2's cadence.
  const cachedRaw = await redis.get(key);
  assert(cachedRaw, 'expected a cache entry after the fresh compute');
  const ttl = await redis.ttl(key);
  console.log('cache_ttl_seconds', ttl);
  assert(ttl > 0 && ttl <= marketIntelligence.CACHE_TTL_SECONDS, `unexpected TTL: ${ttl}`);

  const cachedRead = await marketIntelligence.getMarketIntelligence(symbol);
  assert(cachedRead.trend_quality === fresh.trend_quality, 'cached trend_quality drifted from fresh compute');
  assert(cachedRead.market_volatility === fresh.market_volatility, 'cached market_volatility drifted');
  assert(cachedRead.volatility_penalty === fresh.volatility_penalty, 'cached volatility_penalty drifted');

  // 3. Failure fallback — Section 9.1: neutral trend, forced HIGH volatility.
  await redis.del(marketIntelligence.cacheKey('BOGUSXYZ'));
  const fallback = await marketIntelligence.getMarketIntelligence('BOGUSXYZ');
  console.log('fallback', fallback);
  assert(fallback.stale === true, 'expected fallback result to be marked stale');
  assert(fallback.trend_quality === 0.5, `expected neutral trend_quality, got ${fallback.trend_quality}`);
  assert(fallback.market_volatility === 'HIGH', `expected forced HIGH volatility, got ${fallback.market_volatility}`);
  assert(fallback.volatility_penalty === 1, `expected max volatility_penalty, got ${fallback.volatility_penalty}`);
  // A fallback result must not be cached — the next tick should retry, not
  // keep serving a stale failure for the full TTL window.
  const fallbackCached = await redis.get(marketIntelligence.cacheKey('BOGUSXYZ'));
  assert(fallbackCached === null, 'fallback result must not be written to the cache');

  await redis.del(key);
  redis.disconnect();

  console.log('MARKET_INTELLIGENCE_62_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
