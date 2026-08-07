/**
 * Option 2 D follow-up — GET /trading/account-info proxy for the
 * Confirm Live modal. Proves:
 *   1. Live equity/balance come from the connector, not the paper ledger
 *   2. Login mismatch (attached terminal ≠ stored credentials) → 422
 *   3. No broker connection → 404
 *
 * Requires the local MT5 connector + an attached terminal (same as
 * smoke-mt5-order-46.js). Aborts cleanly if the connector is unreachable
 * rather than failing the suite — this is environmental, not a code defect.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const http = require('http');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const app = require('../src/app');
const { encryptCredentials } = require('../src/services/credential-crypto.service');
const mt5Connector = require('../src/services/mt5-connector.client');
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
  let liveInfo;
  try {
    liveInfo = await mt5Connector.getAccountInfo();
  } catch (err) {
    console.log('OPTION2_D_ACCOUNT_INFO_SKIP_CONNECTOR_UNAVAILABLE', err.message);
    process.exitCode = 0;
    return;
  }
  console.log('live_connector_account', {
    login: liveInfo.login,
    account_type: liveInfo.account_type,
    equity: liveInfo.equity,
    balance: liveInfo.balance,
  });

  await connectRedis();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

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

  const email = `option2dai_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await call('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  const userId = r.json.user.id;

  r = await call('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  // --- No broker yet ---
  r = await call('GET', '/trading/account-info', { token });
  console.log('account_info_no_broker', r.status, r.json.error && r.json.error.code);
  assert(r.status === 404 && r.json.error.code === 'NO_BROKER_CONNECTION', 'expected NO_BROKER_CONNECTION');

  // Seed with credentials whose login matches the attached terminal.
  // Password/server are not used by getAccountInfo (terminal already
  // attached) — only login is checked for the mismatch guard.
  const matchingCreds = encryptCredentials({
    login: String(liveInfo.login),
    password: 'unused-for-account-info-read',
    server: 'MetaQuotes-Demo',
  });
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', $2, 'connected', $3, now(), now())`,
    [userId, matchingCreds, liveInfo.account_type]
  );

  r = await call('GET', '/trading/account-info', { token });
  console.log('account_info_success', r.status, r.json);
  assert(r.status === 200, `account-info should succeed: ${JSON.stringify(r.json)}`);
  assert(r.json.login === liveInfo.login, 'login must match connector');
  assert(r.json.account_type === liveInfo.account_type, 'account_type must match connector');
  assert(r.json.equity === liveInfo.equity, 'equity must be the live connector value, not a paper ledger');
  assert(r.json.balance === liveInfo.balance, 'balance must be the live connector value');
  assert(r.json.broker_name === 'mt5', 'broker_name from DB');
  assert(r.json.broker_connection_id, 'broker_connection_id present');
  // Explicit non-paper proof: the paper seed is $10; a real demo/real
  // equity matching that by coincidence is vanishingly unlikely, but
  // the equality-to-connector asserts above are the real proof.
  assert(
    typeof r.json.equity === 'number' && Number.isFinite(r.json.equity),
    'equity must be a finite number'
  );

  // --- Login mismatch: rewrite stored credentials to a different login ---
  const mismatchedCreds = encryptCredentials({
    login: String(Number(liveInfo.login) + 999001),
    password: 'unused',
    server: 'MetaQuotes-Demo',
  });
  await client.query(
    `UPDATE broker_connections SET encrypted_credentials = $1 WHERE user_id = $2`,
    [mismatchedCreds, userId]
  );

  r = await call('GET', '/trading/account-info', { token });
  console.log('account_info_mismatch', r.status, r.json.error && r.json.error.code);
  assert(
    r.status === 422 && r.json.error.code === 'BROKER_ACCOUNT_MISMATCH',
    'expected BROKER_ACCOUNT_MISMATCH when stored login ≠ attached terminal'
  );

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  redis.disconnect();

  console.log('OPTION2_D_ACCOUNT_INFO_PASS');
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
