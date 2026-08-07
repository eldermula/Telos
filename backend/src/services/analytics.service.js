'use strict';

const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const tradingEngine = require('../engine/trading-engine');
const { parseRange } = require('./portfolio.service');

/**
 * GET /analytics/trading-metrics — computed from closed trades +
 * current bot_instance equity snapshot. Metric set was left open in
 * the SRS; this ships a concrete, useful starter set:
 * win_rate, net_pnl, avg_win, avg_loss, profit_factor, max_drawdown_pct
 * (from the session's peak_equity vs active_trading_balance — live
 * account drawdown, not a reconstructed trade-equity curve), and a
 * cumulative P&L series.
 */
async function getTradingMetrics(userId, rangeParam) {
  const { range, since } = parseRange(rangeParam);

  let instance;
  try {
    instance = await tradingEngine.ensureBotInstance(userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_BROKER_CONNECTION') {
      return emptyTradingMetrics(range);
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
    `SELECT pnl, closed_at, symbol
     FROM trades
     WHERE bot_instance_id = $1 AND status = 'closed'${sinceClause}
     ORDER BY closed_at ASC`,
    params
  );

  let netPnl = 0;
  let winPnl = 0;
  let lossPnl = 0;
  let wins = 0;
  let losses = 0;
  let cumulative = 0;
  const series = [];
  for (const row of result.rows) {
    const pnl = Number(row.pnl) || 0;
    netPnl += pnl;
    cumulative += pnl;
    if (pnl > 0) {
      wins += 1;
      winPnl += pnl;
    } else if (pnl < 0) {
      losses += 1;
      lossPnl += pnl;
    }
    series.push({
      closed_at: row.closed_at,
      symbol: row.symbol,
      pnl,
      cumulative_pnl: Number(cumulative.toFixed(4)),
    });
  }

  const tradeCount = result.rows.length;
  const avgWin = wins === 0 ? null : Number((winPnl / wins).toFixed(4));
  const avgLoss = losses === 0 ? null : Number((lossPnl / losses).toFixed(4));
  const profitFactor =
    lossPnl === 0 ? (winPnl > 0 ? null : 0) : Number((winPnl / Math.abs(lossPnl)).toFixed(4));

  const balance = Number(instance.active_trading_balance);
  const peak = Number(instance.peak_equity);
  const maxDrawdownPct =
    peak > 0 ? Number(Math.max(0, (peak - balance) / peak).toFixed(4)) : 0;

  return {
    range,
    since: since ? since.toISOString() : null,
    metrics: {
      trade_count: tradeCount,
      wins,
      losses,
      win_rate: tradeCount === 0 ? null : Number((wins / tradeCount).toFixed(4)),
      net_pnl: Number(netPnl.toFixed(4)),
      avg_win: avgWin,
      avg_loss: avgLoss,
      profit_factor: profitFactor,
      active_trading_balance: balance,
      peak_equity: peak,
      current_drawdown_pct: maxDrawdownPct,
    },
    series,
  };
}

function emptyTradingMetrics(range) {
  return {
    range,
    since: null,
    metrics: {
      trade_count: 0,
      wins: 0,
      losses: 0,
      win_rate: null,
      net_pnl: 0,
      avg_win: null,
      avg_loss: null,
      profit_factor: null,
      active_trading_balance: null,
      peak_equity: null,
      current_drawdown_pct: null,
    },
    series: [],
  };
}

/**
 * GET /analytics/business-metrics — FR-ANLY-2 firm/consultant analytics.
 * Intentionally not inventing a metric set: SRS left this open and this
 * project has no multi-tenant firm entity yet. Returns a stable envelope
 * with `available: false` so the Frontend can render an honest empty
 * state without a 501 crash. Flagged in CHANGELOG as a pending decision.
 */
async function getBusinessMetrics(_userId) {
  return {
    available: false,
    reason:
      'Business-level analytics (FR-ANLY-2) are not defined yet — no firm/consultant entity or metric set has been confirmed.',
    metrics: null,
  };
}

module.exports = {
  getTradingMetrics,
  getBusinessMetrics,
};
