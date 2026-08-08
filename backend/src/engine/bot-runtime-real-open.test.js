'use strict';

/**
 * Option 2 E.5 — mocked connector unit tests for _maybeOpenPositionReal.
 * No Postgres / Redis / live MT5 — all I/O injected via constructor seams.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BotRuntime } = require('./bot-runtime');
const { makeFakeStrategySelection } = require('../../scripts/test-helpers/fake-strategy-selection');

function makeAccountInfo(overrides = {}) {
  return {
    broker_connection_id: 'bc-1',
    broker_name: 'mt5',
    login: '12345',
    account_type: 'demo',
    balance: 10000,
    equity: 10000,
    currency: 'USD',
    last_validated_at: new Date(),
    ...overrides,
  };
}

function makeSymbolInfo(overrides = {}) {
  return {
    symbol: 'EURUSD',
    volume_min: 0.01,
    volume_step: 0.01,
    volume_max: 100,
    trade_contract_size: 100000,
    bid: 1.1,
    ask: 1.1001,
    ...overrides,
  };
}

function createRuntime(overrides = {}) {
  const decisions = [];
  const notifies = [];
  const statusUpdates = [];
  const placeCalls = [];
  const insertedTrades = [];
  let statusRow = {
    id: 'bot-1',
    status: 'running',
    active_trading_balance: 10,
    peak_equity: 10,
  };

  const deps = {
    getMatchedAccountInfoForBotInstance:
      overrides.getMatchedAccountInfoForBotInstance || (async () => makeAccountInfo()),
    getSymbolInfo: overrides.getSymbolInfo || (async () => makeSymbolInfo()),
    placeOrder:
      overrides.placeOrder ||
      (async (args) => {
        placeCalls.push(args);
        return { ok: true, ticket: 9001, deal: 1, volume: args.volume, price: 1.1001 };
      }),
    insertOpenRealTrade:
      overrides.insertOpenRealTrade ||
      (async (args) => {
        insertedTrades.push(args);
        return {
          id: 'trade-1',
          status: 'open',
          execution_mode: 'real',
          broker_ticket: args.brokerTicket,
          symbol: args.symbol,
          direction: args.direction,
          entry_price: args.entryPrice,
          stop_price: args.stopPrice,
          target_price: args.targetPrice,
          lot_size: args.lotSize,
        };
      }),
    insertDecision: async (args) => {
      decisions.push(args);
      return { id: `d-${decisions.length}`, ...args };
    },
    forceNotifyUser: async (userId, type, message) => {
      notifies.push({ userId, type, message });
      return { id: 'n-1' };
    },
    updateStatusFields: async (_id, fields) => {
      statusRow = { ...statusRow, ...fields };
      statusUpdates.push(fields);
      return statusRow;
    },
    setStatus: async (row) => row,
    publishBotEvent: async () => {},
    getTierRows: async () => undefined,
    now: () => new Date(),
    maxLot: overrides.maxLot ?? 0.01,
    maxAgeHours: overrides.maxAgeHours ?? 24,
    strategySelection: overrides.strategySelection || makeFakeStrategySelection(),
  };

  const runtime = new BotRuntime(
    { id: 'bot-1', user_id: 'user-1' },
    { autoTick: false, ...deps }
  );
  runtime.running = true;
  runtime.state = {
    balance: 10,
    peakEquity: 10,
    activeStrategyMode: 'STRATEGY_A',
    currentTier: 0,
    initialBalance: 10,
    tradeHistory: [],
  };

  return { runtime, decisions, notifies, statusUpdates, placeCalls, insertedTrades, statusRow: () => statusRow };
}

describe('E.5 _maybeOpenPositionReal', () => {
  test('success: persists real trade + ticket, Layer 0 gets detected demo type', async () => {
    const { runtime, decisions, notifies, placeCalls, insertedTrades, statusUpdates } =
      createRuntime();

    const result = await runtime._maybeOpenPositionReal();

    assert.ok(result && result.trade);
    assert.equal(result.trade.execution_mode, 'real');
    assert.equal(result.trade.broker_ticket, 9001);
    assert.equal(runtime.openPosition.executionMode, 'real');
    assert.equal(runtime.openPosition.brokerTicket, 9001);

    assert.equal(placeCalls.length, 1);
    assert.equal(placeCalls[0].expectedAccountType, 'demo');
    assert.notEqual(placeCalls[0].expectedAccountType, 'real');
    assert.ok(placeCalls[0].sl != null);
    assert.ok(placeCalls[0].tp != null);
    assert.equal(placeCalls[0].volume, 0.01); // REAL_MAX_LOT cap

    assert.equal(insertedTrades[0].brokerTicket, 9001);
    assert.ok(statusUpdates.some((u) => u.active_trading_balance === 10000));

    const placed = decisions.find((d) => d.decisionType === 'real_order_placed');
    assert.ok(placed);
    assert.equal(placed.details.expected_account_type, 'demo');
    assert.equal(placed.details.detected_account_type, 'demo');
    assert.equal(notifies[0].type, 'real_order');
    assert.match(notifies[0].message, /Real order placed/);
  });

  test('placeOrder failure → status error, no openPosition, real_order_failed', async () => {
    const { runtime, decisions, notifies, insertedTrades, statusRow } = createRuntime({
      placeOrder: async () => {
        const err = new Error('order_send failed');
        err.code = 'MT5_ORDER_PLACE_FAILED';
        throw err;
      },
    });

    const result = await runtime._maybeOpenPositionReal();

    assert.equal(result.error, true);
    assert.equal(runtime.openPosition, null);
    assert.equal(runtime.running, false);
    assert.equal(insertedTrades.length, 0);
    assert.equal(statusRow().status, 'error');

    const failed = decisions.find((d) => d.decisionType === 'real_order_failed');
    assert.ok(failed);
    assert.equal(failed.triggeringCondition, 'place_order_failed');
    assert.equal(failed.details.expected_account_type, 'demo');
    assert.ok(notifies.some((n) => /Real order failed/.test(n.message)));
  });

  test('stale last_validated_at blocks place (no placeOrder, status error)', async () => {
    const placeCalls = [];
    const { runtime, decisions, statusRow } = createRuntime({
      getMatchedAccountInfoForBotInstance: async () =>
        makeAccountInfo({
          last_validated_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
        }),
      placeOrder: async (args) => {
        placeCalls.push(args);
        return { ok: true, ticket: 1 };
      },
    });

    const result = await runtime._maybeOpenPositionReal();

    assert.equal(result.error, true);
    assert.equal(placeCalls.length, 0);
    assert.equal(statusRow().status, 'error');
    assert.ok(
      decisions.some(
        (d) =>
          d.decisionType === 'real_order_failed' &&
          d.triggeringCondition === 'stale_broker_connection'
      )
    );
    // Equity must not be persisted on the stale path.
    assert.equal(runtime.state.balance, 10);
  });

  test('REAL_MAX_LOT cap is applied on the volume sent to placeOrder', async () => {
    const { runtime, placeCalls, decisions } = createRuntime({ maxLot: 0.01 });
    await runtime._maybeOpenPositionReal();
    assert.equal(placeCalls[0].volume, 0.01);
    const placed = decisions.find((d) => d.decisionType === 'real_order_placed');
    assert.equal(placed.details.lot_sizing.cappedBy, 'REAL_MAX_LOT');
  });

  test('E1 invariant: demo detected type reaches Layer 0 even though dispatch is real', async () => {
    const { runtime, placeCalls, decisions } = createRuntime({
      getMatchedAccountInfoForBotInstance: async () =>
        makeAccountInfo({ account_type: 'demo' }),
    });

    // Simulate that Layer 3 already dispatched here (openReal). The
    // method under test must still pass 'demo', never 'real'.
    await runtime._maybeOpenPositionReal();

    assert.equal(placeCalls[0].expectedAccountType, 'demo');
    const placed = decisions.find((d) => d.decisionType === 'real_order_placed');
    assert.equal(placed.details.expected_account_type, 'demo');
  });
});
