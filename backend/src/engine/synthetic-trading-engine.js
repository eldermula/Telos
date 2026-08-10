'use strict';

/**
 * Synthetics start/stop coordinator for the paper synthetic runtime.
 * Parallel to crypto-trading-engine.js; does not import bot-runtime.js.
 */

const { AppError } = require('../utils/app-error');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const tradesRepository = require('./trades.repository');
const {
  SyntheticBotRuntime,
  startSyntheticRuntime,
  stopSyntheticRuntime,
  getSyntheticRuntime,
} = require('./synthetic-bot-runtime');
const { publishBotEvent } = require('./event-publisher');
const notificationsService = require('../services/notifications.service');
const {
  LIVE_TRADING_CONFIRMATION_PHRASE,
  isConfirmationActive,
} = require('./live-trading-confirmation');
const { resolveExecutionMode } = require('./execution-mode');
const { SYNTHETIC_REAL_TRADING_ENABLED } = require('../config/env');
const syntheticDemoDispatchService = require('./synthetic-demo-dispatch.service');
const diagTiming = require('./diag-timing-context');
const path = require('path');
const { SYNTHETIC_WATCHLIST } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'watchlist.js'
));

async function ensureBotInstance(userId) {
  const instance = await botInstanceRepository.ensureForUser(userId);
  await botStatusCache.setStatus(instance);
  return instance;
}

async function getSyntheticSessionForUser(userId) {
  const instance = await ensureBotInstance(userId);
  // Always rebuild so synthetic_allow_demo_confirm reflects the live
  // admin Layer-2 toggle (not a stale Redis session payload).
  return botStatusCache.setStatus(instance);
}

async function startSyntheticSession(userId, runtimeOptions = {}) {
  const instance = await ensureBotInstance(userId);
  if (instance.synthetic_status === 'error') {
    throw new AppError(
      409,
      'SYNTHETIC_BOT_INSTANCE_ERROR',
      'Synthetic bot instance is in error state; resolve before starting'
    );
  }

  if (instance.synthetic_status === 'running') {
    await startSyntheticRuntime(instance, runtimeOptions);
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    synthetic_status: 'running',
    synthetic_halt_new_opens: false,
  });
  await startSyntheticRuntime(updated, runtimeOptions);
  const afterStart = await botInstanceRepository.findById(instance.id);
  const sessionRow = afterStart || updated;
  const cached = await botStatusCache.setStatus(sessionRow);
  await publishBotEvent(sessionRow.id, 'bot.status_changed', {
    status: sessionRow.status,
    crypto_status: sessionRow.crypto_status,
    synthetic_status: 'running',
    synthetic_halt_new_opens: false,
    timestamp: cached.updated_at,
  });
  await notificationsService.maybeNotifyUser(
    userId,
    'bot_start',
    'Synthetics paper bot started (Volatility Indices).'
  );
  return cached;
}

/**
 * Stop synthetics bot. Always clears synthetic_live_trading_confirmed_at,
 * including when the session is already stopped (no-op status transition).
 */
async function stopSyntheticSession(userId) {
  const instance = await ensureBotInstance(userId);
  await stopSyntheticRuntime(instance.id);

  const wasRunning = instance.synthetic_status !== 'stopped';
  // Confirmation clear is unconditional — write null even on already-stopped.
  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    ...(wasRunning ? { synthetic_status: 'stopped' } : {}),
    synthetic_live_trading_confirmed_at: null,
    synthetic_halt_new_opens: false,
  });
  const cached = await botStatusCache.setStatus(updated);

  if (wasRunning) {
    await publishBotEvent(updated.id, 'bot.status_changed', {
      status: updated.status,
      crypto_status: updated.crypto_status,
      synthetic_status: 'stopped',
      synthetic_halt_new_opens: false,
      timestamp: cached.updated_at,
    });
    await notificationsService.maybeNotifyUser(
      userId,
      'bot_stop',
      'Synthetics paper bot stopped.'
    );
  }
  return cached;
}

/**
 * Soft-halt for synthetics — tick loop + monitoring continue; new opens blocked.
 */
