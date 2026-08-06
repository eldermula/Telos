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

function mapBotInstance(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    broker_connection_id: row.broker_connection_id,
    status: row.status,
    active_strategy_mode: row.active_strategy_mode,
    initial_balance: toNumber(row.initial_balance),
    active_trading_balance: toNumber(row.active_trading_balance),
    peak_equity: toNumber(row.peak_equity),
    current_tier: row.current_tier,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findBrokerConnectionForUser(userId) {
  const result = await pool.query(
    `SELECT id FROM broker_connections WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function findByBrokerConnectionId(brokerConnectionId) {
  const result = await pool.query(
    `SELECT id, user_id, broker_connection_id, status, active_strategy_mode,
            initial_balance, active_trading_balance, peak_equity, current_tier,
            created_at, updated_at
     FROM bot_instances
     WHERE broker_connection_id = $1`,
    [brokerConnectionId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
}

async function findByUserId(userId) {
  const result = await pool.query(
    `SELECT id, user_id, broker_connection_id, status, active_strategy_mode,
            initial_balance, active_trading_balance, peak_equity, current_tier,
            created_at, updated_at
     FROM bot_instances
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
}

async function findById(botInstanceId) {
  const result = await pool.query(
    `SELECT id, user_id, broker_connection_id, status, active_strategy_mode,
            initial_balance, active_trading_balance, peak_equity, current_tier,
            created_at, updated_at
     FROM bot_instances
     WHERE id = $1`,
    [botInstanceId]
  );
  return result.rows[0] ? mapBotInstance(result.rows[0]) : null;
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
     RETURNING id, user_id, broker_connection_id, status, active_strategy_mode,
               initial_balance, active_trading_balance, peak_equity, current_tier,
               created_at, updated_at`,
    [userId, connection.id, INITIAL_BALANCE]
  );

  return mapBotInstance(result.rows[0]);
}

async function updateStatusFields(botInstanceId, fields) {
  const allowed = [
    'status',
    'active_strategy_mode',
    'active_trading_balance',
    'peak_equity',
    'current_tier',
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
     RETURNING id, user_id, broker_connection_id, status, active_strategy_mode,
               initial_balance, active_trading_balance, peak_equity, current_tier,
               created_at, updated_at`,
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
  ensureForUser,
  updateStatusFields,
};
