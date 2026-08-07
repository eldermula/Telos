/**
 * Phase 8.1 smoke — general API rate limiting.
 *
 * `06_API_Specification.md` Section 15 only settled the flat default
 * (60/min GET, 10/min state-changing); this verifies both that default
 * and the specific tightened-below-default endpoints designed and
 * approved before implementing:
 *   - /auth/signup (pre-auth, IP-keyed, matches password-reset's 5/15min)
 *   - /trading/session/start (5/min — see rate-limit design discussion)
 *   - /admin/* GET (20/min) and the two live-risk-affecting PATCH
 *     routes (5/min)
 * Also verifies the route-template bucket key isn't bypassable by
 * varying a literal :id path param.
 *
 * Requires: Postgres + Redis reachable, API server on 127.0.0.1:3000.
 * Does NOT require the MT5 connector — /trading/session/start's rate
 * limit is proven by the count of 429s, not by exercising a real tick
 * loop (the session is stopped immediately after, before any ticking
 * could matter).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');

const BASE = 'http://127.0.0.1:3000/api/v1';

/**
 * This machine's localhost IP has almost certainly already tripped
 * (or come close to) the *login* rate limit from earlier smoke-test
 * runs sharing the same server process and 15-minute window — that
 * counter lives in Redis, so restarting the server doesn't reset it.
 * Since these are transient counters, not durable application state,
 * clearing every `ratelimit:*` key before this run (and before each
 * retry, if this script is re-run) is safe test hygiene, not a risk to
 * anything real.
 */
