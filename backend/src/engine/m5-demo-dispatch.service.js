'use strict';

/**
 * M5 PAPER-ONLY EXPERIMENT real-dispatch (docs/14_M5_Forex_Paper_Experiment.md)
 * — admin-gated, auto-expiring demo bypasses, mirroring
 * forex-demo-dispatch.service.js exactly, scoped to its own
 * `m5_demo_dispatch_config` singleton (migration 026), independent of
 * forex_demo_dispatch_config / synthetic_demo_dispatch_config:
 *   - Layer 3 dispatch: enabled_until
 *   - Layer 2 confirm:  confirm_enabled_until
 * No manual_test_trade_enabled_until here — M5 real-dispatch has no
 * separate manual-test-trade concept; the whole admin-started harness
 * session already IS the manual test.
 * Postgres singleton + Redis cache (risk-tier pattern). Cache stores both
 * timestamps; each caller compares to Date.now() so expiry is immediate
 * even inside the Redis TTL window.
 */

const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { RISK_TIER_CONFIG_CACHE_TTL_SECONDS } = require('../config/env');
const { AppError } = require('../utils/app-error');

const CACHE_KEY = 'm5:demo-dispatch-config';
const EXPIRY_LOG_KEY_DISPATCH = 'm5:demo-dispatch:expiry-logged';
const EXPIRY_LOG_KEY_CONFIRM = 'm5:demo-confirm:expiry-logged';
const MAX_ENABLE_MINUTES = 30;

const RETURNING_COLS = 'enabled_until, confirm_enabled_until, updated_at, updated_by_admin_user_id';

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

function parseMinutes(minutes) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1) {
    throw new AppError(422, 'VALIDATION_ERROR', 'minutes must be an integer >= 1');
  }
  if (mins > MAX_ENABLE_MINUTES) {
    throw new AppError(422, 'VALIDATION_ERROR', `minutes must be <= ${MAX_ENABLE_MINUTES}`);
  }
  return mins;
}

async function fetchFromDatabase() {
  const result = await pool.query(
    `SELECT ${RETURNING_COLS}
     FROM m5_demo_dispatch_config
     WHERE id = 1`
  );
  if (!result.rows[0]) {
    throw new Error('m5_demo_dispatch_config singleton row missing');
  }
  return result.rows[0];
}

function rowToPayload(row) {
  return {
    enabled_until: row.enabled_until ? new Date(row.enabled_until).toISOString() : null,
    confirm_enabled_until: row.confirm_enabled_until
      ? new Date(row.confirm_enabled_until).toISOString()
      : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

async function getCachedOrDbRow() {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'enabled_until' in parsed &&
        'confirm_enabled_until' in parsed
      ) {
        return parsed;
      }
    } catch {
      // Corrupt — fall through.
    }
  }

  const row = await fetchFromDatabase();
  const payload = rowToPayload(row);
  await redis
    .set(CACHE_KEY, JSON.stringify(payload), 'EX', RISK_TIER_CONFIG_CACHE_TTL_SECONDS)
    .catch((err) => {
      console.error(`[m5-demo-bypass] cache write failed: ${err.message}`);
    });
  return payload;
}

async function maybeLogExpiry(layer, enabledUntilIso, logKey, label) {
  if (!enabledUntilIso) return;
  try {
    const set = await redis.set(logKey, enabledUntilIso, 'EX', 3600, 'NX');
    if (set === 'OK') {
      console.warn(
        `[m5-demo-${layer}] EXPIRED — ${label} is now disabled (enabled_until was ${enabledUntilIso})`
      );
    }
  } catch {
    // best-effort
  }
}

async function invalidateCache() {
  await redis.del(CACHE_KEY).catch((err) => {
    console.error(`[m5-demo-bypass] cache invalidation failed: ${err.message}`);
  });
  await redis.del(EXPIRY_LOG_KEY_DISPATCH).catch(() => {});
  await redis.del(EXPIRY_LOG_KEY_CONFIRM).catch(() => {});
}

