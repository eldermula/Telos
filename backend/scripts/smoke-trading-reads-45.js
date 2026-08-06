/**
 * Phase 4.5 smoke — positions/orders/history/decision-log GETs.
 * Starts a paper session, runs a few controlled ticks, then reads back
 * each endpoint and asserts shape + pagination.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const app = require('../src/app');
const tradingEngine = require('../src/engine/trading-engine');
const { getRuntime, buildStubTradeInput } = require('../src/engine/bot-runtime');
const botStatusCache = require('../src/engine/bot-status.cache');
const http = require('http');

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

  const email = `reads45_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await req(base, 'POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  const userId = r.json.user.id;

  r = await req(base, 'POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  // No broker yet — all four reads should 404 NO_BROKER_CONNECTION
  for (const p of ['/trading/positions', '/trading/orders', '/trading/history', '/trading/decision-log']) {
    r = await req(base, 'GET', p, { token });
    assert(r.status === 404 && r.json.error.code === 'NO_BROKER_CONNECTION', `${p} expected 404, got ${r.status}`);
  }
  console.log('no_broker_404s_ok');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', now(), now())`,
    [userId]
  );

  r = await req(base, 'GET', '/trading/session', { token });
  assert(r.status === 200, 'session ensure failed');
  const botInstanceId = r.json.bot_instance_id;

  // Empty positions/orders/history/decision-log before any ticks
  r = await req(base, 'GET', '/trading/positions', { token });
  assert(r.status === 200 && Array.isArray(r.json) && r.json.length === 0, 'expected empty positions');

  r = await req(base, 'GET', '/trading/orders', { token });
  assert(r.status === 200 && Array.isArray(r.json) && r.json.length === 0, 'expected empty orders');

  r = await req(base, 'GET', '/trading/history', { token });
  assert(r.status === 200 && r.json.data.length === 0 && r.json.meta.total === 0, 'expected empty history');
  assert(r.json.meta.page === 1 && r.json.meta.limit === 25, 'expected default pagination meta');

  r = await req(base, 'GET', '/trading/decision-log', { token });
  assert(r.status === 200 && r.json.data.length === 0 && r.json.meta.total === 0, 'expected empty decision-log');

  await tradingEngine.startSession(userId, { autoTick: false });
  const runtime = getRuntime(botInstanceId);
  assert(runtime, 'runtime missing');

  const tickResults = [];
  tickResults.push(await runtime.tickOnce(buildStubTradeInput(0)));
  tickResults.push(await runtime.tickOnce(buildStubTradeInput(1)));
  tickResults.push(await runtime.tickOnce(buildStubTradeInput(2)));
  // Circuit breakers/confidence gating can reject a tick (e.g. dropping
  // into STRATEGY_B raises the confidence bar) — don't hardcode a count,
  // derive the expected total from what actually got approved.
  const approvedCount = tickResults.filter((t) => t.trace.tradeApproved).length;
  console.log('approved_of_3_ticks', approvedCount);
  assert(approvedCount >= 2, `expected at least 2 approved trades, got ${approvedCount}`);

  r = await req(base, 'GET', '/trading/positions', { token });
  console.log('positions_after_ticks', r.status, r.json.length);
  assert(r.status === 200 && r.json.length === 0, 'paper harness should never leave a trade open');

  r = await req(base, 'GET', '/trading/orders', { token });
  assert(r.status === 200 && r.json.length === 0, 'orders should stay empty (no orders table yet)');

  r = await req(base, 'GET', '/trading/history?limit=1', { token });
  console.log('history_page1', r.status, r.json.meta, r.json.data.length);
  assert(r.status === 200, 'history failed');
  assert(r.json.meta.total === approvedCount, `expected total=${approvedCount}, got ${r.json.meta.total}`);
  assert(r.json.data.length === 1, 'expected limit=1 to cap page size');
  assert(r.json.meta.limit === 1, 'expected limit echoed in meta');
  const first = r.json.data[0];
  assert(first.status === 'closed', 'expected closed trade');
  assert(first.direction === 'BUY' || first.direction === 'SELL', 'expected direction');
  assert(typeof first.pnl === 'number', 'expected numeric pnl');

  if (approvedCount >= 2) {
    r = await req(base, 'GET', '/trading/history?page=2&limit=1', { token });
    assert(r.status === 200 && r.json.data.length === 1, 'expected 1 row on page 2');
  }

  r = await req(base, 'GET', '/trading/decision-log', { token });
  console.log('decision_log', r.status, r.json.meta, r.json.data.map((d) => d.decision_type));
  assert(r.status === 200, 'decision-log failed');
  assert(r.json.meta.total >= approvedCount, `expected at least ${approvedCount} decisions, got ${r.json.meta.total}`);
  assert(r.json.data.every((d) => d.bot_instance_id === botInstanceId), 'decision rows wrong bot_instance');
  assert(r.json.data.some((d) => d.decision_type === 'trade_approved'), 'expected trade_approved entries');

  // Unauthenticated
  r = await req(base, 'GET', '/trading/history');
  assert(r.status === 401, 'expected 401 without token');

  await tradingEngine.stopSession(userId);
  await botStatusCache.deleteStatus(botInstanceId);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  redis.disconnect();

  console.log('TRADING_READS_45_PASS');
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
