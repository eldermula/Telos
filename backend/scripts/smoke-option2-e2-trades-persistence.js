/**
 * Option 2 E.2 — trades persistence for real vs paper execution modes.
 * Verifies explicit execution_mode writes, real insert with broker_ticket,
 * closeRealTrade, and the partial unique index on (bot_instance_id, broker_ticket).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const tradesRepository = require('../src/engine/trades.repository');
const botInstanceRepository = require('../src/engine/bot-instance.repository');

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  await connectRedis();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `option2e2_${Date.now()}@telos.test`;
  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, 'x', 'user')
     RETURNING id`,
    [email]
  );
  const userId = userRes.rows[0].id;

  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userId]
  );

  const instance = await botInstanceRepository.ensureForUser(userId);
  const botInstanceId = instance.id;

  const paper = await tradesRepository.insertOpenPaperTrade({
    botInstanceId,
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    lotSize: 0.01,
    finalAppliedPositionRisk: 0.01,
  });
  console.log('paper_open', paper.execution_mode, paper.broker_ticket);
  assert(paper.execution_mode === 'paper', 'paper open must write execution_mode=paper');
  assert(paper.broker_ticket === null, 'paper open must have null broker_ticket');

  const closedPaper = await tradesRepository.closePaperTrade(paper.id, {
    exitPrice: 1.12,
    pnl: 1.5,
  });
  assert(closedPaper.status === 'closed', 'paper close');
  assert(closedPaper.execution_mode === 'paper', 'paper close preserves execution_mode');

  const ticket = 90000000001;
  const real = await tradesRepository.insertOpenRealTrade({
    botInstanceId,
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    lotSize: 0.01,
    finalAppliedPositionRisk: 0.01,
    brokerTicket: ticket,
  });
  console.log('real_open', real.execution_mode, real.broker_ticket);
  assert(real.execution_mode === 'real', 'real open must write execution_mode=real');
  assert(real.broker_ticket === ticket, 'real open must store broker_ticket');

  const resume = await tradesRepository.listOpenTradesForResume(botInstanceId);
  assert(resume.length === 1, 'one open real trade for resume');
  assert(resume[0].execution_mode === 'real', 'resume includes execution_mode');
  assert(resume[0].broker_ticket === ticket, 'resume includes broker_ticket');

  let duplicateRejected = false;
  try {
    await tradesRepository.insertOpenRealTrade({
      botInstanceId,
      symbol: 'EURUSD',
      direction: 'SELL',
      entryPrice: 1.1,
      stopPrice: 1.11,
      targetPrice: 1.08,
      lotSize: 0.01,
      finalAppliedPositionRisk: 0.01,
      brokerTicket: ticket,
    });
  } catch (err) {
    duplicateRejected = err.code === '23505' || /unique|duplicate/i.test(err.message);
    console.log('duplicate_ticket_rejected', err.code || err.message);
  }
  assert(duplicateRejected, 'partial unique index must reject duplicate (bot_instance_id, broker_ticket)');

  const closedReal = await tradesRepository.closeRealTrade(real.id, {
    exitPrice: 1.09,
    pnl: -2.0,
  });
  assert(closedReal.status === 'closed', 'real close');
  assert(closedReal.execution_mode === 'real', 'real close preserves execution_mode');
  assert(closedReal.broker_ticket === ticket, 'real close preserves broker_ticket');

  let missingTicketThrew = false;
  try {
    await tradesRepository.insertOpenRealTrade({
      botInstanceId,
      symbol: 'EURUSD',
      direction: 'BUY',
      entryPrice: 1.1,
      stopPrice: 1.09,
      targetPrice: 1.12,
      lotSize: 0.01,
      finalAppliedPositionRisk: 0.01,
      brokerTicket: null,
    });
  } catch (err) {
    missingTicketThrew = /requires brokerTicket/.test(err.message);
  }
  assert(missingTicketThrew, 'insertOpenRealTrade must require brokerTicket');

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  redis.disconnect();
  console.log('OPTION2_E2_TRADES_PERSISTENCE_PASS');
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