/** Never throws to tick/confirm callers: DB/cache failure → disabled. */
async function isM5DemoDispatchEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.enabled_until);
    if (!status.enabled && row.enabled_until) {
      await maybeLogExpiry(
        'dispatch',
        row.enabled_until,
        EXPIRY_LOG_KEY_DISPATCH,
        'M5 demo real-dispatch bypass (Layer 3)'
      );
    }
    return status.enabled;
  } catch (err) {
    console.error(`[m5-demo-dispatch] read failed, treating as disabled: ${err.message}`);
    return false;
  }
}

async function isM5DemoConfirmEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.confirm_enabled_until);
    if (!status.enabled && row.confirm_enabled_until) {
      await maybeLogExpiry(
        'confirm',
        row.confirm_enabled_until,
        EXPIRY_LOG_KEY_CONFIRM,
        'M5 demo confirm-live bypass (Layer 2)'
      );
    }
    return status.enabled;
  } catch (err) {
    console.error(`[m5-demo-confirm] read failed, treating as disabled: ${err.message}`);
    return false;
  }
}

async function getDispatchStatus() {
  const row = await getCachedOrDbRow();
  const status = toStatus(row.enabled_until);
  if (!status.enabled && row.enabled_until) {
    await maybeLogExpiry(
      'dispatch',
      row.enabled_until,
      EXPIRY_LOG_KEY_DISPATCH,
      'M5 demo real-dispatch bypass (Layer 3)'
    );
  }
  return {
    ...status,
    updated_at: row.updated_at || null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

async function getConfirmStatus() {
  const row = await getCachedOrDbRow();
  const status = toStatus(row.confirm_enabled_until);
  if (!status.enabled && row.confirm_enabled_until) {
    await maybeLogExpiry(
      'confirm',
      row.confirm_enabled_until,
      EXPIRY_LOG_KEY_CONFIRM,
      'M5 demo confirm-live bypass (Layer 2)'
    );
  }
  return {
    ...status,
    updated_at: row.updated_at || null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

async function enableDispatch(adminUserId, minutes) {
  const mins = parseMinutes(minutes);
  const result = await pool.query(
    `UPDATE m5_demo_dispatch_config
     SET enabled_until = now() + ($1 * interval '1 minute'),
         updated_at = now(),
         updated_by_admin_user_id = $2
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [mins, adminUserId]
  );
  await invalidateCache();
  const status = toStatus(result.rows[0].enabled_until);
  console.warn(
    `[m5-demo-dispatch] ENABLED by admin_user_id=${adminUserId} for ${mins} minute(s) ` +
      `until=${status.enabled_until} — TESTING-ONLY M5 demo real-dispatch bypass (Layer 3)`
  );
  return status;
}

async function disableDispatch(adminUserId) {
  const result = await pool.query(
    `UPDATE m5_demo_dispatch_config
     SET enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(`[m5-demo-dispatch] DISABLED early by admin_user_id=${adminUserId}`);
  return toStatus(result.rows[0].enabled_until);
}

async function enableConfirm(adminUserId, minutes) {
  const mins = parseMinutes(minutes);
  const result = await pool.query(
    `UPDATE m5_demo_dispatch_config
     SET confirm_enabled_until = now() + ($1 * interval '1 minute'),
         updated_at = now(),
         updated_by_admin_user_id = $2
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [mins, adminUserId]
  );
  await invalidateCache();
  const status = toStatus(result.rows[0].confirm_enabled_until);
  console.warn(
    `[m5-demo-confirm] ENABLED by admin_user_id=${adminUserId} for ${mins} minute(s) ` +
      `until=${status.enabled_until} — TESTING-ONLY M5 demo confirm-live bypass (Layer 2)`
  );
  return status;
}

async function disableConfirm(adminUserId) {
  const result = await pool.query(
    `UPDATE m5_demo_dispatch_config
     SET confirm_enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(`[m5-demo-confirm] DISABLED early by admin_user_id=${adminUserId}`);
  return toStatus(result.rows[0].confirm_enabled_until);
}

module.exports = {
  isM5DemoDispatchEnabled,
  isM5DemoConfirmEnabled,
  getDispatchStatus,
  getConfirmStatus,
  enableDispatch,
  disableDispatch,
  enableConfirm,
  disableConfirm,
  invalidateCache,
  toStatus,
  CACHE_KEY,
  MAX_ENABLE_MINUTES,
};