async function haltSyntheticNewOpens(userId) {
  const instance = await ensureBotInstance(userId);
  if (instance.synthetic_status !== 'running') {
    throw new AppError(
      409,
      'HALT_REQUIRES_RUNNING',
      'Halt new trades only applies while the synthetics bot is running — use Start first'
    );
  }
  if (instance.synthetic_halt_new_opens === true) {
    return botStatusCache.setStatus(instance);
  }
  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    synthetic_halt_new_opens: true,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    crypto_status: updated.crypto_status,
    synthetic_status: updated.synthetic_status,
    synthetic_halt_new_opens: true,
    timestamp: cached.updated_at,
  });
  return cached;
}

async function resumeSyntheticNewOpens(userId) {
  const instance = await ensureBotInstance(userId);
  if (instance.synthetic_status !== 'running') {
    throw new AppError(
      409,
      'RESUME_REQUIRES_RUNNING',
      'Resume new trades only applies while the synthetics bot is running'
    );
  }
  if (instance.synthetic_halt_new_opens !== true) {
    return botStatusCache.setStatus(instance);
  }
  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    synthetic_halt_new_opens: false,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    crypto_status: updated.crypto_status,
    synthetic_status: updated.synthetic_status,
    synthetic_halt_new_opens: false,
    timestamp: cached.updated_at,
  });
  return cached;
}

/**
 * Synthetics Layer 2 confirm-live — writes synthetic_live_trading_confirmed_at
 * and gates on synthetic_status. Demo accounts require the admin
 * time-limited demo-confirm toggle (logged when used).
 */
async function confirmSyntheticLiveTrading(userId, confirmationPhrase) {
  const instance = await ensureBotInstance(userId);

  if (instance.synthetic_status !== 'stopped') {
    throw new AppError(
      409,
      'INSTANCE_MUST_BE_STOPPED',
      'Stop the synthetics bot before confirming live trading'
    );
  }

  const demoBypassActive = await syntheticDemoDispatchService.isDemoConfirmEnabled();
  const isReal = instance.account_type === 'real';
  const isDemo = instance.account_type === 'demo';
  const accountQualifies = isReal || (demoBypassActive && isDemo);
  if (!accountQualifies) {
    throw new AppError(
      409,
      'NOT_A_REAL_ACCOUNT',
      'Live trading confirmation only applies to a real MT5 account'
    );
  }

  if (confirmationPhrase !== LIVE_TRADING_CONFIRMATION_PHRASE) {
    throw new AppError(
      400,
      'CONFIRMATION_PHRASE_MISMATCH',
      'Confirmation phrase does not match'
    );
  }

  const usedDemoBypass = isDemo && demoBypassActive;
  if (usedDemoBypass) {
    console.warn(
      '[synthetic-trading-engine] confirm-live SUCCEEDED VIA admin demo-confirm toggle ' +
        `(testing-only Layer-2 bypass) user_id=${userId} account_type=demo ` +
        `login_broker_connection_id=${instance.broker_connection_id}`
    );
  } else {
    console.info(
      '[synthetic-trading-engine] confirm-live succeeded on real account ' +
        `user_id=${userId} account_type=real`
    );
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    synthetic_live_trading_confirmed_at: new Date(),
  });
  const cached = await botStatusCache.setStatus(updated);
  await notificationsService.maybeNotifyUser(
    userId,
    'live_trading_confirmed',
    usedDemoBypass
      ? 'Synthetics live trading confirmed (DEMO BYPASS — admin demo-confirm toggle). Testing only.'
      : 'Synthetics live trading confirmed — real synthetics orders may be placed starting from the next Start.'
  );
  return cached;
}

/**
 * Testing-only: POST /bot/synthetic/test-dispatch-real
 * Bypasses strategy selection only; real open/monitor path unchanged.
 */
