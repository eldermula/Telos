/**
 * Phase 4.2 smoke — Trading REST session start/stop/get.
 * Boots Express on an ephemeral port (no separate server process).
 * Seeds a synthetic broker_connection so MT5 connector is not required.
 */
const path = require('path');
const http = require('http');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const app = require('../src/app');
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

async function main() {
  await connectRedis();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  const email = `trade42_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await req(base, 'POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  const userId = r.json.user.id;

  r = await req(base, 'POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  // No broker yet
  r = await req(base, 'GET', '/trading/session', { token });
  console.log('session_no_broker', r.status, r.json && r.json.error && r.json.error.code);
  assert(r.status === 404, 'expected 404 without broker');
  assert(r.json.error.code === 'NO_BROKER_CONNECTION', 'expected NO_BROKER_CONNECTION');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', now(), now())`,
    [userId]
  );

  r = await req(base, 'GET', '/trading/session', { token });
  console.log('session_initial', r.status, r.json);
  assert(r.status === 200, `session failed: ${JSON.stringify(r.json)}`);
  assert(r.json.status === 'stopped', 'expected stopped');
  assert(r.json.active_strategy_mode === 'STRATEGY_A', 'expected STRATEGY_A');
  assert(r.json.current_tier === 0, 'expected tier 0');
  const botInstanceId = r.json.bot_instance_id;
  assert(botInstanceId, 'missing bot_instance_id');

  r = await req(base, 'POST', '/trading/session/start', { token });
  console.log('start', r.status, r.json.status);
  assert(r.status === 200 && r.json.status === 'running', 'start failed');

  r = await req(base, 'GET', '/trading/session', { token });
  assert(r.status === 200 && r.json.status === 'running', 'session not running after start');

  const cached = await botStatusCache.getStatus(botInstanceId);
  assert(cached && cached.status === 'running', 'Redis cache not running');

  // Idempotent start
  r = await req(base, 'POST', '/trading/session/start', { token });
  assert(r.status === 200 && r.json.status === 'running', 'idempotent start failed');

  r = await req(base, 'POST', '/trading/session/stop', { token });
  console.log('stop', r.status, r.json.status);
  assert(r.status === 200 && r.json.status === 'stopped', 'stop failed');

  r = await req(base, 'GET', '/trading/session', { token });
  assert(r.status === 200 && r.json.status === 'stopped', 'session not stopped');

  // Unauthenticated
  r = await req(base, 'GET', '/trading/session');
  assert(r.status === 401, 'expected 401 without token');

  await botStatusCache.deleteStatus(botInstanceId);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  redis.disconnect();

  console.log('TRADING_SESSION_42_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
