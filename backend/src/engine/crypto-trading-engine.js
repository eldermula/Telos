'use strict';

/**
 * Crypto Increment E — start/stop coordinator for the paper crypto runtime.
 * Parallel to trading-engine.js; does not import bot-runtime.js.
 */

const { AppError } = require('../utils/app-error');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const { startCryptoRuntime, stopCryptoRuntime } = require('./crypto-bot-runtime');
const { publishBotEvent } = require('./event-publisher');
const notificationsService = require('../services/notifications.service');

async function ensureBotInstance(userId) {
  const instance = await botInstanceRepository.ensureForUser(userId);
  await botStatusCache.setStatus(instance);
  return instance;
}

async function getCryptoSessionForUser(userId) {
  const instance = await ensureBotInstance(userId);
  const cached = await botStatusCache.getStatus(instance.id);
  return cached || botStatusCache.setStatus(instance);
}

async function startCryptoSession(userId, runtimeOptions = {}) {
  const instance = await ensureBotInstance(userId);
  if (instance.crypto_status === 'error') {
    throw new AppError(
      409,
      'CRYPTO_BOT_INSTANCE_ERROR',
      'Crypto bot instance is in error state; resolve before starting'
    );
  }

  if (instance.crypto_status === 'running') {
    await startCryptoRuntime(instance, runtimeOptions);
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    crypto_status: 'running',
  });
  await startCryptoRuntime(updated, runtimeOptions);
  const afterStart = await botInstanceRepository.findById(instance.id);
  const sessionRow = afterStart || updated;
  const cached = await botStatusCache.setStatus(sessionRow);
  await publishBotEvent(sessionRow.id, 'bot.status_changed', {
    status: sessionRow.status,
    crypto_status: 'running',
    timestamp: cached.updated_at,
  });
  await notificationsService.maybeNotifyUser(userId, 'bot_start', 'Crypto paper bot started.');
  return cached;
}

async function stopCryptoSession(userId) {
  const instance = await ensureBotInstance(userId);
  await stopCryptoRuntime(instance.id);

  if (instance.crypto_status === 'stopped') {
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    crypto_status: 'stopped',
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: updated.status,
    crypto_status: 'stopped',
    timestamp: cached.updated_at,
  });
  await notificationsService.maybeNotifyUser(userId, 'bot_stop', 'Crypto paper bot stopped.');
  return cached;
}

async function rehydrateCryptoRunningRuntimes(deps = {}) {
  const listFn = deps.listCryptoRunning || (() => botInstanceRepository.listCryptoRunning());
  const startFn = deps.startCryptoRuntime || startCryptoRuntime;
  const rows = await listFn();
  const results = [];
  for (const instance of rows) {
    try {
      await startFn(instance, deps.runtimeOptions || {});
      results.push({ id: instance.id, ok: true });
    } catch (err) {
      console.error(
        `[crypto-trading-engine] rehydrate failed for ${instance.id}:`,
        err.message
      );
      results.push({ id: instance.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  getCryptoSessionForUser,
  startCryptoSession,
  stopCryptoSession,
  rehydrateCryptoRunningRuntimes,
};
