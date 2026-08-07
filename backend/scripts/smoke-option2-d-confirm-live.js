/**
 * Option 2 (real order placement), Increment D smoke — the live-trading
 * confirmation endpoint (POST /trading/session/confirm-live), its four
 * ordered preconditions, the Stop-side clearing fix (including the
 * previously-buggy no-op-Stop branch), the 15-minute TTL lazy-expiry,
 * and the GET /trading/session shape additions (account_type,
 * live_trading_confirmed_at, real_trading_available).
 *
 * Boots Express in-process on an ephemeral port, same pattern as
 * smoke-trading-session-42.js. Seeds broker_connections directly via
 * Postgres (no MT5 connector required) so this can run standalone.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const http = require('http');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const app = require('../src/app');
const botStatusCache = require('../src/engine/bot-status.cache');
const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('../src/engine/live-trading-confirmation');
const { ACCESS_GATE_COOKIE_NAME } = require('../src/config/env');

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function extractGateCookie(setCookie, cookieName) {
  for (const line of setCookie || []) {
    const m = new RegExp(`^${cookieName}=([^;]+)`).exec(line);
    if (m) return `${cookieName}=${m[1]}`;
  }
  return null;
}

async function req(base, method, urlPath, { token, body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie };
}

async function main() {
  await connectRedis();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Access gate (Phase 8.5) may be configured in this env — verify it
  // first, same as every post-8.5 smoke, and carry the resulting cookie
  // on every subsequent call() below. isGateConfigured() is a no-op
  // pass-through when unset, so this stays harmless either way.
  let gateCookie;
  const statusRes = await req(base, 'GET', '/access-gate/status');
  if (statusRes.json && statusRes.json.configured) {
    const verifyRes = await req(base, 'POST', '/access-gate/verify', {
      body: { attempt: process.env.ACCESS_GATE_PHRASE },
    });
    gateCookie = extractGateCookie(verifyRes.setCookie, ACCESS_GATE_COOKIE_NAME);
    assert(gateCookie, `expected a gate cookie after verify: ${JSON.stringify(verifyRes)}`);
  }
  const call = (method, urlPath, opts = {}) =>
    req(base, method, urlPath, { ...opts, cookie: gateCookie });

  // rateLimit.write({ max: 5 }) on /session/confirm-live (correctly
  // tightened, same class as start/stop) would otherwise starve this
  // test's ~8 deliberate confirm-live calls well before it's done
  // exercising every precondition — that's the rate limiter working
  // as designed, already covered end-to-end by smoke-rate-limit-80.js,
  // not something this functional smoke needs to re-prove. Reset the
  // bucket before each call so it never interferes here.
  let confirmLiveRateLimitKey;
  const resetConfirmLiveRateLimit = async () => {
    if (confirmLiveRateLimitKey) await redis.del(confirmLiveRateLimitKey);
  };

  const email = `option2d_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await call('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  const userId = r.json.user.id;
  confirmLiveRateLimitKey = `ratelimit:${userId}:POST:/api/v1/trading/session/confirm-live`;

  r = await call('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  // Seed a demo broker connection — real MT5 connectivity not required
  // for this increment; account_type is what matters, not live credentials.
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userId]
  );

  r = await call('GET', '/trading/session', { token });
  assert(r.status === 200, `initial session failed: ${JSON.stringify(r.json)}`);
  const botInstanceId = r.json.bot_instance_id;
  console.log('session_shape_demo', {
    account_type: r.json.account_type,
    real_trading_available: r.json.real_trading_available,
    live_trading_confirmed_at: r.json.live_trading_confirmed_at,
  });
  assert(r.json.account_type === 'demo', 'expected account_type demo');
  assert(r.json.real_trading_available === false, 'demo account must never report real_trading_available');
  assert(r.json.live_trading_confirmed_at === null, 'expected no confirmation yet');

  // --- Precondition 3: wrong account type is rejected before the phrase is even checked ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: 'not even the right phrase' },
  });
  console.log('confirm_on_demo_account', r.status, r.json.error && r.json.error.code);
  assert(r.status === 409 && r.json.error.code === 'NOT_A_REAL_ACCOUNT', 'expected NOT_A_REAL_ACCOUNT on a demo account');

  // Promote to a real account directly in Postgres (simulating what
  // validateBrokerCredentials would have set from a real MT5 terminal).
  await client.query(`UPDATE broker_connections SET account_type = 'real' WHERE user_id = $1`, [userId]);

  // --- Zod validation: missing confirmationPhrase ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', { token, body: {} });
  console.log('confirm_missing_body', r.status, r.json.error && r.json.error.code);
  assert(r.status === 422 && r.json.error.code === 'VALIDATION_ERROR', 'expected VALIDATION_ERROR on missing confirmationPhrase');

  // --- Precondition 4: wrong phrase on a real account ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: 'close but not it' },
  });
  console.log('confirm_wrong_phrase', r.status, r.json.error && r.json.error.code);
  assert(r.status === 400 && r.json.error.code === 'CONFIRMATION_PHRASE_MISMATCH', 'expected CONFIRMATION_PHRASE_MISMATCH');

  // --- Success path: correct phrase, real account, stopped instance ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
  });
  console.log('confirm_success', r.status, {
    account_type: r.json.account_type,
    live_trading_confirmed_at: r.json.live_trading_confirmed_at,
  });
  assert(r.status === 200, `confirm-live should succeed: ${JSON.stringify(r.json)}`);
  assert(r.json.account_type === 'real', 'expected account_type real after promotion');
  assert(r.json.live_trading_confirmed_at !== null, 'expected a confirmation timestamp');
  const confirmedAtMs = new Date(r.json.live_trading_confirmed_at).getTime();
  assert(Math.abs(Date.now() - confirmedAtMs) < 5000, 'confirmation timestamp should be ~now');

  // GET /trading/session reflects it too, not just the POST response.
  r = await call('GET', '/trading/session', { token });
  assert(r.json.live_trading_confirmed_at !== null, 'GET session should reflect the fresh confirmation');

  // Idempotent reconfirm — no error, timestamp refreshes.
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
  });
  assert(r.status === 200, 'reconfirming while already confirmed should succeed idempotently');

  // --- Precondition 2: cannot confirm while running ---
  r = await call('POST', '/trading/session/start', { token });
  assert(r.status === 200 && r.json.status === 'running', `start failed: ${JSON.stringify(r.json)}`);

  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
  });
  console.log('confirm_while_running', r.status, r.json.error && r.json.error.code);
  assert(r.status === 409 && r.json.error.code === 'INSTANCE_MUST_BE_STOPPED', 'expected INSTANCE_MUST_BE_STOPPED while running');

  // --- Stop-side fix: a real running->stopped transition clears the confirmation ---
  r = await call('POST', '/trading/session/stop', { token });
  assert(r.status === 200 && r.json.status === 'stopped', `stop failed: ${JSON.stringify(r.json)}`);
  assert(r.json.live_trading_confirmed_at === null, 'Stop must clear the live-trading confirmation');

  r = await call('GET', '/trading/session', { token });
  assert(r.json.live_trading_confirmed_at === null, 'confirmation should stay cleared after Stop');

  // --- The no-op-Stop bug fix: confirm again, then Stop while ALREADY stopped ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
  });
  assert(r.status === 200 && r.json.live_trading_confirmed_at !== null, 'reconfirm before no-op-Stop test failed');

  r = await call('POST', '/trading/session/stop', { token });
  console.log('noop_stop_after_reconfirm', r.status, r.json.status, r.json.live_trading_confirmed_at);
  assert(r.status === 200 && r.json.status === 'stopped', 'no-op stop should still report 200/stopped');
  assert(r.json.live_trading_confirmed_at === null, 'no-op Stop (already stopped) must still clear a lingering confirmation');

  const cachedAfterNoopStop = await botStatusCache.getStatus(botInstanceId);
  assert(cachedAfterNoopStop.live_trading_confirmed_at === null, 'Redis cache must agree confirmation is cleared');

  // --- 15-minute TTL lazy expiry, exercised through the real HTTP path ---
  await resetConfirmLiveRateLimit();
  r = await call('POST', '/trading/session/confirm-live', {
    token,
    body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
  });
  assert(r.status === 200, 'confirm before TTL test failed');

  // Backdate the DB column past the 15-minute TTL directly — simulates
  // "confirmed 20 minutes ago, Start never happened, Stop never happened".
  await client.query(
    `UPDATE bot_instances SET live_trading_confirmed_at = now() - interval '20 minutes' WHERE id = $1`,
    [botInstanceId]
  );
  await botStatusCache.deleteStatus(botInstanceId); // force a fresh read, not a stale cache hit

  r = await call('GET', '/trading/session', { token });
  console.log('ttl_expired_session', r.json.live_trading_confirmed_at);
  assert(r.json.live_trading_confirmed_at === null, 'a 20-minute-old confirmation must report as expired (null), not as still active');

  // --- Notification recorded on successful confirmation ---
  const notif = await client.query(
    `SELECT type, message FROM notifications WHERE user_id = $1 AND type = 'live_trading_confirmed'`,
    [userId]
  );
  console.log('notifications_recorded', notif.rows.length);
  assert(notif.rows.length >= 1, 'expected at least one live_trading_confirmed notification');

  // Cleanup
  await botStatusCache.deleteStatus(botInstanceId);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  redis.disconnect();

  console.log('OPTION2_D_CONFIRM_LIVE_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
