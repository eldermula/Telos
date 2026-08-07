'use strict';

/**
 * Thin HTTP-facing layer over the Trading Engine
 * (06_API_Specification.md Section 6).
 */

const { pool } = require('../db/pool');
const tradingEngine = require('../engine/trading-engine');
const tradesRepository = require('../engine/trades.repository');
const decisionLogRepository = require('../engine/decision-log.repository');
const { decryptCredentials } = require('./credential-crypto.service');
const { getAccountInfo } = require('./mt5-connector.client');
const { AppError } = require('../utils/app-error');
const { toMeta } = require('../utils/pagination');

async function getSession(userId) {
  return tradingEngine.getSessionForUser(userId);
}

async function getPositions(userId) {
  const instance = await tradingEngine.ensureBotInstance(userId);
  return tradesRepository.listOpenTrades(instance.id);
}

/**
 * No `orders` table exists yet (05_Database_Design.md has only `trades`,
 * open|closed) — the paper harness and, so far, the MT5 connector have
 * no concept of a resting/pending order. Returns an empty, shape-correct
 * list until 4.6 introduces real MT5 order placement, where a pending
 * state may become meaningful.
 */
async function getOrders(userId) {
  await tradingEngine.ensureBotInstance(userId);
  return [];
}

async function getHistory(userId, pagination) {
  const instance = await tradingEngine.ensureBotInstance(userId);
  const { rows, total } = await tradesRepository.listClosedTradesPaginated(instance.id, {
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return { data: rows, meta: toMeta(pagination, total) };
}

async function getDecisionLog(userId, pagination) {
  const instance = await tradingEngine.ensureBotInstance(userId);
  const { rows, total } = await decisionLogRepository.listPaginated(instance.id, {
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return { data: rows, meta: toMeta(pagination, total) };
}

async function startSession(userId) {
  // HTTP path: disable auto tick by default when PAPER_TICK_MS=0; otherwise auto.
  // Runtime options are Engine-internal — REST uses autoTick unless PAPER_AUTO_TICK=0.
  const autoTick = process.env.PAPER_AUTO_TICK !== '0';
  return tradingEngine.startSession(userId, { autoTick });
}

async function stopSession(userId) {
  return tradingEngine.stopSession(userId);
}

async function confirmLive(userId, confirmationPhrase) {
  return tradingEngine.confirmLiveTrading(userId, confirmationPhrase);
}

/**
 * Option 2 D follow-up — frontend-facing proxy for the connector's
 * GET /account-info. The Confirm Live modal must show real MT5 equity
 * (not bot_instances.active_trading_balance, which is still the paper
 * ledger until Increment E syncs it). Flow:
 *   1. Resolve the user's single broker_connection (with encrypted creds)
 *   2. Decrypt to learn the expected login (never returned to the client)
 *   3. Call the connector's live account-info
 *   4. Reject if the attached terminal's login doesn't match the stored
 *      credentials — same check validate() already does, so we never
 *      show some other account's equity as if it were this user's
 * Returns a public, credentials-free shape. Failures surface as the
 * existing connector AppErrors (503 unreachable / 422 failed) so the
 * modal can refuse to arm without accurate context.
 */
async function getLiveAccountInfo(userId) {
  const result = await pool.query(
    `SELECT id, broker_name, account_type, encrypted_credentials
     FROM broker_connections
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(
      404,
      'NO_BROKER_CONNECTION',
      'Link a broker connection before reading live account info'
    );
  }

  const credentials = decryptCredentials(row.encrypted_credentials);
  const expectedLogin = String(credentials.login).trim();

  const info = await getAccountInfo();
  if (String(info.login) !== expectedLogin) {
    throw new AppError(
      422,
      'BROKER_ACCOUNT_MISMATCH',
      'Attached MT5 account login does not match your linked broker connection'
    );
  }

  return {
    broker_connection_id: row.id,
    broker_name: row.broker_name,
    login: info.login,
    // Live from the terminal, not the (possibly stale) DB column —
    // the modal's context must reflect what's actually attached right now.
    account_type: info.account_type,
    balance: info.balance,
    equity: info.equity,
    currency: info.currency ?? null,
  };
}

module.exports = {
  getSession,
  startSession,
  stopSession,
  confirmLive,
  getLiveAccountInfo,
  getPositions,
  getOrders,
  getHistory,
  getDecisionLog,
};
