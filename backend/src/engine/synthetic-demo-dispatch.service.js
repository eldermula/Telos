'use strict';

/**
 * Admin-gated, auto-expiring synthetics demo bypasses:
 *   - Layer 3 dispatch:       enabled_until
 *   - Layer 2 confirm:        confirm_enabled_until
 *   - Manual test-dispatch:   manual_test_trade_enabled_until
 * Postgres singleton + Redis cache (risk-tier pattern). Cache stores all
 * timestamps; each caller compares to Date.now() so expiry is immediate
 * even inside the Redis TTL window. Layers stay independently toggleable.
 */

const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { RISK_TIER_CONFIG_CACHE_TTL_SECONDS } = require('../config/env');
const { AppError } = require('../utils/app-error');

const CACHE_KEY = 'synthetic:demo-dispatch-config';
const EXPIRY_LOG_KEY_DISPATCH = 'synthetic:demo-dispatch:expiry-logged';
const EXPIRY_LOG_KEY_CONFIRM = 'synthetic:demo-confirm:expiry-logged';
const EXPIRY_LOG_KEY_MANUAL = 'synthetic:demo-manual-trade:expiry-logged';
const MAX_ENABLE_MINUTES = 30;

const RETURNING_COLS =
  'enabled_until, confirm_enabled_until, manual_test_trade_enabled_until, updated_at, updated_by_admin_user_id';

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
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `minutes must be <= ${MAX_ENABLE_MINUTES}`
    );
  }
  return mins;
}

async function fetchFromDatabase() {
  const result = await pool.query(
    `SELECT ${RETURNING_COLS}
     FROM synthetic_demo_dispatch_config
     WHERE id = 1`
  );
  if (!result.rows[0]) {
    throw new Error('synthetic_demo_dispatch_config singleton row missing');
  }
  return result.rows[0];
}

function rowToPayload(row) {
  return {
    enabled_until: row.enabled_until ? new Date(row.enabled_until).toISOString() : null,
    confirm_enabled_until: row.confirm_enabled_until
      ? new Date(row.confirm_enabled_until).toISOString()
      : null,
    manual_test_trade_enabled_until: row.manual_test_trade_enabled_until
      ? new Date(row.manual_test_trade_enabled_until).toISOString()
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
        'confirm_enabled_until' in parsed &&
        'manual_test_trade_enabled_until' in parsed
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
      console.error(`[synthetic-demo-bypass] cache write failed: ${err.message}`);
    });
  return payload;
}

async function maybeLogExpiry(layer, enabledUntilIso, logKey, label) {
  if (!enabledUntilIso) return;
  try {
    const set = await redis.set(logKey, enabledUntilIso, 'EX', 3600, 'NX');
    if (set === 'OK') {
      console.warn(
        `[synthetic-demo-${layer}] EXPIRED — ${label} is now disabled ` +
          `(enabled_until was ${enabledUntilIso})`
      );
    }
  } catch {
    // best-effort
  }
}

async function invalidateCache() {
  await redis.del(CACHE_KEY).catch((err) => {
    console.error(`[synthetic-demo-bypass] cache invalidation failed: ${err.message}`);
  });
  await redis.del(EXPIRY_LOG_KEY_DISPATCH).catch(() => {});
  await redis.del(EXPIRY_LOG_KEY_CONFIRM).catch(() => {});
  await redis.del(EXPIRY_LOG_KEY_MANUAL).catch(() => {});
}

/**
 * Never throws to tick/confirm callers: DB/cache failure → disabled.
 */
async function isDemoDispatchEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.enabled_until);
    if (!status.enabled && row.enabled_until) {
      await maybeLogExpiry(
        'dispatch',
        row.enabled_until,
        EXPIRY_LOG_KEY_DISPATCH,
        'demo real-dispatch bypass (Layer 3)'
      );
    }
    return status.enabled;
  } catch (err) {
    console.error(
      `[synthetic-demo-dispatch] read failed, treating as disabled: ${err.message}`
    );
    return false;
  }
}

async function isDemoConfirmEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.confirm_enabled_until);
    if (!status.enabled && row.confirm_enabled_until) {
      await maybeLogExpiry(
        'confirm',
        row.confirm_enabled_until,
        EXPIRY_LOG_KEY_CONFIRM,
        'demo confirm-live bypass (Layer 2)'
      );
    }
    return status.enabled;
  } catch (err) {
    console.error(
      `[synthetic-demo-confirm] read failed, treating as disabled: ${err.message}`
    );
    return false;
  }
}

