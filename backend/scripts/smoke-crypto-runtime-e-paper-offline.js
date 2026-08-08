'use strict';

/**
 * Crypto Increment E — offline paper open/close (mocked ticks, real DB writers).
 * Complements the live smoke when the MT5 terminal cannot select BTCUSD.
 *
 *   node backend/scripts/smoke-crypto-runtime-e-paper-offline.js
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis } = require('../src/db/redis');
const {
  CryptoBotRuntime,
  stopCryptoRuntime,
} = require('../src/engine/crypto-bot-runtime');
const botInstanceRepository = require('../src/engine/bot-instance.repository');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const stamp = Date.now();
  const hash = await bcrypt.hash('Password123!', 12);
  const email = `crypto_e_offline_${stamp}@telos.test`;
  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [email, hash]
    )
  ).rows[0].id;

  const existingConn = (
    await client.query(`SELECT id FROM broker_connections ORDER BY linked_at DESC LIMIT 1`)
  ).rows[0];
  assert(existingConn, 'need at least one broker_connections row to clone');

  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, broker_id, encrypted_credentials, connection_status, account_type,
        linked_at, last_validated_at)
     SELECT $1, broker_name, broker_id || '-off-' || $2::text, encrypted_credentials,
            connection_status, account_type, now(), now()
     FROM broker_connections WHERE id = $3`,
    [userId, String(stamp), existingConn.id]
  );

  const instance = await botInstanceRepository.ensureForUser(userId);
  await client.query(
    `UPDATE trades SET status='closed', closed_at=now(), exit_price=entry_price, pnl=0
     WHERE user_id=$1 AND status='open'`,
    [userId]
  );

  const entryAsk = 65000;
  const atr = 100;
  const runtime = new CryptoBotRuntime(instance, {
    autoTick: false,
    getSymbolInfo: async () => ({
      symbol: 'BTCUSD',
      bid: entryAsk - 10,
      ask: entryAsk,
      trade_contract_size: 1,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 5,
      trade_mode_full: true,
    }),
    strategySelection: {
      async selectCryptoTradeAcrossWatchlist() {
        return {
          chosen_instrument: 'BTCUSD',
          strategy_id: 'offline-e',
          strategy_name: 'OfflineForce',
          strategy_confidence: 0.9,
          direction: 'BUY',
          stopRule: { type: 'atr_multiple', multiple: 1 },
          targetRule: { type: 'rr', ratio: 1 },
          marketIntelligence: {
            trend_quality: 0.7,
            market_volatility: 'NORMAL',
            diagnostics: { currentATR: atr, rollingAvgATR: atr },
          },
          newsIntelligence: { market_quality: 0.7, news_impact_score: 0.2 },
        };
      },
      computeSelectionStopTarget(_s, entryPrice) {
        return { stopPrice: entryPrice - atr, targetPrice: entryPrice + atr };
      },
    },
  });
  await runtime.initialize();

  const openResult = await runtime._maybeOpenPositionPaper();
  assert(openResult && openResult.trade, `open failed: ${JSON.stringify(openResult && openResult.entryResult)}`);
  assert(openResult.trade.asset_class === 'crypto');

  const pos = runtime.openPosition;
  runtime.getSymbolInfo = async () => ({
    symbol: 'BTCUSD',
    bid: pos.stopPrice - 1,
    ask: pos.stopPrice - 0.5,
    trade_contract_size: 1,
    volume_min: 0.01,
    volume_step: 0.01,
    volume_max: 5,
    trade_mode_full: true,
  });
  const closeResult = await runtime._monitorOpenPositionPaper();
  assert(closeResult && closeResult.trade && closeResult.trade.status === 'closed');
  assert(Number(closeResult.trade.pnl) < 0);

  const risked = pos.entryResult.riskedAmount;
  const rMult =
    (Number(closeResult.trade.exit_price) - pos.entryPrice) /
    Math.abs(pos.entryPrice - pos.stopPrice);
  const expected = risked * rMult;
  assert(
    Math.abs(Number(closeResult.trade.pnl) - expected) < 1e-9,
    `pnl ${closeResult.trade.pnl} !== risked*R ${expected}`
  );

  await stopCryptoRuntime(instance.id);
  await client.query(`DELETE FROM bot_decision_log WHERE bot_instance_id=$1`, [instance.id]);
  await client.query(`DELETE FROM trades WHERE bot_instance_id=$1`, [instance.id]);
  await client.query(`DELETE FROM bot_instances WHERE id=$1`, [instance.id]);
  await client.query(`DELETE FROM broker_connections WHERE user_id=$1`, [userId]);
  await client.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await client.end();

  console.log('CRYPTO_RUNTIME_E_PAPER_OFFLINE_PASS', {
    pnl: closeResult.trade.pnl,
    riskedAmount: risked,
    realRMultiple: rMult,
  });
}

main().catch((err) => {
  console.error('CRYPTO_RUNTIME_E_PAPER_OFFLINE_FAIL', err.message || err);
  process.exitCode = 1;
});
