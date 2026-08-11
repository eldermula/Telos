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
 * M1 PAPER-ONLY EXPERIMENT (docs/15_M1_Forex_Paper_Experiment.md).
 * Pure math — no network, no DB, no MT5 connector calls — and deliberately
 * imports NOTHING related to real order dispatch: not `real-lot-sizing.js`,
 * not the MT5 connector's `placeOrder`/`closeOrder`, not `bot-runtime.js`,
 * not `REAL_TRADING_ENABLED`/confirm-live/admin real-dispatch config, and
 * not any M5 real-dispatch module. There is no code path in this file that
 * could ever place a real order — that's a structural guarantee, not a
 * runtime check.
 *
 * Mirrors `m5-paper-strategy.js` exactly (same clampLotSize path, same
 * bootstrap risk curve, same selectTrade/computeStopTarget) so the only
 * intentional difference between M5-paper and M1-paper is the candle
 * timeframe the harness feeds in.
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
 * Same bootstrap-region assumption used throughout the M15/M5/M1 probes:
 * `bootstrapRiskPct` below $50, Tier 0's ceiling (0.30) at/above $50.
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
 * `m5-paper-strategy.js`'s `evaluateM5Tick` shape, fed by whatever
 * bars/symbolInfo the caller already fetched (M1 in this build).
 *
 * @param {object} args
 * @param {Array<{ symbol: string, bars: object[], symbolInfo: object }>} args.instruments
 * @param {object[]} args.strategies - candidate_strategies rows (status='active')
 * @param {number} args.balance - live equity snapshot for this tick (read-only)
 */
function evaluateM1Tick({ instruments, strategies, balance }) {
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
function evaluateM1Monitor(trade, symbolInfo) {
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
  evaluateM1Tick,
  evaluateM1Monitor,
};
