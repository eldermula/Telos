'use strict';

const path = require('path');

const marketIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'market-intelligence', 'src');
const { evaluateMarketIntelligence, InsufficientDataError } = require(
  path.join(marketIntelligencePath, 'marketIntelligence.js')
);

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { selectTrade } = require(path.join(strategyEnginePath, 'selectTrade.js'));
const {
  computeStopTarget,
  DEFAULT_ATR_STOP_MULTIPLE,
  DEFAULT_REWARD_RISK_RATIO,
} = require(path.join(strategyEnginePath, 'stopTarget.js'));

const { computeSyntheticRawLotSize, clampLotSize } = require('./synthetic-lot-clamp');

const tierMatrixPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src', 'tierMatrix.js');
const { bootstrapRiskPct, TIER_MATRIX, BOOTSTRAP_UPPER_BALANCE } = require(tierMatrixPath);

/**
 * M1 PAPER-ONLY EXPERIMENT (docs/15_M1_Forex_Paper_Experiment.md).
 * Pure math — no network, no DB, no MT5 connector calls — and deliberately
 * imports NOTHING related to real order dispatch.
 *
 * Session A (2026-08-11) showed 6/6 USDCAD stop-outs within one 15s tick
 * because 1.5×ATR(14) on M1 sat inside the live bid/ask spread. M1 stops
 * are therefore spread-aware:
 *   stop_distance = max(1.5×ATR14, SPREAD_STOP_MULTIPLE × live_spread)
 *
 * SPREAD_STOP_MULTIPLE = 2.0 chosen from live spread samples the same
 * session: for a BUY filled at ask, the bid is already `spread` worse,
 * so a floor of 1.0×spread is already at/through the stop at entry.
 * 2.0× clears the book and leaves one full spread of buffer for
 * within-tick noise. Observed (8 samples): EURUSD~1.3e-4, USDCAD~1.5e-4,
 * XAUUSD~0.18 — FX M1 ATR stops were 0.24–0.55× mean spread; XAU was
 * already ~18× and is unaffected by the floor.
 */

/** Minimum stop as a multiple of live (ask − bid). See file header. */
const SPREAD_STOP_MULTIPLE = 2.0;

function isGoldFamilySymbol(symbol) {
  return typeof symbol === 'string' && /^XAU/i.test(symbol.trim());
}

function resolveContractSize(symbol, symbolInfo) {
  const fromInfo = Number(symbolInfo && symbolInfo.trade_contract_size);
  if (fromInfo > 0) return fromInfo;
  return isGoldFamilySymbol(symbol) ? 100 : 100000;
}

function computeAppliedRisk(balance) {
  const bal = Number(balance);
  if (!(bal > 0)) {
    throw new RangeError(`balance must be a positive number, got ${balance}`);
  }
  if (bal < BOOTSTRAP_UPPER_BALANCE) return bootstrapRiskPct(bal);
  return TIER_MATRIX[0].maxRiskCeiling;
}

function liveSpread(symbolInfo) {
  const bid = Number(symbolInfo && symbolInfo.bid);
  const ask = Number(symbolInfo && symbolInfo.ask);
  if (!(bid > 0) || !(ask > bid)) return null;
  return ask - bid;
}

/**
 * Spread-aware M1 stop distance.
 * @returns {{
 *   stopDistance: number,
 *   atrStopDistance: number,
 *   spreadFloor: number|null,
 *   spread: number|null,
 *   flooredBySpread: boolean
 * }}
 */
function resolveM1StopDistance({ currentATR, stopRule, symbolInfo }) {
  const atrMultiple = stopRule?.multiple ?? DEFAULT_ATR_STOP_MULTIPLE;
  const atrStopDistance = Number(currentATR) * atrMultiple;
  const spread = liveSpread(symbolInfo);
  const spreadFloor = spread != null ? SPREAD_STOP_MULTIPLE * spread : null;
  const stopDistance =
    spreadFloor != null && Number.isFinite(spreadFloor)
      ? Math.max(atrStopDistance, spreadFloor)
      : atrStopDistance;
  return {
    stopDistance,
    atrStopDistance,
    spreadFloor,
    spread,
    flooredBySpread: spreadFloor != null && stopDistance > atrStopDistance + 1e-15,
  };
}

function pricesFromStopDistance({ entryPrice, direction, stopDistance, targetRule }) {
  const sign = direction === 'BUY' ? 1 : -1;
  const rewardRiskRatio = targetRule?.ratio ?? DEFAULT_REWARD_RISK_RATIO;
  return {
    stopPrice: entryPrice - sign * stopDistance,
    targetPrice: entryPrice + sign * stopDistance * rewardRiskRatio,
    stopDistance,
  };
}

/**
 * One evaluation across the whole watchlist for one tick.
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

  // ATR baseline (same helper as M5) then apply the M1 spread floor.
  const atrBaseline = computeStopTarget({
    entryPrice,
    direction,
    currentATR: selection.marketIntelligence.diagnostics.currentATR,
    stopRule: selection.stopRule,
    targetRule: selection.targetRule,
  });
  const resolved = resolveM1StopDistance({
    currentATR: selection.marketIntelligence.diagnostics.currentATR,
    stopRule: selection.stopRule,
    symbolInfo,
  });
  const { stopPrice, targetPrice, stopDistance } = pricesFromStopDistance({
    entryPrice,
    direction,
    stopDistance: resolved.stopDistance,
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
      atrStopDistance: atrBaseline.stopDistance,
      spreadFloor: resolved.spreadFloor,
      flooredBySpread: resolved.flooredBySpread,
      lotSize: clamp.size,
      contractSize,
      appliedRisk,
      dollarRisk: raw.dollarRisk,
      balanceSnapshot: balance,
    },
    dataErrors,
  };
}

function evaluateM1Monitor(trade, symbolInfo) {
  if (!symbolInfo || symbolInfo.bid == null || symbolInfo.ask == null) return null;

  const price = trade.direction === 'BUY' ? symbolInfo.bid : symbolInfo.ask;
  const sign = trade.direction === 'BUY' ? 1 : -1;

  const hitTarget = trade.direction === 'BUY' ? price >= trade.targetPrice : price <= trade.targetPrice;
  const hitStop = trade.direction === 'BUY' ? price <= trade.stopPrice : price >= trade.stopPrice;

  if (!hitTarget && !hitStop) return null;

  const closePrice = hitTarget ? trade.targetPrice : trade.stopPrice;
  const pnl = sign * (closePrice - trade.entryPrice) * trade.lotSize * trade.contractSize;

  return { outcome: hitTarget ? 'target_hit' : 'stop_hit', closePrice, pnl };
}

module.exports = {
  SPREAD_STOP_MULTIPLE,
  computeAppliedRisk,
  resolveContractSize,
  isGoldFamilySymbol,
  liveSpread,
  resolveM1StopDistance,
  pricesFromStopDistance,
  evaluateM1Tick,
  evaluateM1Monitor,
};
