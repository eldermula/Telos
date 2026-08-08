'use strict';

/**
 * Synthetics paper-mode live smoke against Deriv-Demo Volatility Index quotes.
 * Read-only MT5 (getSymbolInfo). Never MT5 order placement.
 *
 *   node backend/scripts/smoke-synthetic-runtime-paper.js
 */

const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { ACCESS_GATE_COOKIE_NAME } = require('../src/config/env');
const mt5Connector = require('../src/services/mt5-connector.client');
const {
  SyntheticBotRuntime,
  stopSyntheticRuntime,
} = require('../src/engine/synthetic-bot-runtime');
const botInstanceRepository = require('../src/engine/bot-instance.repository');
const { normalizeSyntheticContractSpec, SYNTHETIC_SYMBOLS } = require(
  '../src/engine/synthetic-contract-specs'
);
const { connectRedis } = require('../src/db/redis');

const BASE = 'http://127.0.0.1:3000/api/v1';
const SYMBOL = 'Volatility 10 Index';

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

function assertNoOrderImports() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'engine', 'synthetic-bot-runtime.js'),
    'utf8'
  );
  assert(!/\bplaceOrder\b|\bcloseOrder\b/.test(src), 'no order API identifiers');
  assert(!/require\(['"]\.\/bot-runtime/.test(src), 'must not import bot-runtime');
  assert(!/require\(['"]\.\/crypto-bot-runtime/.test(src), 'must not import crypto-bot-runtime');
}

async function main() {
  assertNoOrderImports();
  await connectRedis();

  const health = await fetch('http://127.0.0.1:3100/health').then((r) => r.json());
  assert(health.status === 'ok', 'connector health');

  const account = await fetch('http://127.0.0.1:3100/account-info').then((r) => r.json());
  assert(account.ok && account.account_type === 'demo', `expected demo: ${JSON.stringify(account)}`);
  console.log('ACCOUNT', { login: account.login, server_hint: 'Deriv-Demo expected' });

  for (const symbol of SYNTHETIC_SYMBOLS) {
    const info = await mt5Connector.getSymbolInfo(symbol);
    const spec = normalizeSyntheticContractSpec({ ...info, symbol });
    assert(spec.sizingReady, `${symbol} sizingReady`);
    assert(Number(info.bid) > 0 && Number(info.ask) > 0, `${symbol} live tick`);
    console.log('SYMBOL', symbol, {
      trade_contract_size: info.trade_contract_size,
      volume_min: info.volume_min,
      bid: info.bid,
      ask: info.ask,
    });
  }

  let gateCookie;
  const statusRes = await req('GET', '/access-gate/status');
  if (statusRes.json && statusRes.json.configured) {
    const verifyRes = await req('POST', '/access-gate/verify', {
      body: { attempt: process.env.ACCESS_GATE_PHRASE },
    });
    gateCookie = extractGateCookie(verifyRes.setCookie, ACCESS_GATE_COOKIE_NAME);
    assert(gateCookie, 'gate cookie');
  }
  const call = (method, urlPath, opts = {}) =>
    req(method, urlPath, { ...opts, cookie: gateCookie });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = Date.now();
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const email = `synthetic_paper_${stamp}@telos.test`;

  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [email, hash]
    )
  ).rows[0].id;

  const existingConn = (
    await client.query(`SELECT id FROM broker_connections ORDER BY linked_at DESC LIMIT 1`)
  ).rows[0];
  assert(existingConn, 'No broker_connections row — link a demo before this smoke');

  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, broker_id, encrypted_credentials, connection_status, account_type,
        linked_at, last_validated_at)
     SELECT $1, broker_name, broker_id || '-syn-smoke-' || $2::text, encrypted_credentials,
            connection_status, account_type, now(), now()
     FROM broker_connections WHERE id = $3`,
    [userId, String(stamp), existingConn.id]
  );

  const loginRes = await call('POST', '/auth/login', {
    body: { email, password },
  });
  assert(
    loginRes.status === 200 && loginRes.json?.token,
    `login failed: ${JSON.stringify(loginRes.json)}`
  );
  const token = loginRes.json.token;

  await client.query(
    `UPDATE trades SET status = 'closed', closed_at = now(), exit_price = entry_price, pnl = 0
     WHERE user_id = $1 AND status = 'open'`,
    [userId]
  );

  const startRes = await call('POST', '/bot/synthetic/start', { token });
  assert(startRes.status === 200, `start failed: ${JSON.stringify(startRes.json)}`);
  assert(
    startRes.json.synthetic_status === 'running',
    `synthetic_status: ${JSON.stringify(startRes.json)}`
  );
  const botInstanceId = startRes.json.bot_instance_id;
  console.log('HTTP_START_OK', {
    botInstanceId,
    synthetic_status: startRes.json.synthetic_status,
  });

  const stopRes = await call('POST', '/bot/synthetic/stop', { token });
  assert(stopRes.status === 200, `stop failed: ${JSON.stringify(stopRes.json)}`);
  assert(stopRes.json.synthetic_status === 'stopped', 'synthetic_status stopped');
  console.log('HTTP_STOP_OK');

  const instance = await botInstanceRepository.findById(botInstanceId);
  assert(instance, 'bot instance');

  const live = await mt5Connector.getSymbolInfo(SYMBOL);
  const atr = Math.max(Number(live.ask) * 0.001, 0.5);
  const runtime = new SyntheticBotRuntime(instance, {
    autoTick: false,
    strategySelection: {
      async selectSyntheticTradeAcrossWatchlist() {
        return {
          chosen_instrument: SYMBOL,
          strategy_id: 'smoke-synthetic',
          strategy_name: 'SmokeForce',
          strategy_confidence: 0.9,
          direction: 'BUY',
          stopRule: { type: 'atr_multiple', multiple: 1 },
          targetRule: { type: 'rr', ratio: 1 },
          marketIntelligence: {
            trend_quality: 0.7,
            market_volatility: 'NORMAL',
            diagnostics: { currentATR: atr, rollingAvgATR: atr },
          },
          newsIntelligence: { market_quality: 0.5, news_impact_score: 0 },
        };
      },
      computeSelectionStopTarget(_selection, entryPrice) {
        return { stopPrice: entryPrice - atr, targetPrice: entryPrice + atr };
      },
    },
  });
  await runtime.initialize();

  const openResult = await runtime._maybeOpenPositionPaper();
  assert(
    openResult && openResult.trade,
    `expected paper open: ${JSON.stringify({
      approved: openResult && openResult.entryResult && openResult.entryResult.tradeApproved,
      reason: openResult && openResult.entryResult && openResult.entryResult.reason,
      specRejected: openResult && openResult.specRejected,
    })}`
  );
  assert(openResult.trade.asset_class === 'synthetic', 'trade asset_class synthetic');
  assert(openResult.trade.execution_mode === 'paper', 'execution_mode paper');
  console.log('PAPER_OPEN', {
    id: openResult.trade.id,
    symbol: openResult.trade.symbol,
    entry: openResult.trade.entry_price,
  });

  const pos = runtime.openPosition;
  runtime.getSymbolInfo = async () => ({
    symbol: SYMBOL,
    bid: pos.stopPrice - 0.1,
    ask: pos.stopPrice - 0.05,
    trade_contract_size: 1,
    volume_min: 0.5,
    volume_step: 0.01,
    volume_max: 400,
    trade_mode_full: true,
  });
  const closeResult = await runtime._monitorOpenPositionPaper();
  assert(closeResult && closeResult.trade, 'expected paper close');
  assert(closeResult.trade.status === 'closed', 'closed status');
  assert(Number(closeResult.trade.pnl) < 0, `expected stop-loss pnl, got ${closeResult.trade.pnl}`);
  console.log('PAPER_CLOSE', { pnl: closeResult.trade.pnl, exit: closeResult.trade.exit_price });

  const dbTrade = (
    await client.query(`SELECT asset_class, execution_mode, status FROM trades WHERE id = $1`, [
      openResult.trade.id,
    ])
  ).rows[0];
  assert(
    dbTrade.asset_class === 'synthetic' &&
      dbTrade.execution_mode === 'paper' &&
      dbTrade.status === 'closed'
  );

  await stopSyntheticRuntime(botInstanceId);

  await client.query(`DELETE FROM bot_decision_log WHERE bot_instance_id = $1`, [botInstanceId]);
  await client.query(`DELETE FROM trades WHERE bot_instance_id = $1`, [botInstanceId]);
  await client.query(`DELETE FROM bot_instances WHERE id = $1`, [botInstanceId]);
  await client.query(`DELETE FROM broker_connections WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();

  console.log('SYNTHETIC_RUNTIME_PAPER_PASS');
}

main().catch((err) => {
  console.error('SYNTHETIC_RUNTIME_PAPER_FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
