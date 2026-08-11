'use strict';

/**
 * M5 PAPER-ONLY EXPERIMENT real-dispatch (docs/14_M5_Forex_Paper_Experiment.md).
 *
 * UNPROVEN LIVE — this module CAN place real orders once armed (Layer 0-3,
 * below). It exists so a human can deliberately test the M5 mechanism
 * end-to-end on a real/demo account, on purpose, with every layer forex's
 * real-dispatch already uses (bot-runtime.js `_maybeOpenPositionReal` /
 * `_monitorOpenPositionReal`) — it is NOT wired into any automatic user
 * flow: only `m5-real-harness.js`'s admin-started tick loop calls this,
 * and only after Layer 0-3 all pass on that same tick.
 *
 * Deliberately does NOT reuse bot-runtime.js's full APIRS tier/drawdown
 * state machine (`evaluateEntry`/`resolveExit`, tier progression, daily
 * drawdown circuit breakers). M5 real-dispatch reuses the SAME stateless
 * math already proven in the M5 paper build instead
 * (m5-paper-strategy.js's `evaluateM5Tick` — computeAppliedRisk from LIVE
 * equity, computeSyntheticRawLotSize + clampLotSize) — this is a deliberate
 * simplification per the M5 real-dispatch build instructions, not an
 * oversight: the point of this build is proving the real-order mechanism
 * works, not a second tier-progression engine.
 *
 * Safety layers, same shape as bot-runtime.js/synthetic-bot-runtime.js:
 *   Layer 0 — resolveExpectedAccountTypeForLayer0 + read-only account-info
 *             pre-check with one 400ms retry (never around placeOrder).
 *   Layer 1 — M5_REAL_TRADING_ENABLED (env, checked by the harness before
 *             calling attemptOpen at all).
 *   Layer 2 — bot_instances.m5_live_trading_confirmed_at (own confirm-live,
 *             independent of forex/synthetic).
 *   Layer 3 — m5_demo_dispatch_config (own demo bypass, independent of
 *             forex_demo_dispatch_config/synthetic_demo_dispatch_config).
 * Plus the system-wide one_open_trade_per_user check (any asset class).
 *
 * Close detection is broker-authoritative (mirrors bot-runtime.js's
 * `_monitorOpenPositionReal`): the broker already holds the SL/TP sent
 * with placeOrder, so this only detects "ticket vanished from
 * getPositions()" and reconciles via getOrderHistory — it never compares
 * live price to stop/target locally the way the paper module's
 * `evaluateM5Monitor` does.
 */

const { evaluateM5Tick } = require('./m5-paper-strategy');
const { resolveExpectedAccountTypeForLayer0 } = require('./execution-mode');
const { isConnectionFresh } = require('./connection-freshness');

const ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS = 400;
const HISTORY_RETRY_DELAY_MS = 250;
const REAL_HISTORY_RETRY_TICKS = 3;
const ASSET_CLASS = 'm5_forex_gold';

