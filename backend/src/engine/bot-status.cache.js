'use strict';

const { redis } = require('../db/redis');

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
  return {
    bot_instance_id: instance.id,
    status: instance.status,
    active_strategy_mode: instance.active_strategy_mode,
    current_tier: instance.current_tier,
    active_trading_balance: Number(instance.active_trading_balance),
    peak_equity: Number(instance.peak_equity),
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