async function isManualTestTradeEnabled() {
  try {
    const row = await getCachedOrDbRow();
    const status = toStatus(row.manual_test_trade_enabled_until);
    if (!status.enabled && row.manual_test_trade_enabled_until) {
      await maybeLogExpiry(
        'manual-trade',
        row.manual_test_trade_enabled_until,
        EXPIRY_LOG_KEY_MANUAL,
        'manual test-dispatch/close gate'
      );
    }
    return status.enabled;
  } catch (err) {
    console.error(
      `[synthetic-demo-manual-trade] read failed, treating as disabled: ${err.message}`
    );
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
      'demo real-dispatch bypass (Layer 3)'
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
      'demo confirm-live bypass (Layer 2)'
    );
  }
  return {
    ...status,
    updated_at: row.updated_at || null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

async function getManualTestTradeStatus() {
  const row = await getCachedOrDbRow();
  const status = toStatus(row.manual_test_trade_enabled_until);
  if (!status.enabled && row.manual_test_trade_enabled_until) {
    await maybeLogExpiry(
      'manual-trade',
      row.manual_test_trade_enabled_until,
      EXPIRY_LOG_KEY_MANUAL,
      'manual test-dispatch/close gate'
    );
  }
  return {
    ...status,
    updated_at: row.updated_at || null,
    updated_by_admin_user_id: row.updated_by_admin_user_id || null,
  };
}

/** @deprecated use getDispatchStatus — kept for existing admin.service callers */
async function getStatus() {
  return getDispatchStatus();
}

async function enableDispatch(adminUserId, minutes) {
  const mins = parseMinutes(minutes);
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
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
    `[synthetic-demo-dispatch] ENABLED by admin_user_id=${adminUserId} ` +
      `for ${mins} minute(s) until=${status.enabled_until} — ` +
      'TESTING-ONLY demo real-dispatch bypass (Layer 3)'
  );
  return status;
}

async function disableDispatch(adminUserId) {
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(
    `[synthetic-demo-dispatch] DISABLED early by admin_user_id=${adminUserId}`
  );
  return toStatus(result.rows[0].enabled_until);
}

async function enableConfirm(adminUserId, minutes) {
  const mins = parseMinutes(minutes);
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
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
    `[synthetic-demo-confirm] ENABLED by admin_user_id=${adminUserId} ` +
      `for ${mins} minute(s) until=${status.enabled_until} — ` +
      'TESTING-ONLY demo confirm-live bypass (Layer 2)'
  );
  return status;
}

async function disableConfirm(adminUserId) {
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET confirm_enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(
    `[synthetic-demo-confirm] DISABLED early by admin_user_id=${adminUserId}`
  );
  return toStatus(result.rows[0].confirm_enabled_until);
}

async function enableManualTestTrade(adminUserId, minutes) {
  const mins = parseMinutes(minutes);
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET manual_test_trade_enabled_until = now() + ($1 * interval '1 minute'),
         updated_at = now(),
         updated_by_admin_user_id = $2
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [mins, adminUserId]
  );
  await invalidateCache();
  const status = toStatus(result.rows[0].manual_test_trade_enabled_until);
  console.warn(
    `[synthetic-demo-manual-trade] ENABLED by admin_user_id=${adminUserId} ` +
      `for ${mins} minute(s) until=${status.enabled_until} — ` +
      'TESTING-ONLY manual test-dispatch/close gate'
  );
  return status;
}

async function disableManualTestTrade(adminUserId) {
  const result = await pool.query(
    `UPDATE synthetic_demo_dispatch_config
     SET manual_test_trade_enabled_until = NULL,
         updated_at = now(),
         updated_by_admin_user_id = $1
     WHERE id = 1
     RETURNING ${RETURNING_COLS}`,
    [adminUserId]
  );
  await invalidateCache();
  console.warn(
    `[synthetic-demo-manual-trade] DISABLED early by admin_user_id=${adminUserId}`
  );
  return toStatus(result.rows[0].manual_test_trade_enabled_until);
}

/** @deprecated use enableDispatch */
async function enable(adminUserId, minutes) {
  return enableDispatch(adminUserId, minutes);
}

/** @deprecated use disableDispatch */
async function disable(adminUserId) {
  return disableDispatch(adminUserId);
}

module.exports = {
  isDemoDispatchEnabled,
  isDemoConfirmEnabled,
  isManualTestTradeEnabled,
  getStatus,
  getDispatchStatus,
  getConfirmStatus,
  getManualTestTradeStatus,
  enable,
  disable,
  enableDispatch,
  disableDispatch,
  enableConfirm,
  disableConfirm,
  enableManualTestTrade,
  disableManualTestTrade,
  invalidateCache,
  toStatus,
  CACHE_KEY,
  MAX_ENABLE_MINUTES,
};
