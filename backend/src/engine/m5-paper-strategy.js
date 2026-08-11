'use strict';

const path = require('path');

const marketIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'market-intelligence', 'src');
const { evaluateMarketIntelligence, InsufficientDataError } = require(
  path.join(marketIntelligencePath, 'marketIntelligence.js')
);

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { selectTrade } = require(path.join(strategyEnginePath, 'selectTrade.js'));
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

const { computeSyntheticRawLotSize, clampLotSize } = require('./synthetic-lot-clamp');

const tierMatrixPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src', 'tierMatrix.js');
const { bootstrapRiskPct, TIER_MATRIX, BOOTSTRAP_UPPER_BALANCE } = require(tierMatrixPath);

/**
 * M5 PAPER-ONLY EXPERIMENT (docs/14_M5_Forex_Paper_Experiment.md,
 * 2026-08-11 M5 probe report). This module is pure math — no network,
 * no DB, no MT5 connector calls — and deliberately imports NOTHING
 * related to real order dispatch: not `real-lot-sizing.js` (used by
 * bot-runtime.js's `_maybeOpenPositionReal`), not the MT5 connector's
 * `placeOrder`/`closeOrder`, not `bot-runtime.js`, not
 * `REAL_TRADING_ENABLED`/confirm-live/admin real-dispatch config. There
 * is no code path in this file that could ever place a real order —
 * that's a structural guarantee, not a runtime check.
 *
 * Unlike bot-runtime.js's standard forex paper mode (`_maybeOpenPositionPaper`),
 * which uses a placeholder `lotSize = appliedRisk * 0.1` that is never
 * clamp-skipped, this experiment deliberately reproduces REAL MT5 lot-
 * sizing mechanics (`dollar_risk / (stop_distance * contract_size)`,
 * then `clampLotSize`) so the M5 probe's clamp-skip finding — XAUUSD/
 * USDJPY not viable at $5/$10 even on M5's tighter stops — can actually
 * be exercised here. The whole point of this build is measuring whether
 * M5 would behave sanely if real dispatch were ever enabled for it
 * (a separate, future, human-reviewed decision), without ever placing
 * a real order to find out.
 */

function isGoldFamilySymbol(symbol) {
  return typeof symbol === 'string' && /^XAU/i.test(symbol.trim());
}

/**
 * Mirrors real-lot-sizing.js's symbol-aware fallback table without
 * importing that module (kept duplicated on purpose — see file header:
 * this module must not import anything from the real-dispatch path).
 */
function resolveContractSize(symbol, symbolInfo) {
  const fromInfo = Number(symbolInfo && symbolInfo.trade_contract_size);
  if (fromInfo > 0) return fromInfo;
  return isGoldFamilySymbol(symbol) ? 100 : 100000;
}

/**
 * Same bootstrap-region assumption used throughout the M15/M5 probes:
 * `bootstrapRiskPct` below $50, Tier 0's ceiling (0.30) at/above $50.
 * This experiment has no live bot-instance/tier state of its own (it
 * is not wired to `bot_instances` at all — see harness file), so it
 * cannot run the full standard-tier riskScore machinery. This matches
 * the probe method exactly, not a new approximation invented for this
 * build.
 */
function computeAppliedRisk(balance) {
  const bal = Number(balance);
  if (!(bal > 0)) {
    throw new RangeError(`balance must be a positive number, got ${balance}`);
  }
  if (bal < BOOTSTRAP_UPPER_BALANCE) return bootstrapRiskPct(bal);
  return TIER_MATRIX[0].maxRiskCeiling;
}

/**
 * One evaluation across the whole watchlist for one tick — mirrors
 * `strategy-selection.service.js`'s `selectTradeAcrossWatchlist` shape
 * (same `selectTrade` call, same one-candidate-system-wide design) but
 * fed by whatever bars/symbolInfo the caller already fetched (M5 in
 * this build) instead of the shared M15 cache. News intelligence is
 * deliberately omitted — `ruleEngine.evaluateStrategy`'s regime_fit /
 * signal logic never reads it; only `selectTrade`'s result shape
 * carries it through for callers like the live engine that log it.
 *
 * @param {object} args
 * @param {Array<{ symbol: string, bars: object[], symbolInfo: object }>} args.instruments
 * @param {object[]} args.strategies - candidate_strategies rows (status='active')
 * @param {number} args.balance - live equity snapshot for this tick (read-only)
 */
