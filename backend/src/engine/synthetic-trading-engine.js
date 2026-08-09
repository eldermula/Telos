'use strict';

/**
 * Synthetics start/stop coordinator for the paper synthetic runtime.
 * Parallel to crypto-trading-engine.js; does not import bot-runtime.js.
 */

const { AppError } = require('../utils/app-error');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const { startSyntheticRuntime, stopSyntheticRuntime } = require('./synthetic-bot-runtime');
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

async function getSyntheticSessionForUser(userId) {
  const instance = await ensureBotInstance(userId);
  const cached = await botStatusCache.getStatus(instance.id);
  return cached || botStatusCache.setStatus(instance);
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
  });
  await startSyntheticRuntime(updated, runtimeOptions);
  const afterStart = await botInstanceRepository.findById(instance.id);
  const sessionRow = afterStart || updated;
  const cached = await botStatusCache.setStatus(sessionRow);
  await publishBotEvent(sessionRow.id, 'bot.status_changed', {
    status: sessionRow.status,
    crypto_status: sessionRow.crypto_status,
    synthetic_status: 'running',
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
 * Stop synthetics paper bot. Clears synthetic Layer 2 confirmation on
 * every Stop (including already-stopped), matching forex stopSession.
 */
async function stopSyntheticSession(userId) {
  const instance = await ensureBotInstance(userId);
  await stopSyntheticRuntime(instance.id);

  if (instance.synthetic_status === 'stopped') {
    if (instance.synthetic_live_trading_confirmed_at) {
      const cleared = await botInstanceRepository.updateStatusFields(instance.id, {
        synthetic_live_trading_confirmed_at: null,
      });
      return botStatusCache.setStatus(cleared);
    }
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    synthetic_status: 'stopped',
    synthetic_live_trading_confirmed_at: null,
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    crypto_status: updated.crypto_status,
    synthetic_status: 'stopped',
    timestamp: cached.updated_at,
  });
  await notificationsService.maybeNotifyUser(userId, 'bot_stop', 'Synthetics paper bot stopped.');
  return cached;
}

/**
 * Synthetics Layer 2 confirm-live — mirrors trading-engine.confirmLiveTrading
 * but writes synthetic_live_trading_confirmed_at and gates on synthetic_status.
 */
async function confirmSyntheticLiveTrading(userId, confirmationPhrase) {
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

  if (instance.synthetic_status !== 'stopped') {
    throw new AppError(
      409,
      'INSTANCE_MUST_BE_STOPPED',
      'Stop the synthetics bot before confirming live trading'
    );
  }

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
    synthetic_live_trading_confirmed_at: new Date(),
  });
  const cached = await botStatusCache.setStatus(updated);
  await notificationsService.maybeNotifyUser(
    userId,
    'live_trading_confirmed',
    'Synthetics live trading confirmed — real synthetics orders may be placed starting from the next Start (when Batch 2 dispatch is enabled).'
  );
  return cached;
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
  confirmSyntheticLiveTrading,
  rehydrateSyntheticRunningRuntimes,
};
