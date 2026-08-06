'use strict';

/**
 * Publish Engine events to Redis pub/sub channel
 * `bot-events:{bot_instance_id}` (05 Section 2 / 04 Section 5),
 * and keep the in-process event-bus for same-process listeners/tests.
 */

const { redis } = require('../db/redis');
const { bus, emitBotEvent: emitLocal } = require('./event-bus');

function channelFor(botInstanceId) {
  return `bot-events:${botInstanceId}`;
}

async function publishBotEvent(botInstanceId, event, payload) {
  const message = emitLocal(botInstanceId, event, payload);
  try {
    await redis.publish(channelFor(botInstanceId), JSON.stringify(message));
  } catch (err) {
    console.error('[event-publisher]', err.message);
  }
  return message;
}

module.exports = {
  bus,
  channelFor,
  publishBotEvent,
};
