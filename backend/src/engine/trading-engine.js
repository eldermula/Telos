'use strict';

/**
 * Trading Engine — backend-side coordinator
 * (04_System_Architecture.md Section 3.3).
 *
 * 4.1: ensure/load + Redis status cache
 * 4.2: Start/Stop status transitions
 * 4.3: In-process paper BotRuntime (APIRS via paperTradingHarness)
 */

const { AppError } = require('../utils/app-error');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const { startRuntime, stopRuntime } = require('./bot-runtime');
const { publishBotEvent } = require('./event-publisher');
const notificationsService = require('../services/notifications.service');
const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('./live-trading-confirmation');
const {
  NODE_ENV,
  REAL_TRADING_ALLOW_DEMO,
  assertRealTradingDemoBypassAllowed,
} = require('../config/env');

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
    if (instance.live_trading_confirmed_at) {
      const cleared = await botInstanceRepository.updateStatusFields(instance.id, {
        live_trading_confirmed_at: null,
      });
      return botStatusCache.setStatus(cleared);
    }
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    status: 'stopped',
    live_trading_confirmed_at: null,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: 'stopped',
    timestamp: cached.updated_at,
  });
  // FR-NOTIF-1 — preference-gated; must not block Stop if notify fails.
  await notificationsService.maybeNotifyUser(userId, 'bot_stop', 'Trading bot stopped.');
  return cached;
}

/**
 * Option 2 Layer 2 opt-in (Option 2, Increment D). Preconditions,
 * checked in this order, each a distinct rejection:
 *   0. Production + REAL_TRADING_ALLOW_DEMO present at all → refuse
 *      (same property as E.0's boot tripwire, but enforced here so it
 *      holds for any caller — not only index.js). Checked before any
 *      I/O so a direct require() of this module cannot arm demo.
 *   1. instance must exist (ensureBotInstance's existing 404)
 *   2. instance must be stopped — confirmation only ever arms the
 *      *next* Start, never flips a running instance mid-flight
 *   3. the linked account must qualify:
 *        - always: account_type === 'real'
 *        - OR, when demoAcceptanceAllowed (ALLOW_DEMO===true AND
 *          NODE_ENV !== 'production'): account_type === 'demo'
 *   4. the typed phrase must match exactly (case-sensitive)
 * Idempotent on success — reconfirming just refreshes the timestamp.
 */
async function confirmLiveTrading(userId, confirmationPhrase) {
  // Defense in depth vs E.0: same predicate as
  // assertRealTradingDemoBypassAtStartup, enforced here so a direct
  // require() of this module (no index.js) still cannot arm demo.
  try {
    assertRealTradingDemoBypassAllowed({
      nodeEnv: NODE_ENV,
      allowDemoEnvPresent: process.env.REAL_TRADING_ALLOW_DEMO !== undefined,
    });
  } catch (err) {
    throw new AppError(
      500,
      'REAL_TRADING_DEMO_BYPASS_IN_PRODUCTION',
      err.message
    );
  }

  const instance = await ensureBotInstance(userId);

  if (instance.status !== 'stopped') {
    throw new AppError(
      409,
      'INSTANCE_MUST_BE_STOPPED',
      'Stop the bot before confirming live trading'
    );
  }

  // Demo arm exists only when both the bypass boolean is on AND we are
  // not in production — mutually exclusive with the throw above for any
  // process that has the env var present under NODE_ENV=production.
  const demoAcceptanceAllowed =
    REAL_TRADING_ALLOW_DEMO === true && NODE_ENV !== 'production';
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

module.exports = {
  ensureBotInstance,
  getSessionForUser,
  syncStatusCache,
  getBotInstanceForUser,
  startSession,
  stopSession,
  confirmLiveTrading,
};