async function testDispatchSyntheticReal(userId, { symbol, direction }) {
  const timingOn = diagTiming.isEnabled();

  const manualTestArmed = await syntheticDemoDispatchService.isManualTestTradeEnabled();
  if (timingOn) diagTiming.mark('manual_toggle_done');
  if (!manualTestArmed) {
    throw new AppError(
      403,
      'MANUAL_TEST_TRADE_DISABLED',
      'Admin manual test-trade toggle must be enabled to use test-dispatch-real'
    );
  }

  if (SYNTHETIC_REAL_TRADING_ENABLED !== true) {
    throw new AppError(
      403,
      'SYNTHETIC_REAL_TRADING_DISABLED',
      'SYNTHETIC_REAL_TRADING_ENABLED must be true for test-dispatch-real'
    );
  }

  const sym = String(symbol || '');
  const dir = String(direction || '').toUpperCase();
  if (!SYNTHETIC_WATCHLIST.includes(sym)) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `symbol must be one of: ${SYNTHETIC_WATCHLIST.join(', ')}`
    );
  }
  if (dir !== 'BUY' && dir !== 'SELL') {
    throw new AppError(422, 'VALIDATION_ERROR', 'direction must be BUY or SELL');
  }
  if (timingOn) diagTiming.mark('guards_done');

  const instance = await ensureBotInstance(userId);
  if (timingOn) diagTiming.mark('ensure_bot_instance_done');

  if (instance.synthetic_status !== 'running') {
    throw new AppError(
      409,
      'SYNTHETIC_NOT_RUNNING',
      'Start the synthetics bot before test-dispatch-real (monitoring needs a running session)'
    );
  }

  if (!isConfirmationActive(instance.synthetic_live_trading_confirmed_at)) {
    throw new AppError(
      409,
      'LIVE_CONFIRMATION_REQUIRED',
      'synthetic_live_trading_confirmed_at must be currently active (confirm-live within TTL)'
    );
  }

  const allowDemoRealExecution =
    await syntheticDemoDispatchService.isDemoDispatchEnabled();
  const resolvedMode = resolveExecutionMode({
    realTradingEnabled: SYNTHETIC_REAL_TRADING_ENABLED,
    accountType: instance.account_type,
    liveTradingConfirmedAt: instance.synthetic_live_trading_confirmed_at,
    allowDemoRealExecution,
  });
  if (resolvedMode !== 'real') {
    throw new AppError(
      409,
      'REAL_DISPATCH_NOT_ARMED',
      `resolveExecutionMode is '${resolvedMode}', not 'real' (enable admin demo-dispatch toggle if on demo)`
    );
  }

  const openTrades = await tradesRepository.listOpenTradesForUser(userId);
  if (timingOn) diagTiming.mark('list_open_done');
  if (openTrades.length > 0) {
    throw new AppError(
      409,
      'ONE_OPEN_TRADE_PER_USER',
      'An open trade already exists for this user (system-wide one_open_trade_per_user)'
    );
  }

  const runtime = getSyntheticRuntime(instance.id);
  if (timingOn) diagTiming.mark('runtime_loaded');
  if (!runtime) {
    throw new AppError(
      409,
      'SYNTHETIC_RUNTIME_NOT_LOADED',
      'Synthetics runtime is not loaded in-process; Stop then Start and retry'
    );
  }

  console.warn(
    '[synthetic-trading-engine] test-dispatch-real INVOKED VIA admin manual test-trade toggle ' +
      `(testing-only) user_id=${userId} bot_instance_id=${instance.id} ` +
      `symbol=${sym} direction=${dir} account_type=${instance.account_type}`
  );

  if (timingOn) diagTiming.mark('runtime_dispatch_start');
  const result = await runtime.dispatchManualTestReal({ symbol: sym, direction: dir });
  if (timingOn) diagTiming.mark('runtime_dispatch_done');

  if (result?.error) {
    throw new AppError(
      503,
      'REAL_OPEN_HALTED',
      'Real open path halted (account-info / connection failure) — see decision log'
    );
  }
  if (result?.placeRejected) {
    throw new AppError(
      502,
      'PLACE_ORDER_REJECTED',
      'Broker placeOrder rejected — see decision log real_order_failed'
    );
  }
  if (result?.lotSkipped) {
    throw new AppError(
      409,
      'LOT_CLAMP_SKIPPED',
      'Lot sizing/clamp skipped the open — see decision log trade_rejected'
    );
  }
  if (!result?.trade) {
    throw new AppError(
      409,
      'TRADE_NOT_OPENED',
      'Real open path did not open a trade (entry rejected or no selection) — see decision log'
    );
  }

  return {
    trade: result.trade,
    sizing: result.sizing || null,
    calculated_size: result.calculatedSize ?? null,
    clamped: result.clamped || null,
    place_order: result.placeResult || null,
    stop_price: result.stopPrice ?? null,
    target_price: result.targetPrice ?? null,
    quote_entry: result.quoteEntry ?? null,
    symbol: result.symbol || sym,
    direction: result.direction || dir,
    dispatch_origin: 'manual_test',
    ...(result._runtime_timing ? { _runtime_timing: result._runtime_timing } : {}),
  };
}

