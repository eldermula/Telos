'use strict';

/**
 * Evidence script for synthetics confirm-live walkthrough (Deriv-Demo).
 * Requires: backend up with SYNTHETIC_REAL_TRADING_ENABLED +
 * SYNTHETIC_ALLOW_DEMO_CONFIRM=true, access gate configured, and at least
 * one existing broker_connections row to clone (demo credentials).
 *
 * Clones broker credentials into a fresh user (same pattern as
 * smoke-synthetic-runtime-paper.js) so confirm-live can hit a real demo
 * account without re-entering MT5 passwords.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const { Client } = require('pg');
const {
  ACCESS_GATE_PHRASE,
  ACCESS_GATE_COOKIE_NAME,
} = require('../src/config/env');

const API = process.env.API_BASE || 'http://localhost:3000/api/v1';
const PHRASE = 'I CONFIRM LIVE TRADING WITH REAL MONEY';

async function req(method, path, { token, cookie, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (!setCookie.length) {
    const single = res.headers.get('set-cookie');
    if (single) setCookie = [single];
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, setCookie, text };
}

function extractGateCookie(setCookie, name) {
  if (!setCookie || !setCookie.length) return '';
  for (const raw of setCookie) {
    const part = raw.split(';')[0];
    if (part.startsWith(`${name}=`)) return part;
  }
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  console.log('=== 0) env flags (process that will be hit is the running server) ===');
  console.log(
    JSON.stringify(
      {
        SYNTHETIC_REAL_TRADING_ENABLED: process.env.SYNTHETIC_REAL_TRADING_ENABLED,
        SYNTHETIC_ALLOW_DEMO_CONFIRM: process.env.SYNTHETIC_ALLOW_DEMO_CONFIRM,
        NODE_ENV: process.env.NODE_ENV,
      },
      null,
      2
    )
  );

  console.log('=== 1) access-gate verify ===');
  const statusRes = await req('GET', '/access-gate/status');
  console.log(JSON.stringify({ status: statusRes.status, data: statusRes.data }, null, 2));
  let cookie = '';
  if (statusRes.data?.configured) {
    const verifyRes = await req('POST', '/access-gate/verify', {
      body: { attempt: ACCESS_GATE_PHRASE },
    });
    console.log(
      JSON.stringify(
        {
          status: verifyRes.status,
          data: verifyRes.data,
          setCookie: verifyRes.setCookie,
        },
        null,
        2
      )
    );
    cookie = extractGateCookie(verifyRes.setCookie, ACCESS_GATE_COOKIE_NAME);
    // verify returns 204 No Content on success (see access-gate.routes.js)
    if (!(verifyRes.status === 200 || verifyRes.status === 204) || !cookie) {
      throw new Error(
        `access-gate verify failed status=${verifyRes.status} cookie=${Boolean(cookie)}`
      );
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = Date.now();
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const email = `syn_confirm_${stamp}@telos.test`;

  console.log('=== 2) create user + clone demo broker_connection ===');
  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [email, hash]
    )
  ).rows[0].id;

  const existingConn = (
    await client.query(
      `SELECT id, account_type, broker_name, broker_id
       FROM broker_connections
       ORDER BY linked_at DESC
       LIMIT 1`
    )
  ).rows[0];
  if (!existingConn) {
    await client.end();
    throw new Error('No broker_connections row — link a Deriv-Demo account first');
  }
  console.log(JSON.stringify({ cloning_from: existingConn, userId, email }, null, 2));

  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, broker_id, encrypted_credentials, connection_status, account_type,
        linked_at, last_validated_at)
     SELECT $1, broker_name, broker_id || '-syn-confirm-' || $2::text, encrypted_credentials,
            connection_status, account_type, now(), now()
     FROM broker_connections WHERE id = $3`,
    [userId, String(stamp), existingConn.id]
  );

  const login = await req('POST', '/auth/login', {
    cookie,
    body: { email, password },
  });
  console.log(
    JSON.stringify(
      { status: login.status, email, has_token: Boolean(login.data?.token) },
      null,
      2
    )
  );
  const token = login.data?.token;
  if (!token) {
    await client.end();
    throw new Error(`login failed: ${JSON.stringify(login.data)}`);
  }

  console.log('=== 3) GET /bot/synthetic/session (PAPER) ===');
  const session1 = await req('GET', '/bot/synthetic/session', { token, cookie });
  console.log(JSON.stringify({ status: session1.status, data: session1.data }, null, 2));

  console.log('=== 4) GET /trading/account-info (modal loads this) ===');
  const acct = await req('GET', '/trading/account-info', { token, cookie });
  console.log(JSON.stringify({ status: acct.status, data: acct.data }, null, 2));

  console.log('=== 5) POST /bot/synthetic/confirm-live ===');
  const confirm = await req('POST', '/bot/synthetic/confirm-live', {
    token,
    cookie,
    body: { confirmationPhrase: PHRASE },
  });
  console.log(JSON.stringify({ status: confirm.status, data: confirm.data }, null, 2));

  console.log('=== 6) GET /bot/synthetic/session (after confirm — expect REAL) ===');
  const session2 = await req('GET', '/bot/synthetic/session', { token, cookie });
  console.log(JSON.stringify({ status: session2.status, data: session2.data }, null, 2));

  console.log('=== 7) GET /trading/account-info (live equity for REAL panel) ===');
  const acct2 = await req('GET', '/trading/account-info', { token, cookie });
  console.log(JSON.stringify({ status: acct2.status, data: acct2.data }, null, 2));

  console.log('=== 8) POST /bot/synthetic/stop (clear confirmation; already stopped) ===');
  const stop = await req('POST', '/bot/synthetic/stop', { token, cookie });
  console.log(JSON.stringify({ status: stop.status, data: stop.data }, null, 2));

  console.log('=== 9) GET /bot/synthetic/session (confirmed_at must be null) ===');
  const session3 = await req('GET', '/bot/synthetic/session', { token, cookie });
  console.log(JSON.stringify({ status: session3.status, data: session3.data }, null, 2));

  console.log('=== 10) second Stop while already stopped (still clears) ===');
  // Re-confirm then stop again to prove already-stopped clear path.
  const confirm2 = await req('POST', '/bot/synthetic/confirm-live', {
    token,
    cookie,
    body: { confirmationPhrase: PHRASE },
  });
  const stop2 = await req('POST', '/bot/synthetic/stop', { token, cookie });
  const session4 = await req('GET', '/bot/synthetic/session', { token, cookie });
  console.log(
    JSON.stringify(
      {
        reconfirm_status: confirm2.status,
        reconfirm_at: confirm2.data?.synthetic_live_trading_confirmed_at,
        stop2_status: stop2.status,
        stop2_confirmed_at: stop2.data?.synthetic_live_trading_confirmed_at,
        session_after_second_stop: session4.data?.synthetic_live_trading_confirmed_at,
        synthetic_status: session4.data?.synthetic_status,
      },
      null,
      2
    )
  );

  await client.query(`DELETE FROM broker_connections WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM bot_instances WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();

  console.log('=== DONE ===');
  console.log(
    JSON.stringify(
      {
        email,
        paper_balance: session1.data?.synthetic_active_trading_balance,
        paper_peak: session1.data?.synthetic_peak_equity,
        allow_demo: session1.data?.synthetic_allow_demo_confirm,
        real_available: session1.data?.synthetic_real_trading_available,
        account_type: session1.data?.account_type,
        confirm_status: confirm.status,
        confirmed_at_after_confirm: session2.data?.synthetic_live_trading_confirmed_at,
        live_equity_after_confirm: acct2.data?.equity ?? acct2.data?.balance,
        confirmed_at_after_stop: session3.data?.synthetic_live_trading_confirmed_at,
        confirmed_at_after_second_stop: session4.data?.synthetic_live_trading_confirmed_at,
      },
      null,
      2
    )
  );

  if (confirm.status !== 200) {
    throw new Error('confirm-live did not succeed — check SYNTHETIC_ALLOW_DEMO_CONFIRM on running server');
  }
  if (session3.data?.synthetic_live_trading_confirmed_at != null) {
    throw new Error('stop did not clear synthetic_live_trading_confirmed_at');
  }
}

main().catch((err) => {
  console.error('WALKTHROUGH_FAIL', err);
  process.exit(1);
});
