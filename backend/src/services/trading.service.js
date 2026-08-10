'use strict';

/**
 * Thin HTTP-facing layer over the Trading Engine
 * (06_API_Specification.md Section 6).
 */

const tradingEngine = require('../engine/trading-engine');
const tradesRepository = require('../engine/trades.repository');
const decisionLogRepository = require('../engine/decision-log.repository');
const brokerAccountService = require('../engine/broker-account.service');
const mt5Connector = require('./mt5-connector.client');
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

async function haltNewOpens(userId) {
  return tradingEngine.haltNewOpens(userId);
}

async function resumeNewOpens(userId) {
  return tradingEngine.resumeNewOpens(userId);
}

async function confirmLive(userId, confirmationPhrase) {
  return tradingEngine.confirmLiveTrading(userId, confirmationPhrase);
}

async function testDispatchForexReal(userId, body) {
  return tradingEngine.testDispatchForexReal(userId, body);
}

async function testCloseForexReal(userId, body) {
  return tradingEngine.testCloseForexReal(userId, body);
}

/**
 * Option 2 D follow-up / E.3 — frontend-facing proxy for live MT5
 * equity. Delegates to the shared login-matched helper so the modal
 * and BotRuntime real-mode paths cannot drift.
 */
async function getLiveAccountInfo(userId) {
  const info = await brokerAccountService.getMatchedAccountInfoForUser(userId);
  // Strip last_validated_at from the public API shape (internal to E.5 freshness).
  return {
    broker_connection_id: info.broker_connection_id,
    broker_name: info.broker_name,
    login: info.login,
    account_type: info.account_type,
    balance: info.balance,
    equity: info.equity,
    currency: info.currency,
  };
}

/**
 * Broker onboarding preview — whatever is currently attached to the
 * desktop MT5 terminal. No broker_connections row required, no
 * login-match gate (unlike getLiveAccountInfo). Read-only; never
 * authenticates with typed credentials.
 */
async function getAttachedAccountInfo() {
  const info = await mt5Connector.getAccountInfo();
  return {
    login: info.login,
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
  haltNewOpens,
  resumeNewOpens,
  confirmLive,
  testDispatchForexReal,
  testCloseForexReal,
  getLiveAccountInfo,
  getAttachedAccountInfo,
  getPositions,
  getOrders,
  getHistory,
  getDecisionLog,
};