async function readMatchedAccountInfoWithRetry(deps) {
  try {
    return await deps.getMatchedAccountInfo(deps.botInstanceId);
  } catch (firstErr) {
    console.warn(
      '[m5-real-dispatch] account-info pre-check failed; one read-only retry ' +
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
 * One open-attempt tick. Never throws — every failure resolves to a
 * `{ outcome, halt, ... }` descriptor so the harness can decide whether
 * to keep ticking (non-halting outcomes: no_signal/no_price/skipped/
 * sizing_error/one_open_trade_blocked/data errors) or halt the real
 * session (halt: true — account-info/freshness/place-order failures).
 *
 * @param {object} deps - see m5-real-harness.js for the concrete shape;
 *   { botInstanceId, userId, getMatchedAccountInfo, getRates, getSymbolInfo,
 *     getPositions, placeOrder, listOpenTradesForUser, listActiveStrategies,
 *     insertOpenRealTrade, insertDecision, forceNotifyUser, watchlist,
 *     maxAgeHours, now }
 */
async function attemptOpen(deps) {
  let accountInfo;
  try {
    accountInfo = await readMatchedAccountInfoWithRetry(deps);
  } catch (err) {
    return {
      outcome: 'account_info_unavailable',
      halt: true,
      details: { message: err.message, code: err.code || null, retried: true, first_error: err.firstError || null },
    };
  }

  if (!isConnectionFresh(accountInfo.last_validated_at, deps.maxAgeHours, deps.now())) {
    return {
      outcome: 'stale_broker_connection',
      halt: true,
      details: { last_validated_at: accountInfo.last_validated_at, max_age_hours: deps.maxAgeHours },
    };
  }

  const equity = Number(accountInfo.equity);
  if (!(equity > 0)) {
    return { outcome: 'invalid_live_equity', halt: true, details: { equity: accountInfo.equity } };
  }

  // System-wide one_open_trade_per_user (docs/11 §0.2) — M5 counts as part
  // of the same constraint as forex/crypto/synthetics, not a separate pool.
  // Not a halt: another asset class legitimately having an open trade is
  // an expected, recoverable condition, not a real-dispatch failure.
  const openElsewhere = await deps.listOpenTradesForUser(deps.userId);
  if (openElsewhere.length > 0) {
    return {
      outcome: 'one_open_trade_blocked',
      halt: false,
      details: { open_trade_ids: openElsewhere.map((t) => t.id) },
    };
  }

  const strategies = await deps.listActiveStrategies();

  const instruments = [];
  const dataErrors = [];
  for (const symbol of deps.watchlist) {
    try {
      const [ratesResult, symbolInfo] = await Promise.all([
        deps.getRates(symbol, { timeframe: 'M5', count: 100 }),
        deps.getSymbolInfo(symbol),
      ]);
      instruments.push({ symbol, bars: ratesResult.bars, symbolInfo });
    } catch (err) {
      dataErrors.push({ symbol, reason: err.message });
    }
  }
  if (instruments.length === 0) {
    return { outcome: 'no_data', halt: false, details: { dataErrors } };
  }

  const decision = evaluateM5Tick({ instruments, strategies, balance: equity });

  if (decision.outcome === 'no_signal' || decision.outcome === 'no_price') {
    return { outcome: decision.outcome, halt: false, details: { dataErrors: decision.dataErrors } };
  }
  if (decision.outcome === 'sizing_error') {
    return {
      outcome: 'sizing_error',
      halt: false,
      details: { symbol: decision.symbol, direction: decision.direction, reason: decision.reason },
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
    };
  }

  // decision.outcome === 'opened' from here — real placeOrder.
  const trade = decision.trade;
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

  const conditions = {
    strategy_id: trade.strategyId,
    strategy_name: trade.strategyName,
    applied_risk: trade.appliedRisk,
    contract_size: trade.contractSize,
    balance_snapshot: trade.balanceSnapshot,
  };

  const tradeRow = await deps.insertOpenRealTrade({
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

  await deps.insertDecision({
    botInstanceId: deps.botInstanceId,
    decisionType: 'real_order_placed',
    triggeringCondition: `${trade.direction} ${trade.symbol} ticket=${brokerTicket} lots=${lotSize}`,
    assetClass: ASSET_CLASS,
    details: {
      trade_id: tradeRow.id,
      broker_ticket: brokerTicket,
      symbol: trade.symbol,
      direction: trade.direction,
      lot_size: lotSize,
      calculated_size: trade.lotSize,
      entry_price: entryPrice,
      stop_price: trade.stopPrice,
      target_price: trade.targetPrice,
      applied_risk: trade.appliedRisk,
      expected_account_type: expectedAccountType,
      detected_account_type: accountInfo.account_type,
      latency_ms: latencyMs,
      place_order_raw: placeResult,
    },
  });

  await deps.forceNotifyUser(
    deps.userId,
    'real_order',
    `M5 experiment real order placed: ${trade.direction} ${trade.symbol} ticket ${brokerTicket} (${lotSize} lots).`
  );

  return {
    outcome: 'opened',
    halt: false,
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
      strategyName: trade.strategyName,
      historyRetryCount: 0,
      openedAt: new Date().toISOString(),
    },
  };
}

/**
 * One monitor-attempt tick for an already-open real M5 position.
 * Broker-authoritative: detects close by the ticket vanishing from
 * getPositions(), never by comparing price to stop/target locally.
 *
 * @param {object} deps - same shape as attemptOpen, plus
 *   { getOrderHistory, closeRealTrade }
 * @param {object} openTrade - the harness's in-memory open-real-position record
 */
async function attemptMonitor(deps, openTrade) {
  let positions;
  try {
    positions = await deps.getPositions(openTrade.symbol);
  } catch (err) {
    // Transient connector blip — retry next tick, do not invent a close.
    console.error('[m5-real-dispatch] monitor getPositions failed, will retry next tick:', err.message);
    return { outcome: 'monitor_transient_error', halt: false, details: { message: err.message } };
  }

  const stillOpen = (positions || []).some((p) => Number(p.ticket) === Number(openTrade.brokerTicket));
  if (stillOpen) {
    return { outcome: 'still_open', halt: false };
  }

  // Ticket gone — broker closed it (SL/TP, manual, stop-out). Reconcile via history.
  let history = null;
  let lastErr = null;
  for (let i = 0; i < REAL_HISTORY_RETRY_TICKS; i += 1) {
    try {
      history = await deps.getOrderHistory(openTrade.brokerTicket);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[m5-real-dispatch] close history lag for ticket ${openTrade.brokerTicket} ` +
          `(${i + 1}/${REAL_HISTORY_RETRY_TICKS}): ${err.message}`
      );
      await new Promise((r) => setTimeout(r, HISTORY_RETRY_DELAY_MS));
    }
  }
  if (!history) {
    return {
      outcome: 'order_history_unavailable',
      halt: true,
      details: { broker_ticket: openTrade.brokerTicket, message: lastErr ? lastErr.message : null },
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
      trade_id: openTrade.tradeRowId,
      broker_ticket: openTrade.brokerTicket,
      symbol: openTrade.symbol,
      direction: openTrade.direction,
      exit_price: exitPrice,
      pnl: pnlAmount,
      was_win: pnlAmount > 0,
      history,
    },
  });

  await deps.forceNotifyUser(
    deps.userId,
    'real_order',
    `M5 experiment real order closed: ${openTrade.direction} ${openTrade.symbol} ticket ${openTrade.brokerTicket} pnl ${pnlAmount}.`
  );

  return {
    outcome: 'closed',
    halt: false,
    closedTrade: {
      ...openTrade,
      status: 'closed',
      exitPrice,
      pnl: pnlAmount,
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
  ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS,
};
