'use strict';

/**
 * XAUUSD VWAP p90 LIVE real-dispatch (docs/17_XAU_VWAP_Live_Strategy.md).
 *
 * CONTROLLED REAL-MONEY TESTING — this module CAN place real orders once
 * Layers 0–3 are armed. It generates intent via evaluateXauVwapLiveTick and
 * submits ONLY through the existing approved connector placeOrder/closeOrder
 * path. No alternate broker SDK, no bypass of risk/authorization/kill-switch.
 *
 * Safety layers (same shape as m5-real-dispatch / bot-runtime):
 *   Layer 0 — account-info pre-check + expectedAccountType for placeOrder
 *   Layer 1 — XAU_VWAP_LIVE_TRADING_ENABLED (env; harness-checked)
 *   Layer 2 — bot_instances.xau_vwap_live_trading_confirmed_at
 *   Layer 3 — xau_vwap_demo_dispatch_config (demo bypass)
 * Plus: one_open_trade_per_user, halt_new_opens (emergency stop), REAL_MAX_LOT
 *
 * Scope: XAUUSD M5 only. Close detection is broker-authoritative.
 */

const {
  SYMBOL,
  STRATEGY_NAME,
  evaluateXauVwapLiveTick,
  buildLiveMarketSnapshot,
} = require('./xau-vwap-live-strategy');
const { resolveExpectedAccountTypeForLayer0 } = require('./execution-mode');
const { isConnectionFresh } = require('./connection-freshness');
const { REAL_MAX_LOT } = require('../config/env');

const ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS = 400;
const REAL_HISTORY_RETRY_TICKS = 3;
const ASSET_CLASS = 'xau_vwap_live';
const TIMEFRAME = 'M5';
const RATES_COUNT = 120;

async function readMatchedAccountInfoWithRetry(deps) {
  try {
    return await deps.getMatchedAccountInfo(deps.botInstanceId);
  } catch (firstErr) {
    console.warn(
      '[xau-vwap-live-dispatch] account-info pre-check failed; one read-only retry ' +
        `after ${ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS}ms (not placeOrder)`,
      { message: firstErr.message, code: firstErr.code || null }
    );
    await new Promise((r) => setTimeout(r, ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS));
    try {
      return await deps.getMatchedAccountInfo(deps.botInstanceId);
    } catch (err) {
      const wrapped = new Error(err.message);
      wrapped.code = err.code || null;
      wrapped.retried = true;
      wrapped.firstError = firstErr.message;
      throw wrapped;
    }
  }
}

/**
 * One open-attempt tick. Never throws — returns { outcome, halt, ... }.
 */
