'use strict';

/**
 * Admin-gated, auto-expiring synthetics Layer-3 demo-dispatch bypass.
 * Postgres singleton + Redis cache (same pattern as risk-tier-config):
 * cache stores the `enabled_until` timestamp; each caller compares to
 * Date.now() so expiry is immediate even inside the Redis TTL window.
 */

const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { RISK_TIER_CONFIG_CACHE_TTL_SECONDS } = require('../config/env');
const { AppError } = require('../utils/app-error');

const CACHE_KEY = 'synthetic:demo-dispatch-config';
const EXPIRY_LOG_KEY = 'synthetic:demo-dispatch:expiry-logged';
const MAX_ENABLE_MINUTES = 30;

function toStatus(enabledUntil) {
  const untilMs = enabledUntil ? new Date(enabledUntil).getTime() : NaN;
  const validUntil = Number.isFinite(untilMs) ? untilMs : null;
  const now = Date.now();
  const enabled = validUntil != null && validUntil > now;
  const remainingMs = enabled ? validUntil - now : 0;
  return {
    enabled,
    enabled_until: validUntil != null ? new Date(validUntil).toISOString() : null,
    remaining_seconds: enabled ? Math.ceil(remainingMs / 1000) : 0,
  };
}

async function fetchFromDatabase() {
  const result = await pool.query(
    `SELECT enabled_until, updated_at, updated_by_admin_user_id
     FROM synthetic_demo_dispatch_config
     WHERE id = 1`
  );
  if (!result.rows[0]) {
    throw new Error('synthetic_demo_dispatch_config singleton row missing');
  }
  return result.rows[0];
}

async function getCachedOrDbRow() {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object' && 'enabled_until' in parsed) {
        return parsed;
      }
    } catch {
      // Corrupt — fall through.
    }
  }

  const row = await fetchFromDatabase();
  const payload = {
    enabled_until: row.enabled_until ? new Date(row.enabled_until).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
  await redis
    .set(CACHE_KEY, JSON.stringify(payload), 'EX', RISK_TIER_CONFIG_CACHE_TTL_SECONDS)
    .catch((err) => {
      console.error(`[synthetic-demo-dispatch] cache write failed: ${err.message}`);
    });
  return payload;
}

/**
 * Never throws to tick callers: DB/cache failure → disabled (safe direction).
 */
async function isDemoDispatchEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.enabled_until);
    if (!status.enabled && row.enabled_until) {
      await maybeLogExpiry(row.enabled_until);
    }
    return status.enabled;
  } catch (err) {
    console.error(
      `[synthetic-demo-dispatch] read failed, treating as disabled: ${err.message}`
    );
    return false;
  }
}

async function getStatus() {
  const row = await getCachedOrDbRow();
  const status = toStatus(row.enabled_until);
  if (!status.enabled && row.enabled_until) {
    await maybeLogExpiry(row.enabled_until);
  }
  return {
    ...status,
    updated_at: row.updated_at || null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

async function maybeLogExpiry(enabledUntilIso) {
  try {
    const set = await redis.set(EXPIRY_LOG_KEY, enabledUntilIso, 'EX', 3600, 'NX');
    if (set === 'OK') {
      console.warn(
        '[synthetic-demo-dispatch] EXPIRED — demo real-dispatch bypass is now disabled ' +
          `(enabled_until was ${enabledUntilIso})`
      );
    }
  } catch {
    // best-effort
  }
}

async function invalidateCache() {
  await redis.del(CACHE_KEY).catch((err) => {
    console.error(`[synthetic-demo-dispatch] cache invalidation failed: ${err.message}`);
  });
  await redis.del(EXPIRY_LOG_KEY).catch(() => {});
}

async function enable(adminUserId, minutes) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1) {
    throw new AppError(422, 'VALIDATION_ERROR', 'minutes must be an integer >= 1');
  }
  if (mins > MAX_ENABLE_MINUTES) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `minutes must be <= ${MAX_ENABLE_MINUTES}`
    );
  }

  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET enabled_until = now() + ($1 * interval '1 minute'),
         updated_at = now(),
         updated_by_admin_user_id = $2
     WHERE id = 1
     RETURNING enabled_until, updated_at, updated_by_admin_user_id`,
    [mins, adminUserId]
  );
  await invalidateCache();
  const row = result.rows[0];
  const status = toStatus(row.enabled_until);
  console.warn(
    `[synthetic-demo-dispatch] ENABLED by admin_user_id=${adminUserId} ` +
      `for ${mins} minute(s) until=${status.enabled_until} — ` +
      'TESTING-ONLY demo real-dispatch bypass (Layer 3)'
  );
  return status;
}

async function disable(adminUserId) {
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING enabled_until, updated_at, updated_by_admin_user_id`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(
    `[synthetic-demo-dispatch] DISABLED early by admin_user_id=${adminUserId}`
  );
  return toStatus(result.rows[0].enabled_until);
}

module.exports = {
  isDemoDispatchEnabled,
  getStatus,
  enable,
  disable,
  invalidateCache,
  toStatus,
  CACHE_KEY,
  MAX_ENABLE_MINUTES,
};