/**
 * Production: POST /bot/synthetic/positions/:tradeId/close
 * User-initiated close for an open synthetic paper or real trade.
 * Reuses natural-close resolution (paper at live price / real via
 * order-history). Not gated by the admin manual test-trade toggle.
 */
async function closeSyntheticPosition(userId, tradeId) {
  const id = String(tradeId || '');
  if (!id) {
    throw new AppError(422, 'VALIDATION_ERROR', 'tradeId is required');
  }

  const instance = await ensureBotInstance(userId);
  const row = await tradesRepository.findTradeByIdForUser(id, userId);
  if (!row || row.bot_instance_id !== instance.id) {
    throw new AppError(404, 'TRADE_NOT_FOUND', 'Trade not found for this user');
  }
  if (row.status !== 'open') {
    throw new AppError(409, 'TRADE_NOT_OPEN', 'Trade is not open');
  }
  if (row.asset_class !== 'synthetic') {
    throw new AppError(409, 'TRADE_NOT_SYNTHETIC', 'Trade is not a synthetics position');
  }

  let runtime = getSyntheticRuntime(instance.id);
  let ephemeral = false;
  if (!runtime) {
    runtime = new SyntheticBotRuntime(instance, { autoTick: false });
    await runtime.initialize();
    ephemeral = true;
  }

  console.info(
    `[synthetic-trading-engine] user close position trade_id=${id} ` +
      `bot_instance_id=${instance.id} execution_mode=${row.execution_mode} ` +
      `ephemeral_runtime=${ephemeral}`
  );

  let result;
  try {
    result = await runtime.closeOpenPosition({ tradeId: id });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = err.code || 'CLOSE_FAILED';
    const status =
      code === 'TRADE_NOT_FOUND'
        ? 404
        : code === 'TRADE_NOT_OPEN' || code === 'TRADE_NOT_SYNTHETIC'
          ? 409
          : code === 'PRICE_UNAVAILABLE'
            ? 503
            : 502;
    throw new AppError(status, code, err.message || 'Failed to close position');
  }

  if (result?.error) {
    throw new AppError(
      502,
      'CLOSE_INCOMPLETE',
      `Close may have reached the broker but reconciliation failed (${result.reason || 'unknown'})`,
      {
        close_order: result.closeOrderRaw || null,
        history_error: result.history_error || null,
      }
    );
  }
  if (!result?.trade) {
    throw new AppError(502, 'CLOSE_NO_TRADE', 'Close path did not return a closed trade row');
  }

  return { trade: result.trade };
}

/**
 * Testing-only: POST /bot/synthetic/test-close-real
 * Closes an open real synthetic trade via connector /order/close, then
 * reconciles with the same getOrderHistory → _applyRealCloseFromHistory
 * path natural closes use. Does not change Start/Stop/tick-loop design.
 */