async function attemptOpen(deps) {
  if (deps.haltNewOpens === true) {
    return {
      outcome: 'emergency_stop_active',
      halt: true,
      details: { halt_new_opens: true },
    };
  }

  let accountInfo;
  try {
    accountInfo = await readMatchedAccountInfoWithRetry(deps);
  } catch (err) {
    return {
      outcome: 'account_info_unavailable',
      halt: true,
      details: {
        message: err.message,
        code: err.code || null,
        retried: true,
        first_error: err.firstError || null,
      },
    };
  }

  if (!isConnectionFresh(accountInfo.last_validated_at, deps.maxAgeHours, deps.now())) {
    return {
      outcome: 'stale_broker_connection',
      halt: true,
      details: {
        last_validated_at: accountInfo.last_validated_at,
        max_age_hours: deps.maxAgeHours,
      },
    };
  }

  const equity = Number(accountInfo.equity);
  if (!(equity > 0)) {
    return { outcome: 'invalid_live_equity', halt: true, details: { equity: accountInfo.equity } };
  }

  const openElsewhere = await deps.listOpenTradesForUser(deps.userId);
  if (openElsewhere.length > 0) {
    return {
      outcome: 'one_open_trade_blocked',
      halt: false,
      details: { open_trade_ids: openElsewhere.map((t) => t.id) },
    };
  }

  let bars;
  let symbolInfo;
  try {
    const [ratesResult, info] = await Promise.all([
      deps.getRates(SYMBOL, { timeframe: TIMEFRAME, count: RATES_COUNT }),
      deps.getSymbolInfo(SYMBOL),
    ]);
    bars = ratesResult.bars;
    symbolInfo = info;
  } catch (err) {
    return {
      outcome: 'no_data',
      halt: false,
      details: { symbol: SYMBOL, reason: err.message },
    };
  }

  const decision = evaluateXauVwapLiveTick({
    bars,
    symbolInfo,
    balance: equity,
    now: deps.now,
  });

  // Always refresh market snapshot for admin UI (even on no_signal).
  const snapshot = buildLiveMarketSnapshot({ bars, symbolInfo });

  if (
    decision.outcome === 'no_signal' ||
    decision.outcome === 'no_price' ||
    decision.outcome === 'insufficient_bars' ||
    decision.outcome === 'data_error' ||
    decision.outcome === 'stale_market_data' ||
    decision.outcome === 'invalid_spread' ||
    decision.outcome === 'invalid_stop'
  ) {
    return {
      outcome: decision.outcome,
      halt: false,
      details: { ...decision, marketSnapshot: snapshot.ok ? snapshot : null },
      marketSnapshot: snapshot.ok ? snapshot : null,
    };
  }
  if (decision.outcome === 'sizing_error') {
    return {
      outcome: 'sizing_error',
      halt: false,
      details: {
        symbol: decision.symbol,
        direction: decision.direction,
        reason: decision.reason,
      },
      marketSnapshot: snapshot.ok ? snapshot : null,
    };
  }
  if (decision.outcome === 'skipped_below_volume_min') {
    return {
      outcome: 'skipped_below_volume_min',
      halt: false,
      details: {
        symbol: decision.symbol,
        direction: decision.direction,
        strategyName: decision.strategyName,
        reason: decision.reason,
        balance: decision.balance,
      },
      marketSnapshot: snapshot.ok ? snapshot : null,
    };
  }

  const trade = decision.trade;
  const cappedLot = Math.min(Number(trade.lotSize), REAL_MAX_LOT);
  if (!(cappedLot > 0)) {
    return {
      outcome: 'sizing_error',
      halt: false,
      details: { symbol: trade.symbol, reason: 'real_max_lot_zero', lotSize: trade.lotSize },
    };
  }
  trade.lotSize = cappedLot;

  const expectedAccountType = resolveExpectedAccountTypeForLayer0(accountInfo.account_type);

  const placeStarted = Date.now();
  let placeResult;
  try {
    placeResult = await deps.placeOrder({
      symbol: trade.symbol,
      direction: trade.direction,
      volume: trade.lotSize,
      sl: trade.stopPrice,
      tp: trade.targetPrice,
      expectedAccountType,
    });
  } catch (err) {
    return {
      outcome: 'place_order_failed',
      halt: true,
      details: {
        message: err.message,
        code: err.code || null,
        details: err.details || null,
        symbol: trade.symbol,
        direction: trade.direction,
        volume: trade.lotSize,
        expected_account_type: expectedAccountType,
        detected_account_type: accountInfo.account_type,
        latency_ms: Date.now() - placeStarted,
        signal: {
          vwap: decision.marketSnapshot?.vwap,
          p90: trade.p90Threshold,
          spread: trade.spreadAtEntry,
          atr_stop_basis: trade.stopDistance,
        },
      },
    };
  }
  const latencyMs = Date.now() - placeStarted;

  const brokerTicket = placeResult.ticket;
  const entryPrice =
    placeResult.price != null && Number(placeResult.price) > 0
      ? Number(placeResult.price)
      : trade.entryPrice;
  const lotSize =
    placeResult.volume != null && Number(placeResult.volume) > 0
      ? Number(placeResult.volume)
      : trade.lotSize;
  const slippage =
    Number.isFinite(entryPrice) && Number.isFinite(trade.entryPrice)
      ? entryPrice - trade.entryPrice
      : null;

  const conditions = {
    strategy_id: trade.strategyId,
    strategy_name: trade.strategyName,
    applied_risk: trade.appliedRisk,
    contract_size: trade.contractSize,
    balance_snapshot: trade.balanceSnapshot,
    p90_threshold: trade.p90Threshold,
    abs_dist_at_signal: trade.absDistAtSignal,
    spread_at_entry: trade.spreadAtEntry,
    floored_by_spread: trade.flooredBySpread,
    stop_distance: trade.stopDistance,
    requested_entry: trade.entryPrice,
    slippage,
  };

  let tradeRow;
  try {
    tradeRow = await deps.insertOpenRealTrade({
      botInstanceId: deps.botInstanceId,
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      lotSize,
      finalAppliedPositionRisk: trade.appliedRisk,
      brokerTicket,
      conditions,
      assetClass: ASSET_CLASS,
      origin: 'bot',
    });
  } catch (err) {
    return {
      outcome: 'post_place_persist_failed',
      halt: true,
      details: {
        message: err.message,
        broker_ticket: brokerTicket,
        symbol: trade.symbol,
        direction: trade.direction,
        lot_size: lotSize,
        entry_price: entryPrice,
        stop_price: trade.stopPrice,
        target_price: trade.targetPrice,
        phase: 'insertOpenRealTrade',
      },
      openTrade: {
        tradeRowId: null,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice,
        stopPrice: trade.stopPrice,
        targetPrice: trade.targetPrice,
        lotSize,
        contractSize: trade.contractSize,
        brokerTicket: Number(brokerTicket),
        appliedRisk: trade.appliedRisk,
        strategyName: trade.strategyName,
        historyRetryCount: 0,
        openedAt: new Date().toISOString(),
        orphaned: true,
      },
    };
  }

  try {
    await deps.insertDecision({
      botInstanceId: deps.botInstanceId,
      decisionType: 'real_order_placed',
      triggeringCondition: `${trade.direction} ${trade.symbol} ticket=${brokerTicket} lots=${lotSize}`,
      assetClass: ASSET_CLASS,
      details: {
        strategy_id: 'xau-vwap-p90-reversion-live',
        trade_id: tradeRow.id,
        broker_ticket: brokerTicket,
        symbol: trade.symbol,
        timeframe: TIMEFRAME,
        direction: trade.direction,
        lot_size: lotSize,
        calculated_size: trade.lotSize,
        entry_price: entryPrice,
        requested_entry: trade.entryPrice,
        stop_price: trade.stopPrice,
        target_price: trade.targetPrice,
        applied_risk: trade.appliedRisk,
        dollar_risk: trade.dollarRisk,
        p90_threshold: trade.p90Threshold,
        spread: trade.spreadAtEntry,
        slippage,
        expected_account_type: expectedAccountType,
        detected_account_type: accountInfo.account_type,
        latency_ms: latencyMs,
        equity,
        place_order_raw: placeResult,
        market_snapshot: decision.marketSnapshot || null,
      },
    });
  } catch (err) {
    console.error('[xau-vwap-live-dispatch] insertDecision after place failed (continuing):', err.message);
  }

  try {
    await deps.forceNotifyUser(
      deps.userId,
      'real_order',
      `XAU VWAP LIVE order placed: ${trade.direction} ${trade.symbol} ticket ${brokerTicket} (${lotSize} lots).`
    );
  } catch (err) {
    console.error('[xau-vwap-live-dispatch] forceNotifyUser after place failed (continuing):', err.message);
  }

  return {
    outcome: 'opened',
    halt: false,
    marketSnapshot: decision.marketSnapshot || (snapshot.ok ? snapshot : null),
    openTrade: {
      tradeRowId: tradeRow.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice,
      lotSize,
      contractSize: trade.contractSize,
      brokerTicket: Number(brokerTicket),
      appliedRisk: trade.appliedRisk,
      strategyName: trade.strategyName || STRATEGY_NAME,
      p90Threshold: trade.p90Threshold,
      spreadAtEntry: trade.spreadAtEntry,
      slippage,
      historyRetryCount: 0,
      openedAt: new Date().toISOString(),
    },
  };
}

