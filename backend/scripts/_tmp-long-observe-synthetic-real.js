'use strict';

/**
 * Long-window synthetics REAL observe (demo 6255429).
 * - confirm-live + Start
 * - MI gate snapshots every 20m (all watchlist instruments)
 * - watch for genuine open → clamp/placeOrder evidence chain → close
 * - Stop synthetics at end either way
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  ACCESS_GATE_PHRASE,
  ACCESS_GATE_COOKIE_NAME,
  SYNTHETIC_REAL_TRADING_ENABLED,
  SYNTHETIC_REAL_TRADING_ALLOW_DEMO,
} = require('../src/config/env');
const { resolveExecutionMode } = require('../src/engine/execution-mode');
const {
  computeFreshSyntheticMarketIntelligence,
} = require('../src/engine/synthetic-market-intelligence.service');
const { SYNTHETIC_WATCHLIST } = require(path.join(
  __dirname,
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'watchlist.js'
));

const API = 'http://localhost:3000/api/v1';
const CONNECTOR = 'http://127.0.0.1:3100';
const EMAIL = 'syn_confirm_browser@telos.test';
const PASSWORD = 'Password123!';
const PHRASE = 'I CONFIRM LIVE TRADING WITH REAL MONEY';
// Prefer LONG_OBSERVE_MS so a leftover short OBSERVE_MS from prior
// scripts cannot silently shrink a multi-hour watch.
const WATCH_MS =
  Number(process.env.LONG_OBSERVE_MS) ||
  Number(process.env.OBSERVE_MS) ||
  3.5 * 60 * 60 * 1000; // 3.5h default
const POLL_MS = 5000;
const SNAPSHOT_MS = Number(process.env.GATE_SNAPSHOT_MS) || 20 * 60 * 1000;
// Layer-2 confirm TTL is 15 minutes; re-arm before it lapses so ticks
// stay on REAL dispatch for the whole multi-hour window.
const REARM_MS = Number(process.env.CONFIRM_REARM_MS) || 12 * 60 * 1000;
const OUT_DIR = path.join(__dirname, '_long-observe-out');
const LOG_PATH = path.join(OUT_DIR, `observe-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function log(obj) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...obj });
  console.log(line);
  fs.appendFileSync(LOG_PATH, `${line}\n`);
}

async function req(method, pathName, { token, cookie, body, base = API } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathName}`, {
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
  return { status: res.status, data, setCookie };
}

function extractGateCookie(setCookie, name) {
  for (const line of setCookie || []) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(line);
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

async function snapshotGates() {
  const instruments = [];
  for (const symbol of SYNTHETIC_WATCHLIST) {
    try {
      const mi = await computeFreshSyntheticMarketIntelligence(symbol);
      instruments.push({
        symbol,
        trend_quality: mi.trend_quality,
        market_volatility: mi.market_volatility,
        ADX: mi.diagnostics?.currentADX ?? null,
        vol_ratio: mi.diagnostics?.volatilityRatio ?? null,
        currentATR: mi.diagnostics?.currentATR ?? null,
        rollingAvgATR: mi.diagnostics?.rollingAvgATR ?? null,
        stale: Boolean(mi.stale),
        reason: mi.reason || null,
        // gate proximity helpers (starter regimes)
        ema_gate_open: Number(mi.trend_quality) >= 0.6,
        rsi_gate_open: Number(mi.trend_quality) <= 0.4,
        breakout_vol_gate_open: mi.market_volatility === 'HIGH',
      });
    } catch (err) {
      instruments.push({ symbol, error: err.message });
    }
  }
  return { instruments };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log({
    event: 'boot',
    watch_ms: WATCH_MS,
    snapshot_ms: SNAPSHOT_MS,
    log_path: LOG_PATH,
    predictedMode: resolveExecutionMode({
      realTradingEnabled: SYNTHETIC_REAL_TRADING_ENABLED,
      accountType: 'demo',
      liveTradingConfirmedAt: new Date(),
      allowDemoRealExecution: SYNTHETIC_REAL_TRADING_ALLOW_DEMO,
    }),
    flags: {
      SYNTHETIC_REAL_TRADING_ENABLED,
      SYNTHETIC_REAL_TRADING_ALLOW_DEMO,
    },
  });

  const predicted = resolveExecutionMode({
    realTradingEnabled: SYNTHETIC_REAL_TRADING_ENABLED,
    accountType: 'demo',
    liveTradingConfirmedAt: new Date(),
    allowDemoRealExecution: SYNTHETIC_REAL_TRADING_ALLOW_DEMO,
  });
  if (predicted !== 'real') throw new Error(`predictedMode=${predicted}, need real`);

  const acct = await req('GET', '/account-info', { base: CONNECTOR });
  log({ event: 'connector_account', data: acct.data });
  if (acct.data?.login !== 6255429) throw new Error(`wrong login ${acct.data?.login}`);

  const verify = await req('POST', '/access-gate/verify', {
    body: { attempt: ACCESS_GATE_PHRASE },
  });
  const cookie = extractGateCookie(verify.setCookie, ACCESS_GATE_COOKIE_NAME);
  const login = await req('POST', '/auth/login', {
    cookie,
    body: { email: EMAIL, password: PASSWORD },
  });
  if (login.status !== 200 || !login.data?.token) {
    throw new Error(`login failed ${login.status}`);
  }
  const token = login.data.token;

  await req('POST', '/bot/synthetic/stop', { token, cookie });
  const confirm = await req('POST', '/bot/synthetic/confirm-live', {
    token,
    cookie,
    body: { confirmationPhrase: PHRASE },
  });
  log({
    event: 'confirm_live',
    status: confirm.status,
    confirmed_at: confirm.data?.synthetic_live_trading_confirmed_at || null,
  });
  if (confirm.status !== 200) throw new Error('confirm-live failed');

  const start = await req('POST', '/bot/synthetic/start', { token, cookie });
  log({
    event: 'start',
    status: start.status,
    synthetic_status: start.data?.synthetic_status,
    synthetic_active_trading_balance: start.data?.synthetic_active_trading_balance,
  });
  if (start.status !== 200 || start.data?.synthetic_status !== 'running') {
    throw new Error('start failed');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const botId = start.data.bot_instance_id;
  const windowStart = new Date().toISOString();

  // Baseline: decisions before this window
  const baseline = await client.query(
    `SELECT count(*)::int AS n, max(timestamp) AS latest
     FROM bot_decision_log WHERE bot_instance_id = $1`,
    [botId]
  );
  log({ event: 'decision_baseline', ...baseline.rows[0], windowStart });

  // Immediate gate snapshot at t0
  const snap0 = await snapshotGates();
  log({ event: 'gate_snapshot', index: 0, ...snap0 });

  const started = Date.now();
  let nextSnapAt = started + SNAPSHOT_MS;
  let nextRearmAt = started + REARM_MS;
  let lastConfirmAt = confirm.data?.synthetic_live_trading_confirmed_at || new Date().toISOString();
  let snapIndex = 1;
  let openRow = null;
  let closedRow = null;
  let lastDecisionKey = null;
  let pollCount = 0;
  let errorSeen = false;
  let rearmCount = 0;

  while (Date.now() - started < WATCH_MS) {
    pollCount += 1;

    if (Date.now() >= nextSnapAt) {
      const snap = await snapshotGates();
      log({ event: 'gate_snapshot', index: snapIndex, ...snap });
      snapIndex += 1;
      nextSnapAt += SNAPSHOT_MS;
    }

    // Keep REAL mode armed: stop→confirm→start before 15m TTL expires,
    // but never interrupt an open real position mid-flight.
    if (Date.now() >= nextRearmAt && !openRow) {
      log({ event: 'rearm_begin', lastConfirmAt, rearmCount });
      await req('POST', '/bot/synthetic/stop', { token, cookie });
      const reConfirm = await req('POST', '/bot/synthetic/confirm-live', {
        token,
        cookie,
        body: { confirmationPhrase: PHRASE },
      });
      const reStart = await req('POST', '/bot/synthetic/start', { token, cookie });
      lastConfirmAt = reConfirm.data?.synthetic_live_trading_confirmed_at || null;
      rearmCount += 1;
      nextRearmAt = Date.now() + REARM_MS;
      log({
        event: 'rearm_done',
        rearmCount,
        confirm_status: reConfirm.status,
        confirmed_at: lastConfirmAt,
        start_status: reStart.status,
        synthetic_status: reStart.data?.synthetic_status,
      });
      if (reStart.data?.synthetic_status !== 'running') {
        errorSeen = true;
        log({ event: 'rearm_failed', session: reStart.data });
        break;
      }
    }

    const [decisions, positions, connPos, sess] = await Promise.all([
      req('GET', '/trading/decision-log?page=1&limit=8&asset_class=synthetic', {
        token,
        cookie,
      }).catch(async () =>
        req('GET', '/trading/decision-log?page=1&limit=8', { token, cookie })
      ),
      req('GET', '/trading/positions', { token, cookie }),
      req('GET', '/positions', { base: CONNECTOR }),
      req('GET', '/bot/synthetic/session', { token, cookie }),
    ]);

    const newest = (decisions.data?.data || [])[0];
    const key = newest ? `${newest.id}:${newest.decision_type}` : null;
    if (key && key !== lastDecisionKey) {
      lastDecisionKey = key;
      // Only treat as "new this window" if timestamp >= windowStart
      const ts = newest?.timestamp || newest?.created_at;
      if (ts && new Date(ts) >= new Date(windowStart)) {
        log({ event: 'new_decision', decision: newest });
      }
    }

    const dbNew = await client.query(
      `SELECT id, timestamp, decision_type, triggering_condition,
              details->>'symbol' AS symbol,
              details->>'calculatedSize' AS calculated_size,
              details->'sizing' AS sizing,
              details->'clamped' AS clamped,
              details->'symbolInfo' AS symbol_info
       FROM bot_decision_log
       WHERE bot_instance_id = $1 AND timestamp >= $2::timestamptz
       ORDER BY timestamp DESC
       LIMIT 10`,
      [botId, windowStart]
    );

    const dbOpen = (
      await client.query(
        `SELECT * FROM trades
         WHERE user_id = (SELECT id FROM users WHERE email = $1)
           AND asset_class = 'synthetic'
           AND status = 'open'
         ORDER BY opened_at DESC NULLS LAST
         LIMIT 1`,
        [EMAIL]
      )
    ).rows[0];

    if (dbOpen && !openRow) {
      openRow = dbOpen;
      log({
        event: 'db_open',
        trade: dbOpen,
        api_positions: positions.data,
        connector_positions: connPos.data,
        session_panel: {
          synthetic_status: sess.data?.synthetic_status,
          synthetic_active_trading_balance: sess.data?.synthetic_active_trading_balance,
          synthetic_peak_equity: sess.data?.synthetic_peak_equity,
          synthetic_current_tier: sess.data?.synthetic_current_tier,
          synthetic_live_trading_confirmed_at: sess.data?.synthetic_live_trading_confirmed_at,
        },
        recent_decisions: dbNew.rows,
      });
    }

    if (openRow && !closedRow) {
      const row = (await client.query(`SELECT * FROM trades WHERE id = $1`, [openRow.id])).rows[0];
      if (row?.status === 'closed') {
        closedRow = row;
        let orderHistory = null;
        if (row.broker_ticket) {
          const hist = await req('GET', `/order/history?ticket=${row.broker_ticket}`, {
            base: CONNECTOR,
          });
          orderHistory = hist.data;
        }
        log({
          event: 'db_closed',
          trade: row,
          order_history: orderHistory,
          connector_positions: (await req('GET', '/positions', { base: CONNECTOR })).data,
          session_panel: (await req('GET', '/bot/synthetic/session', { token, cookie })).data,
        });
        break; // full evidence chain captured
      }
    }

    if (sess.data?.synthetic_status === 'error') {
      errorSeen = true;
      log({ event: 'session_error', session: sess.data });
      break;
    }

    if (sess.data?.synthetic_status !== 'running' && !openRow) {
      log({ event: 'session_not_running', session: sess.data });
      // try once to detect stall; don't auto-restart — report
      errorSeen = true;
      break;
    }

    if (pollCount % 24 === 0) {
      // ~2 min heartbeat
      log({
        event: 'heartbeat',
        elapsed_ms: Date.now() - started,
        synthetic_status: sess.data?.synthetic_status,
        confirmed_at: sess.data?.synthetic_live_trading_confirmed_at || null,
        lastConfirmAt,
        rearmCount,
        decisions_in_window: dbNew.rowCount,
        latest_in_window: dbNew.rows[0]
          ? {
              type: dbNew.rows[0].decision_type,
              trigger: dbNew.rows[0].triggering_condition,
              calc: dbNew.rows[0].calculated_size,
              sizing: dbNew.rows[0].sizing,
            }
          : null,
        db_open: Boolean(dbOpen),
      });
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Final gate snapshot
  const snapFinal = await snapshotGates();
  log({ event: 'gate_snapshot', index: snapIndex, final: true, ...snapFinal });

  const windowDecisions = await client.query(
    `SELECT id, timestamp, decision_type, triggering_condition,
            details->>'symbol' AS symbol,
            details->>'calculatedSize' AS calculated_size,
            details->'sizing' AS sizing,
            details->'clamped' AS clamped
     FROM bot_decision_log
     WHERE bot_instance_id = $1 AND timestamp >= $2::timestamptz
     ORDER BY timestamp ASC`,
    [botId, windowStart]
  );

  const stop = await req('POST', '/bot/synthetic/stop', { token, cookie });
  log({
    event: 'stop',
    status: stop.status,
    synthetic_status: stop.data?.synthetic_status,
  });

  await client.end();

  log({
    event: 'done',
    sawOpen: Boolean(openRow),
    sawClose: Boolean(closedRow),
    errorSeen,
    rearmCount,
    elapsed_ms: Date.now() - started,
    gate_snapshots: snapIndex + 1,
    decisions_in_window: windowDecisions.rows.length,
    decisions: windowDecisions.rows,
    open_trade: openRow
      ? {
          id: openRow.id,
          execution_mode: openRow.execution_mode,
          broker_ticket: openRow.broker_ticket,
          lot_size: openRow.lot_size,
          symbol: openRow.symbol,
        }
      : null,
    closed_trade: closedRow
      ? {
          id: closedRow.id,
          exit_price: closedRow.exit_price,
          pnl: closedRow.pnl,
          broker_ticket: closedRow.broker_ticket,
        }
      : null,
    log_path: LOG_PATH,
  });
})().catch((e) => {
  console.error('OBSERVE_FAIL', e);
  try {
    fs.appendFileSync(
      LOG_PATH,
      `${JSON.stringify({ t: new Date().toISOString(), event: 'fatal', error: String(e.stack || e) })}\n`
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
