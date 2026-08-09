'use strict';

/**
 * Synthetics Batch 2 — dispatch switch + reconciliation (mocked connector).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SyntheticBotRuntime } = require('./synthetic-bot-runtime');
const { resolveTickDispatch } = require('./tick-dispatch');

function makeInstance() {
  return {
    id: 'bot-syn-1',
    user_id: 'user-1',
    account_type: 'demo',
    synthetic_status: 'running',
    synthetic_active_trading_balance: 10000,
    synthetic_peak_equity: 10000,
    synthetic_initial_balance: 10,
    synthetic_current_tier: 0,
    synthetic_live_trading_confirmed_at: new Date(),
    active_strategy_mode: 'STRATEGY_A',
    daily_drawdown_day: null,
    daily_start_equity: null,
    daily_peak_equity: null,
  };
}

function makeEntryResult() {
  return {
    tradeApproved: true,
    learningInputs: { liveWinProbability: 0.5, consecutiveLosses: 0 },
    riskResult: { appliedRisk: 0.01, riskSource: 'test' },
    balanceBeforeTrade: 10000,
    riskedAmount: 100,
  };
}

function createRuntime(overrides = {}) {
  const decisions = [];
  const closed = [];
  const anomalies = [];
  const instance = makeInstance();

  const deps = {
    getMatchedAccountInfoForBotInstance:
      overrides.getMatchedAccountInfoForBotInstance ||
      (async () => ({
        equity: 9984.65,
        balance: 9984.65,
        account_type: 'demo',
        last_validated_at: new Date(),
      })),
    getSymbolInfo:
      overrides.getSymbolInfo ||
      (async () => ({
        symbol: 'Volatility 10 Index',
        bid: 4800,
        ask: 4801,
        volume_min: 0.5,
        volume_step: 0.01,
        volume_max: 400,
        trade_contract_size: 1,
      })),
    getPositions: overrides.getPositions || (async () => []),
    getOrderHistory:
      overrides.getOrderHistory ||
      (async () => ({
        ticket: 9001,
        close_price: 4810,
        profit: 12.5,
        close_time: Math.floor(Date.now() / 1000),
      })),
    placeOrder: overrides.placeOrder || (async () => ({ ticket: 9001, price: 4801, volume: 0.5 })),
    insertOpenRealTrade:
      overrides.insertOpenRealTrade ||
      (async (args) => ({
        id: 'trade-real-1',
        ...args,
        status: 'open',
        execution_mode: 'real',
        asset_class: 'synthetic',
        broker_ticket: args.brokerTicket,
      })),
    closeRealTrade:
      overrides.closeRealTrade ||
      (async (tradeId, args) => {
        const row = {
          id: tradeId,
          status: 'closed',
          execution_mode: 'real',
          asset_class: 'synthetic',
          exit_price: args.exitPrice,
          pnl: args.pnl,
        };
        closed.push(row);
        return row;
      }),
    insertDecision: async (args) => {
      decisions.push(args);
      return { id: `d-${decisions.length}`, ...args };
    },
    forceNotifyUser: async () => null,
    maybeNotifyUser: async () => null,
    updateStatusFields: async (_id, fields) => ({ ...instance, ...fields }),
    setStatus: async (row) => row,
    publishBotEvent: async () => {},
    getTierRows: async () => undefined,
    findInstanceById: async () => instance,
    loadTradeHistoryForLearning: async () => [],
    listOpenTradesForUser: overrides.listOpenTradesForUser || (async () => []),
    listOpenSyntheticTradesForResume:
      overrides.listOpenSyntheticTradesForResume || (async () => []),
    listOpenSyntheticRealTrades: overrides.listOpenSyntheticRealTrades || (async () => []),
    clampLotSize: overrides.clampLotSize,
    historyRetryTicks: overrides.historyRetryTicks ?? 3,
    strategySelection: overrides.strategySelection || {
      selectSyntheticTradeAcrossWatchlist: async () => ({
        chosen_instrument: 'Volatility 10 Index',
        direction: 'BUY',
        strategy_confidence: 0.9,
        strategy_id: 's1',
        strategy_name: 'Breakout',
        newsIntelligence: { market_quality: 0.5 },
        marketIntelligence: {
          trend_quality: 0.7,
          market_volatility: 'HIGH',
          diagnostics: { currentATR: 5, rollingAvgATR: 4 },
        },
      }),
      computeSelectionStopTarget: (_sel, entry) => ({
        stopPrice: entry - 10,
        targetPrice: entry + 20,
      }),
    },
  };

  const runtime = new SyntheticBotRuntime(instance, {
    ...deps,
    autoTick: false,
  });
  runtime.state = {
    balance: 10000,
    peakEquity: 10000,
    activeStrategyMode: 'STRATEGY_A',
    currentTier: 0,
    initialBalance: 10,
    tradeHistory: [],
  };
  runtime.running = true;

  return { runtime, decisions, closed, anomalies, instance };
}

describe('resolveTickDispatch (shared) routes synthetic modes', () => {
  it('openPaper / openReal / monitorPaper / monitorReal', () => {
    assert.equal(
      resolveTickDispatch({ resolvedMode: 'paper', openPosition: null }),
      'openPaper'
    );
    assert.equal(
      resolveTickDispatch({ resolvedMode: 'real', openPosition: null }),
      'openReal'
    );
    assert.equal(
      resolveTickDispatch({
        resolvedMode: 'real',
        openPosition: { executionMode: 'paper' },
      }),
      'monitorPaper'
    );
    assert.equal(
      resolveTickDispatch({
        resolvedMode: 'paper',
        openPosition: { executionMode: 'real' },
      }),
      'monitorReal'
    );
  });
});

describe('SyntheticBotRuntime real dispatch', () => {
  it('tickOnce routes to openReal when mode is real and no position', async () => {
    const placed = [];
    const { runtime } = createRuntime({
      placeOrder: async (args) => {
        placed.push(args);
        return { ticket: 42, price: args.volume, volume: 0.5 };
      },
      // Force volume that passes clamp (0.5 min): override calculated via clamp mock
      clampLotSize: () => ({ size: 0.5, skipped: false, reason: null }),
      findInstanceById: async () => ({
        ...makeInstance(),
        account_type: 'demo',
        synthetic_live_trading_confirmed_at: new Date(),
      }),
    });

    // Force resolver to real via stubs: monkey-patch
    runtime._resolveExecutionModeForTick = async () => 'real';
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    const result = await runtime.tickOnce();
    assert.ok(placed.length === 1, 'placeOrder should be called once');
    assert.equal(placed[0].expectedAccountType, 'demo'); // Layer 0
    assert.equal(result.trade.broker_ticket, 42);
    assert.equal(runtime.openPosition.executionMode, 'real');
  });

  it('skips placeOrder when clampLotSize says below_volume_min', async () => {
    const placed = [];
    const { runtime, decisions } = createRuntime({
      placeOrder: async (args) => {
        placed.push(args);
        return { ticket: 1, price: 1, volume: 0.5 };
      },
      clampLotSize: () => ({ size: null, skipped: true, reason: 'below_volume_min' }),
    });
    runtime._resolveExecutionModeForTick = async () => 'real';
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    const result = await runtime.tickOnce();
    assert.equal(placed.length, 0);
    assert.equal(result.lotSkipped, true);
    assert.ok(decisions.some((d) => d.triggeringCondition === 'lot_clamp_below_volume_min'));
  });

  it('on placeOrder rejection: skip tick, no paper fallback, no halt', async () => {
    const { runtime, decisions } = createRuntime({
      clampLotSize: () => ({ size: 0.5, skipped: false, reason: null }),
      placeOrder: async () => {
        const err = new Error('MT5_ORDER_PLACE_FAILED: volume');
        err.code = 'MT5_ORDER_PLACE_FAILED';
        err.details = { retcode: 10014 };
        throw err;
      },
    });
    runtime._resolveExecutionModeForTick = async () => 'real';
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    const result = await runtime.tickOnce();
    assert.equal(result.placeRejected, true);
    assert.equal(runtime._halted, false);
    assert.equal(runtime.openPosition, null);
    assert.ok(
      decisions.some((d) => d.triggeringCondition === 'place_order_rejected_skip_tick')
    );
  });

  it('blocks real open when any asset_class already has an open trade for the user', async () => {
    const placed = [];
    const { runtime } = createRuntime({
      listOpenTradesForUser: async () => [
        {
          id: 'forex-open-1',
          asset_class: 'forex_gold',
          status: 'open',
          symbol: 'EURUSD',
        },
      ],
      placeOrder: async (args) => {
        placed.push(args);
        return { ticket: 99, price: 1, volume: 0.5 };
      },
      clampLotSize: () => ({ size: 0.5, skipped: false, reason: null }),
    });
    runtime._resolveExecutionModeForTick = async () => 'real';
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    const result = await runtime.tickOnce();
    assert.equal(placed.length, 0);
    assert.equal(result, null);
    assert.equal(runtime.openPosition, null);
  });
});

describe('SyntheticBotRuntime reconciliation', () => {
  it('closes orphaned DB real row when ticket gone + history available', async () => {
    const { runtime, closed } = createRuntime({
      listOpenSyntheticRealTrades: async () => [
        {
          id: 'orphan-1',
          symbol: 'Volatility 25 Index',
          direction: 'BUY',
          entry_price: 2600,
          stop_price: 2590,
          target_price: 2620,
          final_applied_position_risk: 0.01,
          broker_ticket: 9001,
          conditions: null,
          execution_mode: 'real',
          asset_class: 'synthetic',
        },
      ],
      getPositions: async () => [],
      getOrderHistory: async () => ({
        ticket: 9001,
        close_price: 2610,
        profit: 5,
        close_time: Math.floor(Date.now() / 1000),
      }),
    });
    runtime._resolveExecutionModeForTick = async () => 'paper';
    // Avoid opening while reconciliation runs
    runtime._maybeOpenPositionPaper = async () => null;

    await runtime.tickOnce();
    assert.equal(closed.length, 1);
    assert.equal(closed[0].id, 'orphan-1');
    assert.equal(closed[0].exit_price, 2610);
    assert.equal(closed[0].pnl, 5);
    assert.equal(runtime.openPosition, null);
  });

  it('logs anomaly for broker Volatility Index position with no DB row', async () => {
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const { runtime } = createRuntime({
        listOpenSyntheticRealTrades: async () => [],
        getPositions: async () => [
          { ticket: 777, symbol: 'Volatility 10 Index', volume: 0.5 },
        ],
      });
      runtime._resolveExecutionModeForTick = async () => 'paper';
      runtime._maybeOpenPositionPaper = async () => null;

      await runtime.tickOnce();
      assert.ok(
        logs.some((l) => l.includes('ANOMALY: broker synthetic position with no matching DB'))
      );
    } finally {
      console.error = originalError;
    }
  });

  it('monitorReal: ticket still present → no close', async () => {
    const { runtime, closed } = createRuntime({
      getPositions: async () => [{ ticket: 9001, symbol: 'Volatility 10 Index' }],
    });
    runtime.openPosition = {
      tradeRowId: 't1',
      symbol: 'Volatility 10 Index',
      direction: 'BUY',
      entryPrice: 4800,
      stopPrice: 4790,
      targetPrice: 4820,
      executionMode: 'real',
      brokerTicket: 9001,
      conditions: null,
      historyRetryCount: 0,
      entryResult: makeEntryResult(),
    };
    runtime._resolveExecutionModeForTick = async () => 'real';
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    await runtime.tickOnce();
    assert.equal(closed.length, 0);
    assert.ok(runtime.openPosition);
  });
});
