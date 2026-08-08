'use strict';

const { pool } = require('../db/pool');

function toNumber(value) {
  return value == null ? null : Number(value);
}

function mapTrade(row) {
  return {
    id: row.id,
    bot_instance_id: row.bot_instance_id,
    origin: row.origin,
    symbol: row.symbol,
    direction: row.direction,
    entry_price: toNumber(row.entry_price),
    stop_price: toNumber(row.stop_price),
    target_price: toNumber(row.target_price),
    exit_price: toNumber(row.exit_price),
    lot_size: toNumber(row.lot_size),
    final_applied_position_risk: toNumber(row.final_applied_position_risk),
    status: row.status,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    pnl: toNumber(row.pnl),
    // Option 2 — present on every row since migration 008 (paper
    // backfilled). broker_ticket is null for paper trades.
    execution_mode: row.execution_mode,
    broker_ticket: row.broker_ticket == null ? null : Number(row.broker_ticket),
    // Crypto Increment A/E — forex callers omit; DB default forex_gold.
    asset_class: row.asset_class || 'forex_gold',
  };
}

const TRADE_RETURNING = `
  id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
  exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl,
  execution_mode, broker_ticket, asset_class
`;

/**
 * Paper-mode closed trade — harness simulates fill + exit in one cycle.
 * Explicitly writes execution_mode='paper' (Option 2 E.2) — do not rely
 * on the column default.
 */
async function insertClosedPaperTrade({
  botInstanceId,
  symbol,
  direction,
  entryPrice,
  stopPrice,
  targetPrice,
  exitPrice,
  lotSize,
  finalAppliedPositionRisk,
  pnl,
  openedAt = new Date(),
  closedAt = new Date(),
}) {
  const result = await pool.query(
    `INSERT INTO trades
       (bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
        exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl,
        execution_mode)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, $9, 'closed', $10, $11, $12, 'paper')
     RETURNING ${TRADE_RETURNING}`,
    [
      botInstanceId,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      exitPrice,
      lotSize,
      finalAppliedPositionRisk,
      openedAt,
      closedAt,
      pnl,
    ]
  );
  return mapTrade(result.rows[0]);
}

/**
 * Phase 6.1 — opens a real (paper) position: entry/stop/target are
 * known, outcome is not. Left `open` until `closePaperTrade` resolves it
 * against real MT5 price movement (bot-runtime.js's position monitor).
 * Explicitly writes execution_mode='paper' (Option 2 E.2).
 */
async function insertOpenPaperTrade({
  botInstanceId,
  symbol,
  direction,
  entryPrice,
  stopPrice,
  targetPrice,
  lotSize,
  finalAppliedPositionRisk,
  conditions = null,
  openedAt = new Date(),
  assetClass = 'forex_gold',
}) {
  const result = await pool.query(
    `INSERT INTO trades
       (bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
        lot_size, final_applied_position_risk, status, opened_at, conditions, execution_mode,
        asset_class)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10::jsonb, 'paper', $11)
     RETURNING ${TRADE_RETURNING}`,
    [
      botInstanceId,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      lotSize,
      finalAppliedPositionRisk,
      openedAt,
      conditions === null ? null : JSON.stringify(conditions),
      assetClass,
    ]
  );
  return mapTrade(result.rows[0]);
}

/**
 * Option 2 E.2 — open a broker-executed position. Requires broker_ticket
 * (MT5 ticket). execution_mode='real' written explicitly.
 */
async function insertOpenRealTrade({
  botInstanceId,
  symbol,
  direction,
  entryPrice,
  stopPrice,
  targetPrice,
  lotSize,
  finalAppliedPositionRisk,
  brokerTicket,
  conditions = null,
  openedAt = new Date(),
}) {
  if (brokerTicket == null) {
    throw new Error('insertOpenRealTrade requires brokerTicket');
  }
  const result = await pool.query(
    `INSERT INTO trades
       (bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
        lot_size, final_applied_position_risk, status, opened_at, conditions,
        execution_mode, broker_ticket)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10::jsonb, 'real', $11)
     RETURNING ${TRADE_RETURNING}`,
    [
      botInstanceId,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      lotSize,
      finalAppliedPositionRisk,
      openedAt,
      conditions === null ? null : JSON.stringify(conditions),
      brokerTicket,
    ]
  );
  return mapTrade(result.rows[0]);
}

