'use strict';

const path = require('path');
const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');

// APIRS Section 2 seed — Engine only reads INITIAL_BALANCE for new rows.
const { INITIAL_BALANCE } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'apirs',
  'src',
  'constants.js'
));

function toNumber(value) {
  return typeof value === 'number' ? value : Number(value);
}

/** DATE columns arrive as JS Date at local midnight; serialize as YYYY-MM-DD. */
function toDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function toNullableNumber(value) {
  if (value == null) return null;
  return toNumber(value);
}

function mapBotInstance(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    broker_connection_id: row.broker_connection_id,
    status: row.status,
    crypto_status: row.crypto_status || 'stopped',
    active_strategy_mode: row.active_strategy_mode,
    initial_balance: toNumber(row.initial_balance),
    active_trading_balance: toNumber(row.active_trading_balance),
    peak_equity: toNumber(row.peak_equity),
    current_tier: row.current_tier,
    // Option 2 — read live off broker_connections via a join/subquery in
    // every query below, never cached on bot_instances itself: this is
    // the same trusted, revalidate-on-credential-update column Increment
    // C's resolver and D's confirm-live precondition both key off.
    account_type: row.account_type,
    // Layer 2 opt-in (Option 2). Raw column value — callers that care
    // about the 15-minute TTL (bot-status.cache.js, trading-engine.js)
    // apply live-trading-confirmation.js's isConfirmationActive() on top
    // of this; this repository stays a plain data-access layer and
    // doesn't itself decide what's "still valid".
    live_trading_confirmed_at: row.live_trading_confirmed_at,
    // Daily drawdown markers (micro breaker §7) — nullable until first tick.
    daily_drawdown_day: toDateOnly(row.daily_drawdown_day),
    daily_start_equity: toNullableNumber(row.daily_start_equity),
    daily_peak_equity: toNullableNumber(row.daily_peak_equity),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  bi.id, bi.user_id, bi.broker_connection_id, bi.status, bi.crypto_status, bi.active_strategy_mode,
  bi.initial_balance, bi.active_trading_balance, bi.peak_equity, bi.current_tier,
  bc.account_type, bi.live_trading_confirmed_at,
  bi.daily_drawdown_day, bi.daily_start_equity, bi.daily_peak_equity,
  bi.created_at, bi.updated_at
`;

const RETURNING_COLUMNS = `
  id, user_id, broker_connection_id, status, crypto_status, active_strategy_mode,
  initial_balance, active_trading_balance, peak_equity, current_tier,
  (SELECT account_type FROM broker_connections WHERE id = bot_instances.broker_connection_id) AS account_type,
  live_trading_confirmed_at,
  daily_drawdown_day, daily_start_equity, daily_peak_equity,
  created_at, updated_at
`;

async function findBrokerConnectionForUser(userId) {
  const result = await pool.query(
    `SELECT id FROM broker_connections WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function findByBrokerConnectionId(brokerConnectionId) {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.broker_connection_id = $1`,
    [brokerConnectionId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
}

async function findByUserId(userId) {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.user_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
}

async function findById(botInstanceId) {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.id = $1`,
    [botInstanceId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
}

/**
 * All instances currently marked running — used at process boot to
 * rehydrate in-memory BotRuntimes after a crash/restart (otherwise
 * DB says running but nothing monitors open paper/real positions).
 */
async function listRunning() {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.status = 'running'
     ORDER BY bi.updated_at ASC`
  );
  return result.rows.map(mapBotInstance);
}

async function listCryptoRunning() {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.crypto_status = 'running'
     ORDER BY bi.updated_at ASC`
  );
  return result.rows.map(mapBotInstance);
}

/**
 * Load existing bot_instances row for the user's linked broker connection,
 * or insert one with APIRS Section 2 defaults (stopped / STRATEGY_A / $10).
 */
async function ensureForUser(userId) {
  const connection = await findBrokerConnectionForUser(userId);
  if (!connection) {
    throw new AppError(
      404,
      'NO_BROKER_CONNECTION',
      'Link a broker connection before starting the trading engine'
    );
  }

  const existing = await findByBrokerConnectionId(connection.id);
  if (existing) {
    return existing;
  }

  const result = await pool.query(
    `INSERT INTO bot_instances
       (user_id, broker_connection_id, status, active_strategy_mode,
        initial_balance, active_trading_balance, peak_equity, current_tier)
     VALUES ($1, $2, 'stopped', 'STRATEGY_A', $3, $3, $3, 0)
     RETURNING ${RETURNING_COLUMNS}`,
    [userId, connection.id, INITIAL_BALANCE]
  );

  return mapBotInstance(result.rows[0]);
}

async function updateStatusFields(botInstanceId, fields) {
  const allowed = [
    'status',
    'crypto_status',
    'active_strategy_mode',
    'active_trading_balance',
    'peak_equity',
    'current_tier',
    // Option 2 Layer 2 — set only by the dedicated confirm-live endpoint
    // (never by Start), cleared to null on every Stop. Listed here, not
    // given its own update function, for the same reason status/tier
    // share this one: every write to bot_instances goes through a single
    // allowlisted path.
    'live_trading_confirmed_at',
    // Daily drawdown markers — bot-runtime only; null-safe until first tick.
    'daily_drawdown_day',
    'daily_start_equity',
    'daily_peak_equity',
  ];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${key} = $${i}`);
      values.push(fields[key]);
      i += 1;
    }
  }

  if (sets.length === 0) {
    return findById(botInstanceId);
  }

  sets.push('updated_at = now()');
  values.push(botInstanceId);

  const result = await pool.query(
    `UPDATE bot_instances
     SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING ${RETURNING_COLUMNS}`,
    values
  );

  if (!result.rows[0]) {
    throw new AppError(404, 'BOT_INSTANCE_NOT_FOUND', 'Bot instance not found');
  }

  return mapBotInstance(result.rows[0]);
}

module.exports = {
  INITIAL_BALANCE,
  mapBotInstance,
  findBrokerConnectionForUser,
  findByBrokerConnectionId,
  findByUserId,
  findById,
  listRunning,
  listCryptoRunning,
  ensureForUser,
  updateStatusFields,
};
