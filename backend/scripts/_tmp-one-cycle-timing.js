'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const {
  ACCESS_GATE_PHRASE,
  ACCESS_GATE_COOKIE_NAME,
} = require('../src/config/env');
const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('../src/engine/live-trading-confirmation');

const API = 'http://localhost:3000/api/v1';
const EMAIL = 'syn_confirm_browser@telos.test';
const PASSWORD = 'Password123!';
const SYMBOL = 'Volatility 10 Index';

async function api(method, path, { token, cookie, body } = {}) {
  const t0 = performance.now();
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, http_ms: Math.round(performance.now() - t0) };
}

async function main() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const u = await pg.query(`SELECT id, role FROM users WHERE email = $1`, [EMAIL]);
  const uid = u.rows[0].id;
  const prior = u.rows[0].role;
  await pg.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [uid]);

  try {
    const gate = await fetch(`${API}/access-gate/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt: ACCESS_GATE_PHRASE }),
    });
    const cookie =
      (gate.headers.getSetCookie?.() || [])
        .find((c) => c.startsWith(`${ACCESS_GATE_COOKIE_NAME}=`))
        ?.split(';')[0] || null;
    const login = await api('POST', '/auth/login', {
      cookie,
      body: { email: EMAIL, password: PASSWORD },
    });
    const token = login.json.token;

    for (const [getP, enableP] of [
      ['demo-confirm-status', 'demo-confirm-enable'],
      ['demo-dispatch-status', 'demo-dispatch-enable'],
      ['demo-manual-trade-status', 'demo-manual-trade-enable'],
    ]) {
      const st = await api('GET', `/admin/synthetic/${getP}`, { token, cookie });
      if (!st.json?.enabled) {
        await api('POST', `/admin/synthetic/${enableP}`, {
          token,
          cookie,
          body: { minutes: 30 },
        });
      }
    }

    // Always stop first (idempotent) so confirm-live is allowed.
    const stop = await api('POST', '/bot/synthetic/stop', { token, cookie });
    console.log('STOP', stop.status, stop.json?.synthetic_status);
    const conf = await api('POST', '/bot/synthetic/confirm-live', {
      token,
      cookie,
      body: { confirmationPhrase: LIVE_TRADING_CONFIRMATION_PHRASE },
    });
    console.log('CONFIRM', conf.status, conf.json?.synthetic_live_trading_confirmed_at);
    if (conf.status >= 400) throw new Error(`confirm failed: ${JSON.stringify(conf.json)}`);

    const start = await api('POST', '/bot/synthetic/start', { token, cookie });
    console.log('START', start.status, start.json?.synthetic_status);
    if (start.status >= 400 || start.json?.synthetic_status !== 'running') {
      throw new Error(`start failed: ${JSON.stringify(start.json)}`);
    }

    const leftover = await pg.query(
      `SELECT id FROM trades WHERE user_id = $1 AND status = 'open' AND asset_class = 'synthetic'`,
      [uid]
    );
    if (leftover.rows[0]) {
      const cl = await api('POST', '/bot/synthetic/test-close-real', {
        token,
        cookie,
        body: { tradeId: leftover.rows[0].id },
      });
      console.log('LEFTOVER_CLOSE', cl.status, cl.http_ms);
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log('=== CLIENT OPEN START ===');
    const open = await api('POST', '/bot/synthetic/test-dispatch-real', {
      token,
      cookie,
      body: { symbol: SYMBOL, direction: 'BUY' },
    });
    console.log(
      'CLIENT_OPEN',
      JSON.stringify({
        status: open.status,
        http_ms: open.http_ms,
        trade_id: open.json?.trade?.id,
        ticket: open.json?.trade?.broker_ticket,
        place_diag: open.json?.place_order?._diag_timing || null,
      })
    );
    if (open.status >= 400 || !open.json?.trade?.id) {
      console.log('OPEN_FAIL', JSON.stringify(open.json));
      return;
    }

    console.log('=== CLIENT CLOSE START ===');
    const close = await api('POST', '/bot/synthetic/test-close-real', {
      token,
      cookie,
      body: { tradeId: open.json.trade.id },
    });
    console.log(
      'CLIENT_CLOSE',
      JSON.stringify({
        status: close.status,
        http_ms: close.http_ms,
        trade_status: close.json?.trade?.status,
        close_diag: close.json?.close_order?._diag_timing || null,
      })
    );
  } finally {
    await pg.query(`UPDATE users SET role = $2 WHERE id = $1`, [uid, prior]);
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
