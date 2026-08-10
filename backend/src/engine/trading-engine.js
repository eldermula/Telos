'use strict';

/**
 * Trading Engine — backend-side coordinator
 * (04_System_Architecture.md Section 3.3).
 *
 * 4.1: ensure/load + Redis status cache
 * 4.2: Start/Stop status transitions
 * 4.3: In-process paper BotRuntime (APIRS via paperTradingHarness)
 */

const path = require('path');
const { AppError } = require('../utils/app-error');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const { startRuntime, stopRuntime, getRuntime, BotRuntime } = require('./bot-runtime');
const { publishBotEvent } = require('./event-publisher');
const notificationsService = require('../services/notifications.service');
const {
  LIVE_TRADING_CONFIRMATION_PHRASE,
  isConfirmationActive,
} = require('./live-trading-confirmation');
const { REAL_TRADING_ENABLED } = require('../config/env');
const forexDemoDispatchService = require('./forex-demo-dispatch.service');
const tradesRepository = require('./trades.repository');
const { resolveExecutionMode } = require('./execution-mode');

const newsIntelligencePath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'news-intelligence',
  'src'
);
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

async function ensureBotInstance(userId) {
  const instance = await botInstanceRepository.ensureForUser(userId);
  await botStatusCache.setStatus(instance);
  return instance;
}

async function getSessionForUser(userId) {
  const instance = await ensureBotInstance(userId);
  const cached = await botStatusCache.getStatus(instance.id);
  if (cached) {
    return cached;
  }
  return botStatusCache.setStatus(instance);
}

async function syncStatusCache(instance) {
  return botStatusCache.setStatus(instance);
}

async function getBotInstanceForUser(userId) {
  return botInstanceRepository.findByUserId(userId);
}

/**
 * Start paper bot: status=running, spin up in-process BotRuntime.
 * Idempotent if already running.
 */
async function startSession(userId, runtimeOptions = {}) {
  const instance = await ensureBotInstance(userId);
  if (instance.status === 'error') {
    throw new AppError(
      409,
      'BOT_INSTANCE_ERROR',
      'Bot instance is in error state; resolve before starting'
    );
  }

  if (instance.status === 'running') {
    await startRuntime(instance, runtimeOptions);
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    status: 'running',
    // Fresh Start always clears soft-halt (Resume is the mid-run control).
    halt_new_opens: false,
  });
  const runtime = await startRuntime(updated, runtimeOptions);
  // Option 2 E.7 — resume reconcile may have halted to status='error'
  // during initialize(). Re-read so we don't publish a stale 'running'
  // snapshot over the halt.
  const afterStart = await botInstanceRepository.findById(instance.id);
  const sessionRow = afterStart || updated;
  const cached = await botStatusCache.setStatus(sessionRow);
  if (runtime && runtime._halted) {
    await publishBotEvent(sessionRow.id, 'bot.status_changed', {
      status: 'error',
      timestamp: cached.updated_at,
    });
    return cached;
  }
  await publishBotEvent(sessionRow.id, 'bot.status_changed', {
    status: 'running',
    timestamp: cached.updated_at,
  });
  // FR-NOTIF-1 — preference-gated; must not block Start if notify fails.
  await notificationsService.maybeNotifyUser(userId, 'bot_start', 'Trading bot started.');
  return cached;
}

/**
 * Stop paper bot: halt BotRuntime, status=stopped.
 * Idempotent if already stopped.
 *
 * Also unconditionally clears Layer 2's live-trading confirmation
 * (Option 2, Increment D) — "re-confirm after every Stop" means every
 * Stop, including a no-op Stop called while already stopped. Without
 * the no-op branch's own clear, a user who confirms and then never
 * presses Start could call Stop as a harmless-looking no-op and the
 * confirmation would silently survive it — the TTL in
 * live-trading-confirmation.js is the other half of this defense, but
 * Stop should never depend on the TTL alone to close this out.
 */
async function stopSession(userId) {
  const instance = await ensureBotInstance(userId);
  await stopRuntime(instance.id);

  if (instance.status === 'stopped') {
    if (instance.live_trading_confirmed_at || instance.halt_new_opens) {
      const cleared = await botInstanceRepository.updateStatusFields(instance.id, {
        live_trading_confirmed_at: null,
        halt_new_opens: false,
      });
      return botStatusCache.setStatus(cleared);
    }
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    status: 'stopped',
    live_trading_confirmed_at: null,
    halt_new_opens: false,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: 'stopped',
    halt_new_opens: false,
    timestamp: cached.updated_at,
  });
  // FR-NOTIF-1 — preference-gated; must not block Stop if notify fails.
  await notificationsService.maybeNotifyUser(userId, 'bot_stop', 'Trading bot stopped.');
  return cached;
}

