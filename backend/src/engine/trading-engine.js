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
  await startRuntime(updated, runtimeOptions);
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: 'running',
    timestamp: cached.updated_at,
  });
  return cached;
}

/**
 * Stop paper bot: halt BotRuntime, status=stopped.
 * Idempotent if already stopped.
 */
async function stopSession(userId) {
  const instance = await ensureBotInstance(userId);
  await stopRuntime(instance.id);

  if (instance.status === 'stopped') {
    return botStatusCache.setStatus(instance);
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    status: 'stopped',
  });
  const cached = await botStatusCache.setStatus(updated);
  await publishBotEvent(updated.id, 'bot.status_changed', {
    status: 'stopped',
    timestamp: cached.updated_at,
  });
  return cached;
}

module.exports = {
  ensureBotInstance,
  getSessionForUser,
  syncStatusCache,
  getBotInstanceForUser,
  startSession,
  stopSession,
};
