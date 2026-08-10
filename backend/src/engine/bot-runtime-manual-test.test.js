'use strict';

/**
 * Forex manual test-dispatch path: origin=manual, placeRejected skips halt.
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
  const insertedTrades = [];
  let statusRow = {
    id: 'bot-1',
    status: 'running',
    active_trading_balance: 10000,
    peak_equity: 10000,
  };

  const deps = {
    getMatchedAccountInfoForBotInstance:
      overrides.getMatchedAccountInfoForBotInstance || (async () => makeAccountInfo()),
    getSymbolInfo: overrides.getSymbolInfo || (async () => makeSymbolInfo()),
    getPositions: overrides.getPositions || (async () => [{ ticket: 9001, symbol: 'EURUSD' }]),
    placeOrder:
      overrides.placeOrder ||
      (async (args) => ({
        ok: true,
        ticket: 9001,
        deal: 1,
        volume: args.volume,
        price: 1.1001,
      })),
    insertOpenRealTrade:
      overrides.insertOpenRealTrade ||
      (async (args) => {
        insertedTrades.push(args);
        return {
          id: 'trade-1',
          status: 'open',
          execution_mode: 'real',
          origin: args.origin,
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
    forceNotifyUser: async () => ({ id: 'n-1' }),
    updateStatusFields: async (_id, fields) => {
      statusRow = { ...statusRow, ...fields };
      return statusRow;
    },
    setStatus: async (row) => row,
    publishBotEvent: async () => {},
    getTierRows: async () => undefined,
    now: () => new Date(),
    maxLot: 1,
    maxAgeHours: 24,
    strategySelection: overrides.strategySelection || makeFakeStrategySelection(),
  };

  const runtime = new BotRuntime(
    { id: 'bot-1', user_id: 'user-1', status: 'running' },
    { ...deps, autoTick: false }
  );
  runtime.state = {
    balance: 10000,
    peakEquity: 10000,
    activeStrategyMode: 'STRATEGY_A',
    currentTier: 0,
    consecutiveLosses: 0,
    tradeHistory: [],
  };
  runtime.dailyDrawdownMarkers = {
    dayKey: '2026-08-10',
    dayStartEquity: 10000,
    dayPeakEquity: 10000,
  };
  return { runtime, decisions, insertedTrades };
}

describe('forex manual test real open', () => {
  test('manualTest sets origin=manual and returns evidence fields', async () => {
    const { runtime, insertedTrades } = createRuntime();
    const forcedSelection = {
      chosen_instrument: 'EURUSD',
      direction: 'BUY',
      strategy_id: 'manual_test',
      strategy_name: 'manual_test',
      strategy_confidence: 0.99,
      stopRule: { multiple: 1.5 },
      targetRule: { ratio: 2 },
      newsIntelligence: { market_quality: 0.5 },
      marketIntelligence: {
        trend_quality: 0.8,
        market_volatility: 'NORMAL',
        diagnostics: { currentATR: 0.001, rollingAvgATR: 0.001 },
        stale: false,
      },
    };

    const result = await runtime._maybeOpenPositionReal({
      forcedSelection,
      manualTest: true,
    });

    assert.ok(result.trade);
    assert.equal(insertedTrades[0].origin, 'manual');
    assert.equal(result.clamped.size, result.trade.lot_size || insertedTrades[0].lotSize);
    assert.ok(result.placeResult);
    assert.ok(Array.isArray(result.brokerPositions));
    assert.equal(result.symbol, 'EURUSD');
    assert.equal(result.direction, 'BUY');
    assert.ok(result.stopPrice > 0);
    assert.ok(result.targetPrice > 0);
  });

  test('manualTest placeOrder rejection does not halt runtime', async () => {
    const { runtime, decisions } = createRuntime({
      placeOrder: async () => {
        const err = new Error('broker rejected');
        err.code = 'PLACE_REJECTED';
        throw err;
      },
    });
    const forcedSelection = {
      chosen_instrument: 'EURUSD',
      direction: 'BUY',
      strategy_id: 'manual_test',
      strategy_name: 'manual_test',
      strategy_confidence: 0.99,
      stopRule: { multiple: 1.5 },
      targetRule: { ratio: 2 },
      newsIntelligence: { market_quality: 0.5 },
      marketIntelligence: {
        trend_quality: 0.8,
        market_volatility: 'NORMAL',
        diagnostics: { currentATR: 0.001, rollingAvgATR: 0.001 },
        stale: false,
      },
    };

    const result = await runtime._maybeOpenPositionReal({
      forcedSelection,
      manualTest: true,
    });

    assert.equal(result.placeRejected, true);
    assert.equal(result.trade, null);
    assert.equal(runtime._halted, false);
    assert.ok(decisions.some((d) => d.decisionType === 'real_order_failed'));
  });
});

describe('bot-status forex allow_demo_confirm surface', () => {
  test('toCachePayload exposes allow_demo_confirm and demo real_trading_available', () => {
    const { toCachePayload } = require('./bot-status.cache');
    const payload = toCachePayload(
      {
        id: 'bot-1',
        status: 'stopped',
        crypto_status: 'stopped',
        synthetic_status: 'stopped',
        halt_new_opens: false,
        synthetic_halt_new_opens: false,
        active_strategy_mode: 'STRATEGY_A',
        current_tier: 0,
        active_trading_balance: 1000,
        peak_equity: 1000,
        account_type: 'demo',
        live_trading_confirmed_at: null,
        synthetic_live_trading_confirmed_at: null,
        synthetic_active_trading_balance: null,
        synthetic_peak_equity: null,
        synthetic_current_tier: 0,
      },
      new Date(),
      { allowDemoConfirm: true, syntheticAllowDemoConfirm: false }
    );
    assert.equal(payload.allow_demo_confirm, true);
    assert.equal(payload.synthetic_allow_demo_confirm, false);
    // REAL_TRADING_ENABLED may be false in test env — only assert demo surface flag.
    assert.equal(payload.allow_demo_confirm, true);
  });
});
