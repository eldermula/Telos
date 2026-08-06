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
  };
}

/**
 * Paper-mode closed trade — harness simulates fill + exit in one cycle.
 */
async function insertClosedPaperTrade({
  botInstanceId,
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
       (bot_instance_id, origin, direction, entry_price, stop_price, target_price,
        exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, 'closed', $9, $10, $11)
     RETURNING id, bot_instance_id, origin, direction, entry_price, stop_price, target_price,
               exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl`,
    [
      botInstanceId,
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
 * GET /trading/positions (06 Section 6) — open trades. Currently always
 * empty under the paper harness: runTradeCycle simulates a full
 * open-to-exit outcome per tick (bot/apirs/src/paperTradingHarness.js
 * Section 11 payoff note), so no trade row is ever left `open`. Real
 * open positions arrive once 4.6 wires actual MT5 order placement.
 */
async function listOpenTrades(botInstanceId) {
  const result = await pool.query(
    `SELECT id, bot_instance_id, origin, direction, entry_price, stop_price, target_price,
            exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map(mapTrade);
}

/**
 * GET /trading/history (06 Section 6) — paginated closed trade history.
 */
async function listClosedTradesPaginated(botInstanceId, { limit = 25, offset = 0 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, bot_instance_id, origin, direction, entry_price, stop_price, target_price,
              exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl
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

/**
 * Reconstruct APIRS learning-engine history from recent closed trades
 * (wasWin inferred from pnl).
 */
async function loadTradeHistoryForLearning(botInstanceId, { limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT pnl
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'closed'
     ORDER BY closed_at ASC
     LIMIT $2`,
    [botInstanceId, limit]
  );
  return result.rows.map((row) => {
    const pnlAmount = Number(row.pnl) || 0;
    return { wasWin: pnlAmount > 0, pnlAmount, conditions: null };
  });
}

module.exports = {
  mapTrade,
  insertClosedPaperTrade,
  listOpenTrades,
  listClosedTradesPaginated,
  loadTradeHistoryForLearning,
};