/**
 * Soft-halt: keep the tick loop running (monitor open positions) but
 * block openReal/openPaper. Distinct from Stop (full timer halt).
 * Requires status=running.
 */
async function haltNewOpens(userId) {
  const instance = await ensureBotInstance(userId);
  if (instance.status !== 'running') {
    throw new AppError(
      409,
      'HALT_REQUIRES_RUNNING',
      'Halt new trades only applies while the bot is running — use Start first'
    );
  }
  if (instance.halt_new_opens === true) {
    return botStatusCache.setStatus(instance);
  }
  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    halt_new_opens: true,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    halt_new_opens: true,
    timestamp: cached.updated_at,
  });
  return cached;
}

/**
 * Clear soft-halt while leaving the bot running. Requires status=running.
 */
async function resumeNewOpens(userId) {
  const instance = await ensureBotInstance(userId);
  if (instance.status !== 'running') {
    throw new AppError(
      409,
      'RESUME_REQUIRES_RUNNING',
      'Resume new trades only applies while the bot is running'
    );
  }
  if (instance.halt_new_opens !== true) {
    return botStatusCache.setStatus(instance);
  }
  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    halt_new_opens: false,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    halt_new_opens: false,
    timestamp: cached.updated_at,
  });
  return cached;
}

/**
 * Option 2 Layer 2 opt-in (Option 2, Increment D). Preconditions,
 * checked in this order, each a distinct rejection:
 *   1. instance must exist (ensureBotInstance's existing 404)
 *   2. instance must be stopped — confirmation only ever arms the
 *      *next* Start, never flips a running instance mid-flight
 *   3. the linked account must qualify:
 *        - always: account_type === 'real'
 *        - OR, when admin Layer-2 demo-confirm toggle is active:
 *          account_type === 'demo' (DB-backed, max 30 min)
 *   4. the typed phrase must match exactly (case-sensitive)
 * Idempotent on success — reconfirming just refreshes the timestamp.
 */
async function confirmLiveTrading(userId, confirmationPhrase) {
  const instance = await ensureBotInstance(userId);

  if (instance.status !== 'stopped') {
    throw new AppError(
      409,
      'INSTANCE_MUST_BE_STOPPED',
      'Stop the bot before confirming live trading'
    );
  }

  const demoAcceptanceAllowed = await forexDemoDispatchService.isDemoConfirmEnabled();
  const accountQualifies =
    instance.account_type === 'real' ||
    (demoAcceptanceAllowed && instance.account_type === 'demo');
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

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    live_trading_confirmed_at: new Date(),
  });
  const cached = await botStatusCache.setStatus(updated);
  // FR-NOTIF-1 — preference-gated; must not block confirmation if notify fails.
  await notificationsService.maybeNotifyUser(
    userId,
    'live_trading_confirmed',
    'Live trading confirmed for your real account — real orders may be placed starting from the next Start.'
  );
  return cached;
}

/**
 * Testing-only: POST /trading/test-dispatch-real
 * Mirrors synthetics test-dispatch-real. Bypasses strategy selection
 * only; real open/monitor path unchanged. origin='manual'.
 */
async function testDispatchForexReal(userId, { symbol, direction }) {
  const manualTestArmed = await forexDemoDispatchService.isManualTestTradeEnabled();
  if (!manualTestArmed) {
    throw new AppError(
      403,
      'MANUAL_TEST_TRADE_DISABLED',
      'Admin manual test-trade toggle must be enabled to use test-dispatch-real'
    );
  }

  if (REAL_TRADING_ENABLED !== true) {
    throw new AppError(
      403,
      'REAL_TRADING_DISABLED',
      'REAL_TRADING_ENABLED must be true for test-dispatch-real'
    );
  }

  const sym = String(symbol || '');
  const dir = String(direction || '').toUpperCase();
  if (!WATCHLIST.includes(sym)) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `symbol must be one of: ${WATCHLIST.join(', ')}`
    );
  }
  if (dir !== 'BUY' && dir !== 'SELL') {
    throw new AppError(422, 'VALIDATION_ERROR', 'direction must be BUY or SELL');
  }

  const instance = await ensureBotInstance(userId);

  if (instance.status !== 'running') {
    throw new AppError(
      409,
      'BOT_NOT_RUNNING',
      'Start the forex bot before test-dispatch-real (monitoring needs a running session)'
    );
  }

  if (!isConfirmationActive(instance.live_trading_confirmed_at)) {
    throw new AppError(
      409,
      'LIVE_CONFIRMATION_REQUIRED',
      'live_trading_confirmed_at must be currently active (confirm-live within TTL)'
    );
  }

  const allowDemoRealExecution = await forexDemoDispatchService.isDemoDispatchEnabled();
  const resolvedMode = resolveExecutionMode({
    realTradingEnabled: REAL_TRADING_ENABLED,
    accountType: instance.account_type,
    liveTradingConfirmedAt: instance.live_trading_confirmed_at,
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
  if (openTrades.length > 0) {
    throw new AppError(
      409,
      'ONE_OPEN_TRADE_PER_USER',
      'An open trade already exists for this user (system-wide one_open_trade_per_user)'
    );
  }

  const runtime = getRuntime(instance.id);
  if (!runtime) {
    throw new AppError(
      409,
      'RUNTIME_NOT_LOADED',
      'Forex runtime is not loaded in-process; Stop then Start and retry'
    );
  }

  console.warn(
    '[trading-engine] test-dispatch-real INVOKED VIA admin manual test-trade toggle ' +
      `(testing-only) user_id=${userId} bot_instance_id=${instance.id} ` +
      `symbol=${sym} direction=${dir} account_type=${instance.account_type}`
  );

  const result = await runtime.dispatchManualTestReal({ symbol: sym, direction: dir });

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
    broker_positions: result.brokerPositions || null,
    stop_price: result.stopPrice ?? null,
    target_price: result.targetPrice ?? null,
    quote_entry: result.quoteEntry ?? null,
    symbol: result.symbol || sym,
    direction: result.direction || dir,
    dispatch_origin: 'manual_test',
  };
}

