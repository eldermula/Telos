'use strict';

const path = require('path');
const { redis } = require('../db/redis');
const { REAL_TRADING_ENABLED } = require('../config/env');
const { isConfirmationActive } = require('./live-trading-confirmation');

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { bootstrapRiskPct, STANDARD_MATRIX_FLOOR_BALANCE } = require(
  path.join(apirsPath, 'tierMatrix.js'),
);

/**
 * Redis live status cache per 05_Database_Design.md Section 2:
 * key `bot:{bot_instance_id}:status`. Shape aligned with
 * GET /trading/session (06_API_Specification.md Section 6) so later
 * increments can serve session reads from cache without reshaping.
 */

const CACHE_TTL_SECONDS = 60 * 60 * 24;

function statusKey(botInstanceId) {
  return `bot:${botInstanceId}:status`;
}

function toCachePayload(instance, updatedAt = new Date()) {
  const activeTradingBalance = Number(instance.active_trading_balance);
  const bootstrapPhase = activeTradingBalance < STANDARD_MATRIX_FLOOR_BALANCE;

  // Option 2 (Increment D) — `real_trading_available` tells the Frontend
  // whether to even offer the confirm-live action at all, independent of
  // whether it's *currently* confirmed. `live_trading_confirmed_at` is
  // reported through the same 15-minute TTL every other reader of this
  // column must apply (live-trading-confirmation.js) — an expired-but-
  // not-yet-Stop-cleared confirmation must never be reported as active
  // here, since the Frontend would otherwise show a stale "Live" state.
  const confirmationActive = isConfirmationActive(instance.live_trading_confirmed_at);

  return {
    bot_instance_id: instance.id,
    status: instance.status,
    crypto_status: instance.crypto_status || 'stopped',
    active_strategy_mode: instance.active_strategy_mode,
    current_tier: instance.current_tier,
    active_trading_balance: activeTradingBalance,
    peak_equity: Number(instance.peak_equity),
    // 08_Bot_Architecture.md Section 3a: current_tier stays 0/undefined-in-effect
    // for the entire bootstrap phase — these two fields let the Frontend show
    // "Bootstrap Phase" + the real risk ceiling instead of a misleading "Tier 0".
    bootstrap_phase: bootstrapPhase,
    bootstrap_risk_ceiling_pct: bootstrapPhase
      ? bootstrapRiskPct(activeTradingBalance)
      : null,
    account_type: instance.account_type,
    real_trading_available: REAL_TRADING_ENABLED && instance.account_type === 'real',
    live_trading_confirmed_at: confirmationActive
      ? instance.live_trading_confirmed_at
      : null,
    updated_at:
      updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
  };
}

async function setStatus(instance) {
  const payload = toCachePayload(instance);
  await redis.set(statusKey(instance.id), JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
  return payload;
}

async function getStatus(botInstanceId) {
  const raw = await redis.get(statusKey(botInstanceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function deleteStatus(botInstanceId) {
  await redis.del(statusKey(botInstanceId));
}

module.exports = {
  statusKey,
  toCachePayload,
  setStatus,
  getStatus,
  deleteStatus,
  CACHE_TTL_SECONDS,
};
