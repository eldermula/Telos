/**
 * Phase 7.3 — Portfolio API smoke (06 §8 / FR-PORT-1, FR-PORT-2).
 * Seeded closed + open trades, verifies holdings and ranged performance.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const tradesRepository = require('../src/engine/trades.repository');

const BASE = 'http://127.0.0.1:3000/api/v1';

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `portfolio73_${Date.now()}@telos.test`;
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);
  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())
     RETURNING id`,
    [userId]
  );
  const brokerId = (
    await client.query(`SELECT id FROM broker_connections WHERE user_id = $1`, [userId])
  ).rows[0].id;
  const botRes = await client.query(
    `INSERT INTO bot_instances
       (user_id, broker_connection_id, status, active_strategy_mode,
        initial_balance, active_trading_balance, peak_equity, current_tier)
     VALUES ($1, $2, 'stopped', 'STRATEGY_A', 10, 10, 10, 0)
     RETURNING id`,
    [userId, brokerId]
  );
  const botInstanceId = botRes.rows[0].id;

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
    pnl: 5,
    openedAt: new Date(Date.now() - 86400000),
    closedAt: new Date(Date.now() - 86000000),
  });
  await tradesRepository.insertClosedPaperTrade({
    botInstanceId,
    symbol: 'GBPUSD',
    direction: 'SELL',
    entryPrice: 1.3,
    stopPrice: 1.31,
    targetPrice: 1.28,
    exitPrice: 1.31,
    lotSize: 0.01,
    finalAppliedPositionRisk: 0.01,
    pnl: -2,
    openedAt: new Date(Date.now() - 3600000),
    closedAt: new Date(Date.now() - 1800000),
  });
  await tradesRepository.insertOpenPaperTrade({
    botInstanceId,
    symbol: 'XAUUSD',
    direction: 'BUY',
    entryPrice: 2300,
    stopPrice: 2290,
    targetPrice: 2320,
    lotSize: 0.02,
    finalAppliedPositionRisk: 0.05,
    conditions: null,
  });

  let r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  r = await req('GET', '/portfolio/holdings', { token });
  console.log('holdings', r.status, r.json);
  assert(r.status === 200, `holdings failed: ${JSON.stringify(r.json)}`);
  assert(r.json.holdings.length === 1, 'expected one holding symbol');
  assert(r.json.holdings[0].symbol === 'XAUUSD', 'expected XAUUSD open holding');
  assert(r.json.holdings[0].net_direction === 'BUY', 'expected BUY net');

  r = await req('GET', '/portfolio/performance?range=30d', { token });
  console.log('performance', r.status, r.json && r.json.summary);
  assert(r.status === 200, `performance failed: ${JSON.stringify(r.json)}`);
  assert(r.json.summary.trade_count === 2, 'expected 2 closed trades');
  assert(r.json.summary.wins === 1 && r.json.summary.losses === 1, 'win/loss mismatch');
  assert(r.json.summary.net_pnl === 3, `expected net_pnl 3, got ${r.json.summary.net_pnl}`);
  assert(r.json.series.length === 2, 'series length mismatch');
  assert(r.json.series[1].cumulative_pnl === 3, 'cumulative end mismatch');

  r = await req('GET', '/portfolio/performance?range=nope', { token });
  assert(r.status === 422, 'invalid range should 422');

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  console.log('PORTFOLIO_73_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