async function testCloseSyntheticReal(userId, { tradeId }) {
  const timingOn = diagTiming.isEnabled();

  const manualTestArmed = await syntheticDemoDispatchService.isManualTestTradeEnabled();
  if (timingOn) diagTiming.mark('manual_toggle_done');
  if (!manualTestArmed) {
    throw new AppError(
      403,
      'MANUAL_TEST_TRADE_DISABLED',
      'Admin manual test-trade toggle must be enabled to use test-close-real'
    );
  }

  const id = String(tradeId || '');
  if (!id) {
    throw new AppError(422, 'VALIDATION_ERROR', 'tradeId is required');
  }
  if (timingOn) diagTiming.mark('guards_done');

  const instance = await ensureBotInstance(userId);
  if (timingOn) diagTiming.mark('ensure_bot_instance_done');

  const row = await tradesRepository.findTradeByIdForUser(id, userId);
  if (timingOn) diagTiming.mark('list_open_done');
  if (!row) {
    throw new AppError(404, 'TRADE_NOT_FOUND', 'Trade not found for this user');
  }
  if (row.bot_instance_id !== instance.id) {
    throw new AppError(404, 'TRADE_NOT_FOUND', 'Trade not found for this user');
  }
  if (row.status !== 'open') {
    throw new AppError(409, 'TRADE_NOT_OPEN', `Trade status is '${row.status}', expected open`);
  }
  if (row.execution_mode !== 'real') {
    throw new AppError(409, 'TRADE_NOT_REAL', 'Trade is not execution_mode=real');
  }
  if (row.asset_class !== 'synthetic') {
    throw new AppError(409, 'TRADE_NOT_SYNTHETIC', 'Trade is not asset_class=synthetic');
  }
  if (row.broker_ticket == null) {
    throw new AppError(409, 'TRADE_MISSING_TICKET', 'Trade has no broker_ticket');
  }

  let runtime = getSyntheticRuntime(instance.id);
  let ephemeral = false;
  if (!runtime) {
    // Do not Start the tick loop — only construct an in-process runtime so
    // we can reuse _applyRealCloseFromHistory without changing Stop/monitor design.
    runtime = new SyntheticBotRuntime(instance, { autoTick: false });
    await runtime.initialize();
    ephemeral = true;
  }
  if (timingOn) diagTiming.mark('runtime_loaded');

  console.warn(
    '[synthetic-trading-engine] test-close-real INVOKED VIA admin manual test-trade toggle ' +
      `(testing-only) user_id=${userId} bot_instance_id=${instance.id} ` +
      `trade_id=${id} ticket=${row.broker_ticket} ephemeral_runtime=${ephemeral}`
  );

  let result;
  try {
    if (timingOn) diagTiming.mark('runtime_dispatch_start');
    result = await runtime.dispatchManualTestClose({ tradeId: id });
    if (timingOn) diagTiming.mark('runtime_dispatch_done');
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'MANUAL_TEST_CLOSE_FAILED', err.message || 'test-close-real failed');
  }

  if (result?.error) {
    throw new AppError(
      502,
      'MANUAL_TEST_CLOSE_INCOMPLETE',
      `Broker close may have succeeded but reconciliation failed (${result.reason || 'unknown'})`,
      {
        close_order: result.closeOrderRaw || null,
        history_error: result.history_error || null,
      }
    );
  }
  if (!result?.trade) {
    throw new AppError(
      502,
      'MANUAL_TEST_CLOSE_NO_TRADE',
      'Close path did not return a closed trade row'
    );
  }

  return {
    trade: result.trade,
    close_order: result.closeOrderRaw || null,
    order_history: result.history || null,
    dispatch_origin: 'manual_test_close',
    ...(result._runtime_timing ? { _runtime_timing: result._runtime_timing } : {}),
  };
}

async function rehydrateSyntheticRunningRuntimes(deps = {}) {
  const listFn =
    deps.listSyntheticRunning || (() => botInstanceRepository.listSyntheticRunning());
  const startFn = deps.startSyntheticRuntime || startSyntheticRuntime;
  const rows = await listFn();
  const results = [];
  for (const instance of rows) {
    try {
      await startFn(instance, deps.runtimeOptions || {});
      results.push({ id: instance.id, ok: true });
    } catch (err) {
      console.error(
        `[synthetic-trading-engine] rehydrate failed for ${instance.id}:`,
        err.message
      );
      results.push({ id: instance.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  getSyntheticSessionForUser,
  startSyntheticSession,
  stopSyntheticSession,
  haltSyntheticNewOpens,
  resumeSyntheticNewOpens,
  confirmSyntheticLiveTrading,
  testDispatchSyntheticReal,
  testCloseSyntheticReal,
  closeSyntheticPosition,
  rehydrateSyntheticRunningRuntimes,
};