/**
 * Resolves an open paper position once real price crosses stop or target.
 */
async function closePaperTrade(tradeId, { exitPrice, pnl, closedAt = new Date() }) {
  return closeTradeRow(tradeId, { exitPrice, pnl, closedAt });
}

/**
 * Option 2 E.2 — resolves an open real position after broker-side close
 * reconciliation. Separate name so paper call sites cannot accidentally
 * be retargeted by a real-close edit; SQL is shared via closeTradeRow.
 */
async function closeRealTrade(tradeId, { exitPrice, pnl, closedAt = new Date() }) {
  return closeTradeRow(tradeId, { exitPrice, pnl, closedAt });
}

async function closeTradeRow(tradeId, { exitPrice, pnl, closedAt }) {
  const result = await pool.query(
    `UPDATE trades
     SET exit_price = $2, pnl = $3, status = 'closed', closed_at = $4
     WHERE id = $1 AND status = 'open'
     RETURNING ${TRADE_RETURNING}`,
    [tradeId, exitPrice, pnl, closedAt]
  );
  return result.rows[0] ? mapTrade(result.rows[0]) : null;
}

async function listOpenTrades(botInstanceId) {
  const result = await pool.query(
    `SELECT ${TRADE_RETURNING}
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map(mapTrade);
}

/** System-wide open check (docs/11 §0.2) — any asset_class for this user. */
async function listOpenTradesForUser(userId) {
  const result = await pool.query(
    `SELECT ${TRADE_RETURNING}
     FROM trades
     WHERE user_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [userId]
  );
  return result.rows.map(mapTrade);
}

async function listOpenCryptoTradesForResume(botInstanceId) {
  const result = await pool.query(
    `SELECT ${TRADE_RETURNING}, conditions
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open' AND asset_class = 'crypto'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map((row) => ({ ...mapTrade(row), conditions: row.conditions ?? null }));
}

/**
 * Same rows as `listOpenTrades`, plus `conditions` for resume.
 * Includes execution_mode / broker_ticket so E.7 can reconcile real
 * tickets against the broker on Start.
 */
async function listOpenTradesForResume(botInstanceId) {
  const result = await pool.query(
    `SELECT ${TRADE_RETURNING}, conditions
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map((row) => ({ ...mapTrade(row), conditions: row.conditions ?? null }));
}

async function listClosedTradesPaginated(botInstanceId, { limit = 25, offset = 0 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT ${TRADE_RETURNING}
       FROM trades
       WHERE bot_instance_id = $1 AND status = 'closed'
       ORDER BY closed_at DESC
       LIMIT $2 OFFSET $3`,
      [botInstanceId, limit, offset]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM trades WHERE bot_instance_id = $1 AND status = 'closed'`,
      [botInstanceId]
    ),
  ]);
  return { rows: rows.rows.map(mapTrade), total: count.rows[0].n };
}

async function loadTradeHistoryForLearning(botInstanceId, { limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT pnl, conditions
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'closed'
     ORDER BY closed_at DESC
     LIMIT $2`,
    [botInstanceId, limit]
  );
  return result.rows
    .map((row) => {
      const pnlAmount = Number(row.pnl) || 0;
      return { wasWin: pnlAmount > 0, pnlAmount, conditions: row.conditions ?? null };
    })
    .reverse();
}

module.exports = {
  mapTrade,
  insertClosedPaperTrade,
  insertOpenPaperTrade,
  insertOpenRealTrade,
  closePaperTrade,
  closeRealTrade,
  listOpenTrades,
  listOpenTradesForUser,
  listOpenTradesForResume,
  listOpenCryptoTradesForResume,
  listClosedTradesPaginated,
  loadTradeHistoryForLearning,
};
