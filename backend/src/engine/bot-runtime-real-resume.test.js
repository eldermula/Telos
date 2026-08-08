'use strict';

/**
 * Option 2 E.7 — mocked unit tests for initialize() real-mode resume
 * reconciliation. No Postgres / Redis / live MT5.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BotRuntime } = require('./bot-runtime');

function makeRealOpenRow(overrides = {}) {
  return {
    id: 'trade-1',
    symbol: 'EURUSD',
    direction: 'BUY',
    entry_price: 1.1,
    stop_price: 1.09,
    target_price: 1.12,
    final_applied_position_risk: 0.01,
    execution_mode: 'real',
    broker_ticket: 9001,
    conditions: { strategy_name: 'MA Crossover' },
    ...overrides,
  };
}

function makePaperOpenRow(overrides = {}) {
  return {
    id: 'trade-paper',
    symbol: 'EURUSD',
    direction: 'SELL',
    entry_price: 1.2,
    stop_price: 1.21,
    target_price: 1.18,
    final_applied_position_risk: 0.01,
    execution_mode: 'paper',
    broker_ticket: null,
    conditions: null,
    ...overrides,
  };
}

function createResumeRuntime(overrides = {}) {
  const decisions = [];
  const notifies = [];
  const closedTrades = [];
  let statusRow = {
    id: 'bot-1',
    status: 'stopped',
    active_trading_balance: 10000,
    peak_equity: 10000,
    active_strategy_mode: 'STRATEGY_A',
    current_tier: 0,
    updated_at: new Date().toISOString(),
  };

  const deps = {
    findInstanceById: async () => ({
      id: 'bot-1',
      active_trading_balance: 10000,
      peak_equity: 10000,
      active_strategy_mode: 'STRATEGY_A',
      current_tier: 0,
      initial_balance: 10000,
    }),
    loadTradeHistoryForLearning: async () => [],
    listOpenTradesForResume:
      overrides.listOpenTradesForResume || (async () => [makeRealOpenRow()]),
    getPositions: overrides.getPositions || (async () => [{ ticket: 9001 }]),
    getOrderHistory:
      overrides.getOrderHistory ||
      (async () => ({
        ok: true,
        ticket: 9001,
        close_price: 1.12,
        profit: 40,
        close_time: 1700000000,
        volume: 0.01,
      })),
    closeRealTrade: async (tradeId, args) => {
      const row = {
        id: tradeId,
        status: 'closed',
        execution_mode: 'real',
        broker_ticket: 9001,
        exit_price: args.exitPrice,
        pnl: args.pnl,
      };
      closedTrades.push(row);
      return row;
    },
    getMatchedAccountInfoForBotInstance: async () => ({
      equity: 10040,
      balance: 10040,
      account_type: 'demo',
      last_validated_at: new Date(),
    }),
    insertDecision: async (args) => {
      decisions.push(args);
      return args;
    },
    forceNotifyUser: async (userId, type, message) => {
      notifies.push({ userId, type, message });
      return { id: 'n-1' };
    },
    maybeNotifyUser: async () => null,
    updateStatusFields: async (_id, fields) => {
      statusRow = { ...statusRow, ...fields };
      return statusRow;
    },
    setStatus: async (row) => row,
    publishBotEvent: async () => {},
    getTierRows: async () => undefined,
    historyRetryTicks: overrides.historyRetryTicks ?? 3,
  };

  const runtime = new BotRuntime(
    { id: 'bot-1', user_id: 'user-1' },
    { autoTick: false, ...deps }
  );

  return { runtime, decisions, notifies, closedTrades, statusRow: () => statusRow };
}

describe('E.7 initialize() real resume reconcile', () => {
  test('real ticket still open → resume openPosition with brokerTicket', async () => {
    const { runtime, closedTrades } = createResumeRuntime({
      getPositions: async () => [{ ticket: 9001, symbol: 'EURUSD' }],
    });

    await runtime.initialize();

    assert.ok(runtime.openPosition);
    assert.equal(runtime.openPosition.executionMode, 'real');
    assert.equal(runtime.openPosition.brokerTicket, 9001);
    assert.equal(runtime.openPosition.historyRetryCount, 0);
    assert.equal(closedTrades.length, 0);
    assert.equal(runtime._halted, false);

    runtime.start();
    assert.equal(runtime.running, true);
  });

  test('real ticket gone + history → close-reconcile before first tick', async () => {
    const { runtime, closedTrades, decisions, notifies, statusRow } = createResumeRuntime({
      getPositions: async () => [],
    });

    await runtime.initialize();

    assert.equal(runtime.openPosition, null);
    assert.equal(closedTrades.length, 1);
    assert.equal(closedTrades[0].pnl, 40);
    assert.equal(closedTrades[0].exit_price, 1.12);
    assert.ok(decisions.some((d) => d.decisionType === 'real_order_closed'));
    assert.ok(notifies.some((n) => /Real order closed/.test(n.message)));
    // initialize reconcile must not force status=running while Start
    // is still assembling the session.
    assert.notEqual(statusRow().status, 'running');
    assert.equal(statusRow().active_trading_balance, 10040);

    runtime.start();
    assert.equal(runtime.running, true);
  });

  test('real ticket gone + history lag then success within retries', async () => {
    let attempts = 0;
    const { runtime, closedTrades } = createResumeRuntime({
      getPositions: async () => [],
      getOrderHistory: async () => {
        attempts += 1;
        if (attempts < 2) {
          const err = new Error('lag');
          err.statusCode = 404;
          throw err;
        }
        return {
          ok: true,
          ticket: 9001,
          close_price: 1.095,
          profit: -15,
          close_time: 1700000000,
          volume: 0.01,
        };
      },
    });

    await runtime.initialize();

    assert.equal(attempts, 2);
    assert.equal(closedTrades[0].pnl, -15);
    assert.equal(runtime.openPosition, null);
    assert.equal(runtime._halted, false);
  });

  test('real ticket gone + history exhausted → halt, start() no-ops', async () => {
    const { runtime, closedTrades, decisions, statusRow } = createResumeRuntime({
      getPositions: async () => [],
      getOrderHistory: async () => {
        const err = new Error('No closing deal');
        err.statusCode = 404;
        throw err;
      },
    });

    await runtime.initialize();

    assert.equal(runtime._halted, true);
    assert.equal(closedTrades.length, 0);
    assert.equal(statusRow().status, 'error');
    assert.ok(
      decisions.some(
        (d) =>
          d.decisionType === 'real_order_failed' &&
          d.triggeringCondition === 'order_history_unavailable'
      )
    );

    runtime.start();
    assert.equal(runtime.running, false);
  });

  test('paper open trade resume unchanged (no broker calls)', async () => {
    let positionsCalls = 0;
    const { runtime } = createResumeRuntime({
      listOpenTradesForResume: async () => [makePaperOpenRow()],
      getPositions: async () => {
        positionsCalls += 1;
        return [];
      },
    });

    await runtime.initialize();

    assert.equal(positionsCalls, 0);
    assert.ok(runtime.openPosition);
    assert.equal(runtime.openPosition.executionMode, 'paper');
    assert.equal(runtime.openPosition.brokerTicket, null);
    assert.equal(runtime.openPosition.tradeRowId, 'trade-paper');
  });
});
