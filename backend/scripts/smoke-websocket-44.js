/**
 * Phase 4.4 smoke — WebSocket live events via Redis pub/sub.
 * Boots HTTP+WS on an ephemeral port; forces paper ticks; asserts
 * bot.status_changed / trade.closed / equity.updated over the socket.
 */
const path = require('path');
const http = require('http');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { WebSocket } = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const app = require('../src/app');
const { attachWebSocketServer } = require('../src/ws/websocket-server');
const tradingEngine = require('../src/engine/trading-engine');
const { getRuntime, buildStubTradeInput } = require('../src/engine/bot-runtime');
const botStatusCache = require('../src/engine/bot-status.cache');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(base, method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function waitForEvent(socket, eventName, { timeoutMs = 10000, predicate } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${eventName}`));
    }, timeoutMs);

    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.event !== eventName) return;
      if (predicate && !predicate(msg)) return;
      cleanup();
      resolve(msg);
    }

    function cleanup() {
      clearTimeout(timer);
      socket.off('message', onMessage);
    }

    socket.on('message', onMessage);
  });
}

function collectEvents(socket, bag) {
  socket.on('message', (raw) => {
    try {
      bag.push(JSON.parse(String(raw)));
    } catch {
      /* ignore */
    }
  });
}

async function main() {
  await connectRedis();

  const server = http.createServer(app);
  const { close: closeWs } = attachWebSocketServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  const email = `ws44_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await req(base, 'POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  const userId = r.json.user.id;

  r = await req(base, 'POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', now(), now())`,
    [userId]
  );

  r = await req(base, 'GET', '/trading/session', { token });
  assert(r.status === 200, `session ensure failed: ${JSON.stringify(r.json)}`);
  const botInstanceId = r.json.bot_instance_id;

  const received = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  collectEvents(socket, received);

  const ready = await waitForEvent(socket, 'connection.ready');
  console.log('ws_ready', ready.payload);
  assert(ready.payload.bot_instance_id === botInstanceId, 'ws bot_instance_id mismatch');

  const startedWait = waitForEvent(socket, 'bot.status_changed', {
    predicate: (m) => m.payload && m.payload.status === 'running',
  });
  await tradingEngine.startSession(userId, { autoTick: false });
  const started = await startedWait;
  console.log('ws_started', started.payload);

  const runtime = getRuntime(botInstanceId);
  assert(runtime, 'runtime missing');

  const tradeWait = waitForEvent(socket, 'trade.closed');
  const equityWait = waitForEvent(socket, 'equity.updated');
  await runtime.tickOnce(buildStubTradeInput(0));
  const tradeMsg = await tradeWait;
  const equityMsg = await equityWait;
  console.log('ws_trade', { pnl: tradeMsg.payload && tradeMsg.payload.pnl });
  console.log('ws_equity', equityMsg.payload);
  assert(tradeMsg.bot_instance_id === botInstanceId, 'trade event wrong bot');
  assert(equityMsg.payload.active_trading_balance != null, 'missing equity balance');

  const stopWait = waitForEvent(socket, 'bot.status_changed', {
    predicate: (m) => m.payload && m.payload.status === 'stopped',
  });
  r = await req(base, 'POST', '/trading/session/stop', { token });
  assert(r.status === 200 && r.json.status === 'stopped', 'stop failed');
  const stopped = await stopWait;
  console.log('ws_stopped', stopped.payload);

  socket.close();

  // Bad token should not stay open
  await new Promise((resolve) => {
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws?token=not-a-jwt`);
    const done = () => resolve();
    bad.on('close', done);
    bad.on('error', done);
    setTimeout(done, 3000);
  });

  await botStatusCache.deleteStatus(botInstanceId);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  await closeWs();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  redis.disconnect();

  console.log('events_seen', [...new Set(received.map((e) => e.event))]);
  console.log('WEBSOCKET_44_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