function evaluateM5Tick({ instruments, strategies, balance }) {
  const instrumentContexts = [];
  const dataErrors = [];

  for (const { symbol, bars, symbolInfo } of instruments) {
    try {
      const marketIntelligence = evaluateMarketIntelligence(bars);
      instrumentContexts.push({ symbol, marketIntelligence, bars, symbolInfo });
    } catch (err) {
      const reason = err instanceof InsufficientDataError ? 'insufficient_data' : err.message;
      dataErrors.push({ symbol, reason });
    }
  }

  const selection = selectTrade(strategies, instrumentContexts);
  if (!selection) {
    return { outcome: 'no_signal', dataErrors };
  }

  const chosenCtx = instrumentContexts.find((ctx) => ctx.symbol === selection.chosen_instrument);
  const symbolInfo = chosenCtx ? chosenCtx.symbolInfo : null;
  if (!symbolInfo || symbolInfo.bid == null || symbolInfo.ask == null) {
    return { outcome: 'no_price', symbol: selection.chosen_instrument, dataErrors };
  }

  const direction = selection.direction;
  const entryPrice = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
  const { stopPrice, targetPrice, stopDistance } = computeStopTarget({
    entryPrice,
    direction,
    currentATR: selection.marketIntelligence.diagnostics.currentATR,
    stopRule: selection.stopRule,
    targetRule: selection.targetRule,
  });

  const appliedRisk = computeAppliedRisk(balance);
  const contractSize = resolveContractSize(selection.chosen_instrument, symbolInfo);

  const raw = computeSyntheticRawLotSize({
    effectiveBalance: balance,
    appliedRisk,
    entryPrice,
    stopPrice,
    contractSize,
  });

  if (raw.reason) {
    // invalid_inputs / zero_stop_distance / invalid_raw_lot — a math
    // precondition failure, distinct from a healthy calc that simply
    // rounds below volume_min.
    return {
      outcome: 'sizing_error',
      symbol: selection.chosen_instrument,
      direction,
      reason: raw.reason,
      dataErrors,
    };
  }

  const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
  if (clamp.skipped) {
    return {
      outcome: 'skipped_below_volume_min',
      symbol: selection.chosen_instrument,
      direction,
      strategyName: selection.strategy_name,
      reason: clamp.reason,
      rawLotSize: raw.rawLotSize,
      volumeMin: symbolInfo.volume_min,
      balance,
      appliedRisk,
      dataErrors,
    };
  }

  return {
    outcome: 'opened',
    trade: {
      symbol: selection.chosen_instrument,
      direction,
      strategyName: selection.strategy_name,
      strategyId: selection.strategy_id,
      confidence: selection.strategy_confidence,
      entryPrice,
      stopPrice,
      targetPrice,
      stopDistance,
      lotSize: clamp.size,
      contractSize,
      appliedRisk,
      dollarRisk: raw.dollarRisk,
      balanceSnapshot: balance,
    },
    dataErrors,
  };
}

/**
 * Monitor one open paper trade against a live symbolInfo tick. Pure —
 * never touches the broker, only reads bid/ask already fetched by the
 * caller.
 */
function evaluateM5Monitor(trade, symbolInfo) {
  if (!symbolInfo || symbolInfo.bid == null || symbolInfo.ask == null) return null;

  const price = trade.direction === 'BUY' ? symbolInfo.bid : symbolInfo.ask;
  const sign = trade.direction === 'BUY' ? 1 : -1;

  const hitTarget = trade.direction === 'BUY' ? price >= trade.targetPrice : price <= trade.targetPrice;
  const hitStop = trade.direction === 'BUY' ? price <= trade.stopPrice : price >= trade.stopPrice;

  if (!hitTarget && !hitStop) return null;

  // Target checked first: on the same tick both could technically be
  // true only if price gapped through both levels — resolving to the
  // target is the conservative (non-pessimistic) simulation choice for
  // a paper-only measurement tool, not a claim about real fill order.
  const closePrice = hitTarget ? trade.targetPrice : trade.stopPrice;
  const pnl = sign * (closePrice - trade.entryPrice) * trade.lotSize * trade.contractSize;

  return { outcome: hitTarget ? 'target_hit' : 'stop_hit', closePrice, pnl };
}

module.exports = {
  computeAppliedRisk,
  resolveContractSize,
  isGoldFamilySymbol,
  evaluateM5Tick,
  evaluateM5Monitor,
};
