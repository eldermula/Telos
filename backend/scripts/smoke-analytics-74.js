/**
 * Phase 7.4 — Analytics API smoke.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const tradesRepository = require('../src/engine/trades.repository');

const BASE = 'http://127.0.0.1:3000/api/v1';

async function req(method, urlPath, { token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, { method, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const email = `analytics74_${Date.now()}@telos.test`;
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [email, passwordHash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);
  const brokerId = (
    await client.query(
      `INSERT INTO broker_connections
         (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
       VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())
       RETURNING id`,
      [userId]
    )
  ).rows[0].id;
  const botInstanceId = (
    await client.query(
      `INSERT INTO bot_instances
         (user_id, broker_connection_id, status, active_strategy_mode,
          initial_balance, active_trading_balance, peak_equity, current_tier)
       VALUES ($1, $2, 'stopped', 'STRATEGY_A', 10, 8, 12, 0)
       RETURNING id`,
      [userId, brokerId]
    )
  ).rows[0].id;

  await tradesRepository.insertClosedPaperTrade({
    botInstanceId,
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    exitPrice: 1.12,
    lotSize: 0.01,
    finalAppliedPositionRisk: 0.01,
    pnl: 4,
  });
  await tradesRepository.insertClosedPaperTrade({
    botInstanceId,
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    exitPrice: 1.09,
    lotSize: 0.01,
    finalAppliedPositionRisk: 0.01,
    pnl: -2,
  });

  let r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
  assert(r.status === 200 && r.json.token, `login failed: ${JSON.stringify(r.json)}`);
  const token = r.json.token;

  r = await req('GET', '/analytics/trading-metrics?range=all', { token });
  console.log('trading', r.status, r.json && r.json.metrics);
  assert(r.status === 200, `trading metrics failed: ${JSON.stringify(r.json)}`);
  assert(r.json.metrics.trade_count === 2, 'trade_count');
  assert(r.json.metrics.net_pnl === 2, 'net_pnl');
  assert(r.json.metrics.win_rate === 0.5, 'win_rate');
  assert(r.json.metrics.current_drawdown_pct === Number(((12 - 8) / 12).toFixed(4)), 'drawdown');

  r = await req('GET', '/analytics/business-metrics', { token });
  console.log('business', r.status, r.json);
  assert(r.status === 200 && r.json.available === false, 'business metrics should be unavailable envelope');

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  console.log('ANALYTICS_74_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
