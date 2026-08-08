'use strict';

/**
 * Phase 8.6 Zod groups B + C smoke.
 * B: garbage pagination → 422 (no silent coerce).
 * C: bad range / status / tier → 422 at the controller edge.
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { ACCESS_GATE_COOKIE_NAME } = require('../src/config/env');

const BASE = 'http://127.0.0.1:3000/api/v1';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractGateCookie(setCookie, cookieName) {
  for (const line of setCookie || []) {
    const m = new RegExp(`^${cookieName}=([^;]+)`).exec(line);
    if (m) return `${cookieName}=${m[1]}`;
  }
  return null;
}

async function req(method, urlPath, { token, body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
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
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie };
}

function errCode(json) {
  return json?.error?.code || json?.code;
}

async function main() {
  let gateCookie;
  const statusRes = await req('GET', '/access-gate/status');
  if (statusRes.json && statusRes.json.configured) {
    const verifyRes = await req('POST', '/access-gate/verify', {
      body: { attempt: process.env.ACCESS_GATE_PHRASE },
    });
    gateCookie = extractGateCookie(verifyRes.setCookie, ACCESS_GATE_COOKIE_NAME);
    assert(gateCookie, `expected gate cookie: ${JSON.stringify(verifyRes.json)}`);
  }
  const call = (method, urlPath, opts = {}) =>
    req(method, urlPath, { ...opts, cookie: gateCookie });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = Date.now();
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const adminEmail = `zodbc_admin_${stamp}@telos.test`;
  const userEmail = `zodbc_user_${stamp}@telos.test`;

  const adminId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [adminEmail, hash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [adminId]);
  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [userEmail, hash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);

  try {
    const adminLogin = await call('POST', '/auth/login', { body: { email: adminEmail, password } });
    assert(adminLogin.status === 200, `admin login: ${JSON.stringify(adminLogin.json)}`);
    const adminToken = adminLogin.json.token;

    const userLogin = await call('POST', '/auth/login', { body: { email: userEmail, password } });
    assert(userLogin.status === 200, `user login: ${JSON.stringify(userLogin.json)}`);
    const userToken = userLogin.json.token;

    const badPage = await call('GET', '/notifications?page=abc', { token: userToken });
    assert(badPage.status === 422, `page=abc expected 422, got ${badPage.status}`);
    assert(errCode(badPage.json) === 'VALIDATION_ERROR', 'page code');

    const badLimit = await call('GET', '/trading/history?limit=999', { token: userToken });
    assert(badLimit.status === 422, `limit=999 expected 422, got ${badLimit.status}`);

    const okPage = await call('GET', '/notifications?page=1&limit=10', { token: userToken });
    assert(okPage.status === 200, `valid pagination expected 200, got ${okPage.status}`);

    const badRange = await call('GET', '/portfolio/performance?range=1y', { token: userToken });
    assert(badRange.status === 422, `range=1y expected 422, got ${badRange.status}`);

    const okRange = await call('GET', '/portfolio/performance?range=7d', { token: userToken });
    assert(okRange.status === 200, `range=7d expected 200, got ${okRange.status}`);

    const badStatus = await call('GET', '/admin/candidate-strategies?status=draft', {
      token: adminToken,
    });
    assert(badStatus.status === 422, `status=draft expected 422, got ${badStatus.status}`);

    const badTier = await call('PATCH', '/admin/risk-tiers/9', {
      token: adminToken,
      body: { base_risk: 0.01 },
    });
    assert(badTier.status === 422, `tier=9 expected 422, got ${badTier.status}`);

    console.log('ZOD_BC_86_PASS');
  } finally {
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, userId]]);
    await client.end();
  }
}

main().catch((err) => {
  console.error('ZOD_BC_86_FAIL', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