async function attemptMonitor(deps, openTrade) {
  let positions;
  try {
    positions = await deps.getPositions(openTrade.symbol);
  } catch (err) {
    console.error('[xau-vwap-live-dispatch] monitor getPositions failed, will retry next tick:', err.message);
    return { outcome: 'monitor_transient_error', halt: false, details: { message: err.message } };
  }

  const stillOpen = (positions || []).some((p) => Number(p.ticket) === Number(openTrade.brokerTicket));
  if (stillOpen) {
    openTrade.historyRetryCount = 0;
    return { outcome: 'still_open', halt: false };
  }

  let history;
  try {
    history = await deps.getOrderHistory(openTrade.brokerTicket);
    openTrade.historyRetryCount = 0;
  } catch (err) {
    const retries = (openTrade.historyRetryCount || 0) + 1;
    openTrade.historyRetryCount = retries;
    if (retries < REAL_HISTORY_RETRY_TICKS) {
      console.warn(
        `[xau-vwap-live-dispatch] close history lag for ticket ${openTrade.brokerTicket} ` +
          `(${retries}/${REAL_HISTORY_RETRY_TICKS}): ${err.message}`
      );
      return {
        outcome: 'history_retry',
        halt: false,
        details: { broker_ticket: openTrade.brokerTicket, retries, message: err.message },
      };
    }
    return {
      outcome: 'order_history_unavailable',
      halt: true,
      details: {
        broker_ticket: openTrade.brokerTicket,
        retries,
        max_retries: REAL_HISTORY_RETRY_TICKS,
        message: err.message,
      },
    };
  }

  const exitPrice = Number(history.close_price);
  const pnlAmount = Number(history.profit);
  if (!(exitPrice > 0) || !Number.isFinite(pnlAmount)) {
    return {
      outcome: 'order_history_incomplete',
      halt: true,
      details: { broker_ticket: openTrade.brokerTicket, history },
    };
  }

  const riskDistance = Math.abs(Number(openTrade.entryPrice) - Number(openTrade.stopPrice));
  const signedMove =
    openTrade.direction === 'BUY'
      ? exitPrice - Number(openTrade.entryPrice)
      : Number(openTrade.entryPrice) - exitPrice;
  const realizedR = riskDistance > 0 ? signedMove / riskDistance : null;

  const closedTrade = await deps.closeRealTrade(openTrade.tradeRowId, {
    exitPrice,
    pnl: pnlAmount,
    closedAt:
      history.close_time != null && Number(history.close_time) > 0
        ? new Date(Number(history.close_time) * 1000)
        : new Date(),
  });

  await deps.insertDecision({
    botInstanceId: deps.botInstanceId,
    decisionType: 'real_order_closed',
    triggeringCondition: `ticket=${openTrade.brokerTicket} pnl=${pnlAmount}`,
    assetClass: ASSET_CLASS,
    details: {
      strategy_id: 'xau-vwap-p90-reversion-live',
      trade_id: openTrade.tradeRowId,
      broker_ticket: openTrade.brokerTicket,
      symbol: openTrade.symbol,
      timeframe: TIMEFRAME,
      direction: openTrade.direction,
      exit_price: exitPrice,
      pnl: pnlAmount,
      realized_r: realizedR,
      was_win: pnlAmount > 0,
      history,
    },
  });

  await deps.forceNotifyUser(
    deps.userId,
    'real_order',
    `XAU VWAP LIVE order closed: ${openTrade.direction} ${openTrade.symbol} ticket ${openTrade.brokerTicket} pnl ${pnlAmount}.`
  );

  return {
    outcome: 'closed',
    halt: false,
    closedTrade: {
      ...openTrade,
      status: 'closed',
      exitPrice,
      pnl: pnlAmount,
      realizedR,
      wasWin: pnlAmount > 0,
      closedAt: new Date().toISOString(),
    },
    trade: closedTrade,
  };
}

module.exports = {
  attemptOpen,
  attemptMonitor,
  ASSET_CLASS,
  SYMBOL,
  TIMEFRAME,
  ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS,
};
