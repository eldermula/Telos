'use strict';

const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const tradingEngine = require('../engine/trading-engine');

const RANGE_MS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  all: null,
};

function parseRange(rangeParam) {
  const range = rangeParam || '30d';
  if (!(range in RANGE_MS)) {
    throw new AppError(422, 'VALIDATION_ERROR', `Invalid range '${range}'`, {
      allowed: Object.keys(RANGE_MS),
    });
  }
  const windowMs = RANGE_MS[range];
  const since =
    windowMs == null ? null : new Date(Date.now() - windowMs);
  return { range, since };
}

/**
 * GET /portfolio/holdings — derived from open trades (05 §4 / 06 §8).
 * One open position at a time in V1, but grouped by symbol so the
 * response shape stays correct if that rule ever changes.
 */
async function getHoldings(userId) {
  let instance;
  try {
    instance = await tradingEngine.ensureBotInstance(userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_BROKER_CONNECTION') {
      return { holdings: [], as_of: new Date().toISOString() };
    }
    throw err;
  }

  const result = await pool.query(
    `SELECT symbol, direction, entry_price, stop_price, target_price,
            lot_size, final_applied_position_risk, opened_at, id
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'open'
     ORDER BY opened_at DESC`,
    [instance.id]
  );

  const bySymbol = new Map();
  for (const row of result.rows) {
    const existing = bySymbol.get(row.symbol) || {
      symbol: row.symbol,
      positions: [],
      net_direction: null,
      lot_size: 0,
    };
    existing.positions.push({
      id: row.id,
      direction: row.direction,
      entry_price: Number(row.entry_price),
      stop_price: Number(row.stop_price),
      target_price: Number(row.target_price),
      lot_size: Number(row.lot_size),
      final_applied_position_risk: Number(row.final_applied_position_risk),
      opened_at: row.opened_at,
    });
    const signed = row.direction === 'BUY' ? Number(row.lot_size) : -Number(row.lot_size);
    existing.lot_size += signed;
    bySymbol.set(row.symbol, existing);
  }

  const holdings = [...bySymbol.values()].map((h) => ({
    symbol: h.symbol,
    net_lot_size: Number(h.lot_size.toFixed(4)),
    net_direction:
      h.lot_size > 0 ? 'BUY' : h.lot_size < 0 ? 'SELL' : 'FLAT',
    open_count: h.positions.length,
    positions: h.positions,
  }));

  return { holdings, as_of: new Date().toISOString() };
}

/**
 * GET /portfolio/performance?range= — closed-trade P&L over a window.
 * `series` is one point per closed trade (cumulative), enough for a
 * simple equity-from-trades chart without inventing a denser series.
 */
async function getPerformance(userId, rangeParam) {
  const { range, since } = parseRange(rangeParam);

  let instance;
  try {
    instance = await tradingEngine.ensureBotInstance(userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_BROKER_CONNECTION') {
      return emptyPerformance(range);
    }
    throw err;
  }

  const params = [instance.id];
  let sinceClause = '';
  if (since) {
    params.push(since);
    sinceClause = ` AND closed_at >= $${params.length}`;
  }

  const result = await pool.query(
    `SELECT id, symbol, direction, pnl, opened_at, closed_at
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'closed'${sinceClause}
     ORDER BY closed_at ASC`,
    params
  );

  let cumulative = 0;
  let wins = 0;
  let losses = 0;
  const series = [];
  for (const row of result.rows) {
    const pnl = Number(row.pnl) || 0;
    cumulative += pnl;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
    series.push({
      trade_id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      pnl,
      cumulative_pnl: Number(cumulative.toFixed(4)),
      closed_at: row.closed_at,
    });
  }

  const tradeCount = result.rows.length;
  return {
    range,
    since: since ? since.toISOString() : null,
    summary: {
      trade_count: tradeCount,
      wins,
      losses,
      win_rate: tradeCount === 0 ? null : Number((wins / tradeCount).toFixed(4)),
      net_pnl: Number(cumulative.toFixed(4)),
    },
    series,
  };
}

function emptyPerformance(range) {
  return {
    range,
    since: null,
    summary: {
      trade_count: 0,
      wins: 0,
      losses: 0,
      win_rate: null,
      net_pnl: 0,
    },
    series: [],
  };
}

module.exports = {
  getHoldings,
  getPerformance,
  parseRange,
};
