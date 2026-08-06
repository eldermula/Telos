'use strict';

/**
 * In-process event bus for Engine ↔ (future) WebSocket fanout.
 * 4.3: local EventEmitter only. 4.4 will also publish to Redis
 * `bot-events:{bot_instance_id}` (05 Section 2 / 04 Section 5).
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function emitBotEvent(botInstanceId, event, payload) {
  const message = {
    event,
    bot_instance_id: botInstanceId,
    payload,
    timestamp: new Date().toISOString(),
  };
  bus.emit('bot-event', message);
  bus.emit(`bot-event:${botInstanceId}`, message);
  return message;
}

module.exports = {
  bus,
  emitBotEvent,
};
