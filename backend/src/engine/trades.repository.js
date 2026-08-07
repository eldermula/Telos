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
  };
}

/**
 * Paper-mode closed trade — harness simulates fill + exit in one cycle.
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
        exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, $9, 'closed', $10, $11, $12)
     RETURNING id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
               exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl`,
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
 * `symbol` (6.4) records which watchlist instrument Module 4 Selection
 * actually chose — required, not inferred, since Selection can pick
 * any of the 6 watchlist instruments per trade.
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
}) {
  const result = await pool.query(
    `INSERT INTO trades
       (bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
        lot_size, final_applied_position_risk, status, opened_at, conditions)
     VALUES ($1, 'bot', $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10::jsonb)
     RETURNING id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
               exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl`,
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
    ]
  );
  return mapTrade(result.rows[0]);
}

/**
 * Resolves an open position once real price crosses stop or target.
 */
async function closePaperTrade(tradeId, { exitPrice, pnl, closedAt = new Date() }) {
  const result = await pool.query(
    `UPDATE trades
     SET exit_price = $2, pnl = $3, status = 'closed', closed_at = $4
     WHERE id = $1 AND status = 'open'
     RETURNING id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
               exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl`,
    [tradeId, exitPrice, pnl, closedAt]
  );
  return result.rows[0] ? mapTrade(result.rows[0]) : null;
}

/**
 * GET /trading/positions (06 Section 6) — open trades. Prior to Phase
 * 6.1 this was always empty: runTradeCycle simulated a full
 * open-to-exit outcome per tick (bot/apirs/src/paperTradingHarness.js's
 * former single-call convention), so no trade row was ever left `open`.
 * Phase 6.1's position monitor now leaves a real row open until price
 * resolves it.
 */
async function listOpenTrades(botInstanceId) {
  const result = await pool.query(
    `SELECT id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
            exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map(mapTrade);
}

/**
 * Same rows as `listOpenTrades`, plus the real `conditions` (006)
 * column read back verbatim. Internal only — `bot-runtime.js`'s
 * `initialize()` restart-resume needs the real conditions object to
 * repopulate `this.openPosition`; the public `GET /trading/positions`
 * path (`trading.service.js`'s `getPositions`, via `listOpenTrades`)
 * deliberately never exposes `conditions`, per the 6.5 design's
 * internal-use-only deferral — hence a separate function rather than
 * adding it to `mapTrade`'s general-purpose shape.
 */
async function listOpenTradesForResume(botInstanceId) {
  const result = await pool.query(
    `SELECT id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
            exit_price, lot_size, final_applied_position_risk, status, opened_at, closed_at, pnl, conditions
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [botInstanceId]
  );
  return result.rows.map((row) => ({ ...mapTrade(row), conditions: row.conditions ?? null }));
}

/**
 * GET /trading/history (06 Section 6) — paginated closed trade history.
 */
async function listClosedTradesPaginated(botInstanceId, { limit = 25, offset = 0 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, bot_instance_id, origin, symbol, direction, entry_price, stop_price, target_price,
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
 * (wasWin inferred from pnl). `conditions` (006) is read back verbatim —
 * always null on trades closed before 006, real data going forward.
 *
 * Ordered `closed_at DESC LIMIT` (cheapest way to get the most recent N
 * rows) then reversed in JS: recordTradeOutcome/computeConsecutiveLosses
 * assume chronological oldest-first, most-recent-last ordering
 * (consecutive-loss counting walks backward from the array's end
 * expecting the last entry to be the most recent) — a plain `ASC LIMIT`
 * would instead return the *oldest* 50 trades ever, permanently stale
 * for any account with more than 50 historical trades.
 */
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
  closePaperTrade,
  listOpenTrades,
  listOpenTradesForResume,
  listClosedTradesPaginated,
  loadTradeHistoryForLearning,
};
