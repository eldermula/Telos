'use strict';

/**
 * Frontend-facing WebSocket server at /ws?token=<jwt>
 * (06_API_Specification.md Section 11 / Section 15).
 *
 * Auth: same JWT as REST. Subscribes to Redis `bot-events:{bot_instance_id}`
 * for the user's bot instance and forwards events to the socket.
 * Access gate (Phase 8.5): when configured, the same httpOnly cookie
 * required by REST is checked on the upgrade request.
 */

const { WebSocketServer } = require('ws');
const Redis = require('ioredis');
const { URL } = require('url');
const { REDIS_URL } = require('../config/env');
const { verifyToken, isTokenBlacklisted } = require('../services/session.service');
const accessGateService = require('../services/access-gate.service');
const botInstanceRepository = require('../engine/bot-instance.repository');
const { channelFor } = require('../engine/event-publisher');

function sendJson(socket, data) {
  if (socket.readyState === 1 /* OPEN */) {
    socket.send(JSON.stringify(data));
  }
}

function closeWithError(socket, code, message) {
  try {
    sendJson(socket, { event: 'connection.error', payload: { scope: 'bot', message, code } });
  } catch {
    /* ignore */
  }
  socket.close(code, message);
}

/**
 * Attach WebSocket upgrade handling to an existing HTTP server.
 * @param {import('http').Server} server
 * @returns {{ wss: WebSocketServer, close: () => Promise<void> }}
 */
function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  /** @type {Set<import('ioredis').Redis>} */
  const subscribers = new Set();

  wss.on('connection', async (socket, req) => {
    let sub = null;
    try {
      if (accessGateService.isGateConfigured() && !accessGateService.hasValidGateCookie(req)) {
        closeWithError(socket, 4403, 'Access gate required');
        return;
      }

      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/ws', `http://${host}`);
      const token = url.searchParams.get('token');
      if (!token) {
        closeWithError(socket, 4401, 'Missing token');
        return;
      }

      const payload = verifyToken(token);
      const blacklisted = await isTokenBlacklisted(payload.sub, payload.jti);
      if (blacklisted) {
        closeWithError(socket, 4401, 'Session invalidated');
        return;
      }

      const userId = payload.sub;
      const instance = await botInstanceRepository.findByUserId(userId);
      if (!instance) {
        sendJson(socket, {
          event: 'connection.ready',
          payload: { user_id: userId, bot_instance_id: null },
        });
        socket.on('close', () => {});
        return;
      }

      const channel = channelFor(instance.id);
      sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
      await sub.connect();
      subscribers.add(sub);

      await sub.subscribe(channel);
      sub.on('message', (ch, message) => {
        if (ch !== channel) return;
        try {
          const parsed = JSON.parse(message);
          sendJson(socket, {
            event: parsed.event,
            bot_instance_id: parsed.bot_instance_id,
            payload: parsed.payload,
            timestamp: parsed.timestamp,
          });
        } catch {
          /* ignore malformed */
        }
      });

      sendJson(socket, {
        event: 'connection.ready',
        payload: {
          user_id: userId,
          bot_instance_id: instance.id,
          channel,
        },
      });

      socket.on('close', () => {
        if (sub) {
          subscribers.delete(sub);
          sub.quit().catch(() => {});
          sub = null;
        }
      });

      socket.on('error', () => {
        if (sub) {
          subscribers.delete(sub);
          sub.quit().catch(() => {});
          sub = null;
        }
      });
    } catch (err) {
      closeWithError(socket, 4401, err.message || 'Unauthorized');
      if (sub) {
        subscribers.delete(sub);
        sub.quit().catch(() => {});
      }
    }
  });

  async function close() {
    for (const sub of subscribers) {
      try {
        await sub.quit();
      } catch {
        /* ignore */
      }
    }
    subscribers.clear();
    await new Promise((resolve) => wss.close(resolve));
  }

  return { wss, close };
}

module.exports = { attachWebSocketServer };
