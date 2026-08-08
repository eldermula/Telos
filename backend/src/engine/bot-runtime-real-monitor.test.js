'use strict';

/**
 * Option 2 E.6 — mocked unit tests for _monitorOpenPositionReal.
 * No Postgres / Redis / live MT5 — all I/O injected via constructor seams.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BotRuntime } = require('./bot-runtime');

function makeOpenRealPosition(overrides = {}) {
  return {
    tradeRowId: 'trade-1',
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    executionMode: 'real',
    brokerTicket: 9001,
    conditions: { strategy_name: 'MA Crossover' },
    entryResult: {
      tradeApproved: true,
      learningInputs: { liveWinProbability: 0.5, consecutiveLosses: 0 },
      riskResult: { appliedRisk: 0.01, riskSource: 'test' },
      balanceBeforeTrade: 10000,
      riskedAmount: 100,
    },
    historyRetryCount: 0,
    ...overrides,
  };
}

function createMonitorRuntime(overrides = {}) {
  const decisions = [];
  const notifies = [];
  const statusUpdates = [];
  let statusRow = {
    id: 'bot-1',
    status: 'running',
    active_trading_balance: 10000,
    peak_equity: 10000,
    updated_at: new Date().toISOString(),
  };
  const closedTrades = [];

  const deps = {
    getMatchedAccountInfoForBotInstance:
      overrides.getMatchedAccountInfoForBotInstance ||
      (async () => ({
        equity: 10050,
        balance: 10050,
        account_type: 'demo',
        last_validated_at: new Date(),
      })),
    getPositions: overrides.getPositions || (async () => [{ ticket: 9001, symbol: 'EURUSD' }]),
    getOrderHistory:
      overrides.getOrderHistory ||
      (async () => ({
        ok: true,
        ticket: 9001,
        close_price: 1.12,
        profit: 50,
        close_time: Math.floor(Date.now() / 1000),
        volume: 0.01,
      })),
    closeRealTrade:
      overrides.closeRealTrade ||
      (async (tradeId, args) => {
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
      }),
    insertDecision: async (args) => {
      decisions.push(args);
      return { id: `d-${decisions.length}`, ...args };
    },
    forceNotifyUser: async (userId, type, message) => {
      notifies.push({ userId, type, message });
      return { id: 'n-1' };
    },
    maybeNotifyUser: async () => null,
    updateStatusFields: async (_id, fields) => {
      statusRow = { ...statusRow, ...fields };
      statusUpdates.push(fields);
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
  runtime.running = true;
  runtime.state = {
    balance: 10000,
    peakEquity: 10000,
    activeStrategyMode: 'STRATEGY_A',
    currentTier: 0,
    initialBalance: 10000,
    tradeHistory: [],
  };
  runtime.openPosition = makeOpenRealPosition(overrides.openPosition);

  return {
    runtime,
    decisions,
    notifies,
    statusUpdates,
    closedTrades,
    statusRow: () => statusRow,
  };
}

describe('E.6 _monitorOpenPositionReal', () => {
  test('ticket still in positions → no-op (no close, no history)', async () => {
    let historyCalls = 0;
    const { runtime, closedTrades, decisions } = createMonitorRuntime({
      getPositions: async () => [{ ticket: 9001, symbol: 'EURUSD' }],
      getOrderHistory: async () => {
        historyCalls += 1;
        throw new Error('should not be called');
      },
    });

    const result = await runtime._monitorOpenPositionReal();

    assert.equal(result, null);
    assert.ok(runtime.openPosition);
    assert.equal(runtime.openPosition.brokerTicket, 9001);
    assert.equal(historyCalls, 0);
    assert.equal(closedTrades.length, 0);
    assert.equal(
      decisions.filter((d) => d.decisionType === 'real_order_closed').length,
      0
    );
  });

  test('ticket gone + history → closeRealTrade with broker PnL + real_order_closed', async () => {
    const { runtime, closedTrades, decisions, notifies, statusUpdates } = createMonitorRuntime({
      getPositions: async () => [],
      getOrderHistory: async () => ({
        ok: true,
        ticket: 9001,
        close_price: 1.12,
        profit: 42.5,
        close_time: 1700000000,
        volume: 0.01,
      }),
    });

    const result = await runtime._monitorOpenPositionReal();

    assert.ok(result && result.trade);
    assert.equal(result.trade.status, 'closed');
    assert.equal(closedTrades[0].exit_price, 1.12);
    assert.equal(closedTrades[0].pnl, 42.5);
    assert.equal(runtime.openPosition, null);

    const closed = decisions.find((d) => d.decisionType === 'real_order_closed');
    assert.ok(closed);
    assert.equal(closed.details.pnl, 42.5);
    assert.equal(closed.details.exit_price, 1.12);
    assert.ok(notifies.some((n) => /Real order closed/.test(n.message)));
    assert.ok(statusUpdates.some((u) => u.active_trading_balance === 10050));
  });

  test('history lag then success within 3 ticks', async () => {
    let historyAttempts = 0;
    const { runtime, closedTrades } = createMonitorRuntime({
      getPositions: async () => [],
      getOrderHistory: async () => {
        historyAttempts += 1;
        if (historyAttempts < 3) {
          const err = new Error('No closing deal found');
          err.status = 404;
          throw err;
        }
        return {
          ok: true,
          ticket: 9001,
          close_price: 1.095,
          profit: -20,
          close_time: 1700000000,
          volume: 0.01,
        };
      },
    });

    assert.equal(await runtime._monitorOpenPositionReal(), null);
    assert.equal(runtime.openPosition.historyRetryCount, 1);
    assert.equal(await runtime._monitorOpenPositionReal(), null);
    assert.equal(runtime.openPosition.historyRetryCount, 2);

    const result = await runtime._monitorOpenPositionReal();
    assert.ok(result && result.trade);
    assert.equal(closedTrades[0].pnl, -20);
    assert.equal(runtime.openPosition, null);
    assert.equal(historyAttempts, 3);
  });

  test('3 history failures → status error, position left unresolved in DB path', async () => {
    let historyAttempts = 0;
    const { runtime, closedTrades, decisions, statusRow } = createMonitorRuntime({
      getPositions: async () => [],
      getOrderHistory: async () => {
        historyAttempts += 1;
        const err = new Error('No closing deal found');
        err.status = 404;
        throw err;
      },
    });

    assert.equal(await runtime._monitorOpenPositionReal(), null);
    assert.equal(await runtime._monitorOpenPositionReal(), null);
    const result = await runtime._monitorOpenPositionReal();

    assert.equal(result.error, true);
    assert.equal(historyAttempts, 3);
    assert.equal(closedTrades.length, 0);
    assert.equal(runtime.running, false);
    assert.equal(statusRow().status, 'error');
    assert.ok(
      decisions.some(
        (d) =>
          d.decisionType === 'real_order_failed' &&
          d.triggeringCondition === 'order_history_unavailable'
      )
    );
  });

  test('ticket reappearing resets history retry counter', async () => {
    let call = 0;
    const { runtime } = createMonitorRuntime({
      getPositions: async () => {
        call += 1;
        // tick1: gone, tick2: back
        return call === 1 ? [] : [{ ticket: 9001 }];
      },
      getOrderHistory: async () => {
        const err = new Error('lag');
        err.status = 404;
        throw err;
      },
    });

    await runtime._monitorOpenPositionReal();
    assert.equal(runtime.openPosition.historyRetryCount, 1);

    await runtime._monitorOpenPositionReal();
    assert.equal(runtime.openPosition.historyRetryCount, 0);
    assert.ok(runtime.openPosition);
  });
});
