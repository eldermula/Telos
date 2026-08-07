'use strict';

const path = require('path');
const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { RISK_TIER_CONFIG_CACHE_TTL_SECONDS } = require('../config/env');

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { TIER_MATRIX } = require(path.join(apirsPath, 'tierMatrix.js'));

/**
 * Phase 7.8 — closes the gap flagged during the 7.6 Admin review:
 * `PATCH /admin/risk-tiers/:tier` was writing to Postgres, but APIRS's
 * `positionSizing.js` (bot/apirs — pure, synchronous, dependency-free)
 * only ever read its own hardcoded `TIER_MATRIX` copy, so admin edits
 * never reached live risk sizing. This service is the same Module 2/3/4
 * pattern (market-intelligence.service.js / news-intelligence.service.js):
 * Redis-cached read of the DB row set, single-flight cache-miss recompute,
 * graceful fallback to the hardcoded matrix on any DB/cache failure — so
 * a Postgres outage degrades risk sizing back to its pre-7.8 hardcoded
 * behavior rather than stalling the bot loop.
 *
 * Single global key (not per-instrument, per-symbol) — unlike Modules
 * 2-4, tier config isn't tied to any one instrument, it's one shared
 * table read by every bot instance's every tick.
 */

const CACHE_KEY = 'risk:tier-config';

/**
 * Normalizes a `risk_tier_config` DB row (snake_case, string numerics
 * per node-postgres's NUMERIC handling) into the camelCase shape
 * `bot/apirs/src/tierMatrix.js`'s hardcoded `TIER_MATRIX` already uses,
 * so APIRS never needs to know about the DB's column-naming convention.
 */
function toTierRow(row) {
  return {
    tier: row.tier,
    completedBlocksMin: row.completed_blocks_min,
    stepSize: Number(row.step_size),
    baseRisk: Number(row.base_risk),
    maxRiskCeiling: Number(row.max_risk_ceiling),
  };
}

async function fetchFromDatabase() {
  const result = await pool.query(
    `SELECT tier, completed_blocks_min, step_size, base_risk, max_risk_ceiling
     FROM risk_tier_config
     ORDER BY tier ASC`
  );
  if (result.rows.length === 0) {
    throw new Error('risk_tier_config table returned zero rows');
  }
  return result.rows.map(toTierRow);
}

/**
 * Returns a live `tierRows` array (same shape as `TIER_MATRIX`) resolved
 * once — cached read, then DB, then hardcoded fallback — for a caller
 * (bot-runtime.js, once per tick) to forward into `evaluateEntry`.
 * Never throws: a config-availability problem degrades risk sizing to
 * the last-known-good hardcoded matrix rather than blocking the tick.
 */
async function getTierRows() {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Corrupt cache entry — fall through and recompute.
    }
  }

  let rows;
  try {
    rows = await fetchFromDatabase();
  } catch (err) {
    console.error(`[risk-tier-config] DB read failed, falling back to hardcoded matrix: ${err.message}`);
    return TIER_MATRIX;
  }

  await redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', RISK_TIER_CONFIG_CACHE_TTL_SECONDS).catch((err) => {
    console.error(`[risk-tier-config] cache write failed: ${err.message}`);
  });
  return rows;
}

/**
 * Called by admin.service.js's `patchRiskTier` right after a successful
 * write, so the *next* tick across every bot instance sees the change
 * immediately rather than waiting out the TTL — invalidate-on-write
 * layered on top of the TTL safety net, not a replacement for it.
 */
async function invalidateCache() {
  await redis.del(CACHE_KEY).catch((err) => {
    console.error(`[risk-tier-config] cache invalidation failed: ${err.message}`);
  });
}

module.exports = {
  getTierRows,
  invalidateCache,
  toTierRow,
  CACHE_KEY,
};
