'use strict';

/**
 * dailyDrawdownPct runtime wiring — mocked, no Postgres/MT5.
 * Proves a synthetic -20% from day peak forces the micro breaker's
 * dailyDrawdown arm and the 1% emergency floor.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BotRuntime } = require('./bot-runtime');
const { makeFakeStrategySelection } = require('../../scripts/test-helpers/fake-strategy-selection');
const { EMERGENCY_FLOOR_RISK } = require('../../../bot/apirs/src/constants');

function createRuntime(overrides = {}) {
  const statusUpdates = [];
  let statusRow = {
    id: 'bot-1',
    status: 'running',
    active_trading_balance: 800,
    peak_equity: 1000,
    daily_drawdown_day: '2026-08-11',
    daily_start_equity: 1000,
    daily_peak_equity: 1000,
  };

  // Frozen clock for UTC-day tests — last_validated_at must match this
  // clock or the 24h freshness gate treats the connection as stale.
  const nowFn = overrides.now || (() => new Date('2026-08-11T12:00:00.000Z'));
  const { now: _ignoreNow, equity, strategySelection, ...restOverrides } = overrides;

  const runtime = new BotRuntime(
    { id: 'bot-1', user_id: 'user-1' },
    {
      autoTick: false,
      now: nowFn,
      updateStatusFields: async (_id, fields) => {
        statusRow = { ...statusRow, ...fields };
        statusUpdates.push(fields);
        return statusRow;
      },
      setStatus: async (row) => row,
      publishBotEvent: async () => {},
      getTierRows: async () => undefined,
      getMatchedAccountInfoForBotInstance: async () => ({
        broker_connection_id: 'bc-1',
        account_type: 'demo',
        equity: equity ?? 800,
        last_validated_at: nowFn(),
      }),
      getSymbolInfo: async () => ({
        symbol: 'EURUSD',
        volume_min: 0.01,
        volume_step: 0.01,
        volume_max: 100,
        trade_contract_size: 100000,
        bid: 1.1,
        ask: 1.1001,
      }),
      placeOrder: async () => ({
        ok: true,
        ticket: 9001,
        deal: 1,
        volume: 0.01,
        price: 1.1001,
      }),
      insertOpenRealTrade: async (args) => ({
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
      }),
      insertDecision: async (args) => args,
      forceNotifyUser: async () => ({ id: 'n-1' }),
      strategySelection:
        strategySelection ||
        makeFakeStrategySelection({ strategyConfidence: 0.85 }),
      maxLot: 0.01,
      ...restOverrides,
    }
  );

  runtime.running = true;
  runtime.state = {
    balance: 800,
    peakEquity: 1000,
    activeStrategyMode: 'STRATEGY_A',
    currentTier: 0,
    initialBalance: 10,
    tradeHistory: [],
  };
  runtime.dailyDrawdownMarkers = {
    day: '2026-08-11',
    startEquity: 1000,
    peakEquity: 1000,
  };

  return { runtime, statusUpdates, statusRow: () => statusRow };
}

describe('dailyDrawdownPct runtime wiring', () => {
  test('real open: -20% from day peak forces micro dailyDrawdown + 1% floor', async () => {
    const { runtime, statusUpdates } = createRuntime({ equity: 800 });

    const result = await runtime._maybeOpenPositionReal();

    assert.ok(result && result.entryResult);
    const micro = result.entryResult.riskResult.microResult;
    assert.equal(micro.triggeredConditions.dailyDrawdown, true);
    assert.equal(micro.forcedToEmergencyFloor, true);
    assert.equal(result.entryResult.riskResult.appliedRisk, EMERGENCY_FLOOR_RISK);
    assert.equal(result.entryResult.riskResult.riskSource, 'section7_forced_floor');

    assert.ok(
      statusUpdates.some(
        (u) =>
          u.daily_drawdown_day === '2026-08-11' &&
          Number(u.daily_peak_equity) === 1000 &&
          Number(u.daily_start_equity) === 1000
      )
    );
    assert.equal(runtime.dailyDrawdownMarkers.peakEquity, 1000);
  });

  test('profit-lock shrink floors daily peak so lock cannot invent drawdown', () => {
    const { runtime } = createRuntime();
    runtime.dailyDrawdownMarkers = {
      day: '2026-08-11',
      startEquity: 1000,
      peakEquity: 1200,
    };

    const shrunk = runtime._shrinkDailyDrawdownForProfitLock(
      {
        profitLockResult: {
          profitLockTriggered: true,
          lockedProfitAmount: 200,
        },
      },
      900
    );

    assert.equal(shrunk, true);
    assert.equal(runtime.dailyDrawdownMarkers.startEquity, 900);
    assert.equal(runtime.dailyDrawdownMarkers.peakEquity, 1000);
  });

  test('_refreshDailyDrawdown rolls over on new UTC day', async () => {
    const { runtime, statusUpdates } = createRuntime({
      now: () => new Date('2026-08-12T01:00:00.000Z'),
    });
    runtime.dailyDrawdownMarkers = {
      day: '2026-08-11',
      startEquity: 1000,
      peakEquity: 1200,
    };

    const dd = await runtime._refreshDailyDrawdown(950);

    assert.equal(dd.rolledOver, true);
    assert.equal(dd.markers.day, '2026-08-12');
    assert.equal(dd.markers.startEquity, 950);
    assert.equal(dd.markers.peakEquity, 950);
    assert.equal(dd.dailyDrawdownPct, 0);
    assert.ok(statusUpdates.some((u) => u.daily_drawdown_day === '2026-08-12'));
  });
});