/**
 * Testing-only: POST /trading/test-close-real
 * Mirrors synthetics test-close-real.
 */
async function testCloseForexReal(userId, { tradeId }) {
  const manualTestArmed = await forexDemoDispatchService.isManualTestTradeEnabled();
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

  const instance = await ensureBotInstance(userId);
  const row = await tradesRepository.findTradeByIdForUser(id, userId);
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
  if (row.asset_class !== 'forex_gold') {
    throw new AppError(409, 'TRADE_NOT_FOREX', 'Trade is not asset_class=forex_gold');
  }
  if (row.broker_ticket == null) {
    throw new AppError(409, 'TRADE_MISSING_TICKET', 'Trade has no broker_ticket');
  }

  let runtime = getRuntime(instance.id);
  let ephemeral = false;
  if (!runtime) {
    runtime = new BotRuntime(instance, { autoTick: false });
    await runtime.initialize();
    ephemeral = true;
  }

  console.warn(
    '[trading-engine] test-close-real INVOKED VIA admin manual test-trade toggle ' +
      `(testing-only) user_id=${userId} bot_instance_id=${instance.id} ` +
      `trade_id=${id} ticket=${row.broker_ticket} ephemeral_runtime=${ephemeral}`
  );

  let result;
  try {
    result = await runtime.dispatchManualTestClose({ tradeId: id });
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
    history: result.history || null,
    dispatch_origin: 'manual_test_close',
  };
}

/**
 * Boot rehydration — restart in-memory runtimes for every instance still
 * marked status='running' after a process crash/restart. Uses the same
 * startRuntime → initialize() path as Start (including E.7 real resume
 * reconcile). Failures are isolated per instance so one bad bot cannot
 * block the others or prevent the HTTP server from coming up.
 *
 * @param {{
 *   listRunning?: () => Promise<object[]>,
 *   startRuntime?: (instance: object) => Promise<object>,
 *   findById?: (id: string) => Promise<object|null>,
 *   setStatus?: (row: object) => Promise<object>,
 * }} [deps] optional seams for unit tests
 */
async function rehydrateRunningRuntimes(deps = {}) {
  const listRunning = deps.listRunning || (() => botInstanceRepository.listRunning());
  const start = deps.startRuntime || startRuntime;
  const findById = deps.findById || ((id) => botInstanceRepository.findById(id));
  const setStatus = deps.setStatus || ((row) => botStatusCache.setStatus(row));

  const instances = await listRunning();
  const results = [];
  for (const instance of instances) {
    try {
      const runtime = await start(instance);
      const after = await findById(instance.id);
      if (after) {
        await setStatus(after);
      }
      results.push({
        id: instance.id,
        ok: true,
        status: after?.status || instance.status,
        halted: Boolean(runtime && runtime._halted),
      });
    } catch (err) {
      console.error(
        `[rehydrate] failed for bot_instance ${instance.id}:`,
        err.message
      );
      results.push({ id: instance.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  ensureBotInstance,
  getSessionForUser,
  syncStatusCache,
  getBotInstanceForUser,
  startSession,
  stopSession,
  haltNewOpens,
  resumeNewOpens,
  confirmLiveTrading,
  testDispatchForexReal,
  testCloseForexReal,
  rehydrateRunningRuntimes,
};