async function clearRateLimitKeys() {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  console.log(`cleared_${keys.length}_stale_ratelimit_keys`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
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

/** Fires `count` sequential requests, returns the array of statuses. */
async function fire(count, fn) {
  const statuses = [];
  for (let i = 0; i < count; i += 1) {
    const r = await fn(i);
    statuses.push(r.status);
  }
  return statuses;
}

function countRateLimited(statuses) {
  return statuses.filter((s) => s === 429).length;
}

async function main() {
  await connectRedis();
  await clearRateLimitKeys();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const stamp = Date.now();
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);

  const adminEmail = `ratelimit80_admin_${stamp}@telos.test`;
  const userAEmail = `ratelimit80_a_${stamp}@telos.test`;
  const userBEmail = `ratelimit80_b_${stamp}@telos.test`;

  const adminId = (
    await client.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`, [adminEmail, passwordHash])
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [adminId]);

  const userAId = (
    await client.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`, [userAEmail, passwordHash])
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userAId]);
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userAId]
  );

  const userBId = (
    await client.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`, [userBEmail, passwordHash])
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userBId]);

  const adminLogin = await req('POST', '/auth/login', { body: { email: adminEmail, password } });
  assert(adminLogin.status === 200 && adminLogin.json.token, `admin login failed: ${JSON.stringify(adminLogin.json)}`);
  const adminToken = adminLogin.json.token;

  const userALogin = await req('POST', '/auth/login', { body: { email: userAEmail, password } });
  assert(userALogin.status === 200 && userALogin.json.token, `userA login failed: ${JSON.stringify(userALogin.json)}`);
  const userAToken = userALogin.json.token;

  const userBLogin = await req('POST', '/auth/login', { body: { email: userBEmail, password } });
  assert(userBLogin.status === 200 && userBLogin.json.token, `userB login failed: ${JSON.stringify(userBLogin.json)}`);
  const userBToken = userBLogin.json.token;

  try {
    // --- 1. General write default: 10/min, 11th call 429s.
    const writeStatuses = await fire(11, () =>
      req('PATCH', '/settings/notifications', { token: userAToken, body: { bot_start: true } })
    );
    assert(countRateLimited(writeStatuses) === 1, `expected exactly 1 429 among 11 writes, got statuses: ${writeStatuses}`);
    assert(writeStatuses[10] === 429, `expected the 11th write to 429, got ${writeStatuses[10]}`);
    console.log('GENERAL_WRITE_DEFAULT_CONFIRMED (10/min)', writeStatuses);

    // --- 2. General read default: 60/min, 61st call 429s. Uses userB
    // (fresh bucket) so it isn't affected by test 1's writes above.
    const readStatuses = await fire(61, () => req('GET', '/settings/profile', { token: userBToken }));
    assert(countRateLimited(readStatuses) === 1, `expected exactly 1 429 among 61 reads, got count=${countRateLimited(readStatuses)}`);
    assert(readStatuses[60] === 429, `expected the 61st read to 429, got ${readStatuses[60]}`);
    console.log('GENERAL_READ_DEFAULT_CONFIRMED (60/min)');

    // --- 3. Route-template bucket key isn't bypassable by varying a
    // literal :id — admin GET is tightened to 20/min; fire 21 requests
    // against /admin/users/:id with a DIFFERENT random id each time.
    // If the bucket were keyed on the literal path, every request
    // would get its own fresh counter and none would 429.
    const idStatuses = await fire(21, () =>
      req('GET', `/admin/users/00000000-0000-0000-0000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`, {
        token: adminToken,
      })
    );
    assert(
      countRateLimited(idStatuses) === 1,
      `expected the route TEMPLATE (not literal :id) to be the bucket key - got statuses: ${idStatuses}`
    );
    assert(idStatuses[20] === 429, `expected the 21st varying-:id request to 429, got ${idStatuses[20]}`);
    console.log('ROUTE_TEMPLATE_KEY_CONFIRMED — varying :id did not bypass the tightened admin GET limit (20/min)');

    // --- 4. Tightened admin write: 5/min. No-op patch (re-sets tier 0
    // to its own current value) so this doesn't need a restore step.
    const currentTier0 = (
      await client.query(`SELECT step_size FROM risk_tier_config WHERE tier = 0`)
    ).rows[0];
    const patchStatuses = await fire(6, () =>
      req('PATCH', '/admin/risk-tiers/0', { token: adminToken, body: { step_size: Number(currentTier0.step_size) } })
    );
    assert(countRateLimited(patchStatuses) === 1, `expected exactly 1 429 among 6 admin patches, got: ${patchStatuses}`);
    assert(patchStatuses[5] === 429, `expected the 6th admin patch to 429, got ${patchStatuses[5]}`);
    console.log('ADMIN_TIGHTENED_WRITE_CONFIRMED (5/min)', patchStatuses);

    // --- 5. Pre-auth signup: 5/15min per IP, matches password-reset.
    // Distinct emails per attempt (schema requires uniqueness); the
    // limiter should still trip on attempt 6 regardless of per-request
    // validity, since it's counted before the controller runs.
    const signupStatuses = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await req('POST', '/auth/signup', {
        body: { email: `ratelimit80_signup_${stamp}_${i}@telos.test`, password: 'Password123!' },
      });
      signupStatuses.push(r.status);
    }
    assert(countRateLimited(signupStatuses) === 1, `expected exactly 1 429 among 6 signups, got: ${signupStatuses}`);
    assert(signupStatuses[5] === 429, `expected the 6th signup to 429, got ${signupStatuses[5]}`);
    console.log('SIGNUP_PREAUTH_TIGHTENED_CONFIRMED (5/15min per IP)', signupStatuses);
    // Clean up whichever signups actually succeeded (first 5, pre-429).
    await client.query(`DELETE FROM users WHERE email LIKE $1`, [`ratelimit80_signup_${stamp}_%@telos.test`]);

    // --- 6. Tightened trading session start: 5/min. Stopped
    // immediately after so no real autoTick loop keeps running.
    const startStatuses = await fire(6, () => req('POST', '/trading/session/start', { token: userAToken }));
    assert(countRateLimited(startStatuses) === 1, `expected exactly 1 429 among 6 session starts, got: ${startStatuses}`);
    assert(startStatuses[5] === 429, `expected the 6th session start to 429, got ${startStatuses[5]}`);
    console.log('TRADING_SESSION_START_TIGHTENED_CONFIRMED (5/min)', startStatuses);

    const stopRes = await req('POST', '/trading/session/stop', { token: userAToken });
    assert(stopRes.status === 200, `expected session stop to succeed (separate bucket): ${JSON.stringify(stopRes.json)}`);
  } finally {
    await client.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [adminId, userAId, userBId]);
    await client.end();
    await clearRateLimitKeys();
    redis.disconnect();
  }

  console.log('RATE_LIMIT_80_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
