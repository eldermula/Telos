'use strict';

/**
 * M5 real-dispatch (UNPROVEN LIVE, docs/14_M5_Forex_Paper_Experiment.md) —
 * pure unit coverage against fully mocked deps. No network, no DB, no MT5
 * connector calls anywhere in this file — every dep below is a hand-written
 * stub. Mirrors bot-runtime.js's real-open/monitor test discipline (Layer 0
 * retry, halt-on-failure, one-open-trade-per-user) plus the M5 probe's
 * clamp-skip fixtures already validated in m5-paper-strategy.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { attemptOpen, attemptMonitor, ASSET_CLASS } = require('./m5-real-dispatch');

const FX_SYMBOL_INFO = { volume_min: 0.01, volume_step: 0.01, volume_max: 20, trade_contract_size: 100000 };
const XAU_SYMBOL_INFO = { volume_min: 0.01, volume_step: 0.01, volume_max: 10, trade_contract_size: 100 };

function genOversoldBars({ n = 60, base = 1.1, oscAmp = 0.0001, declineBars = 3, declineStep = 0.0008, wick = 0.00005 } = {}) {
  const bars = [];
  let price = base;
  for (let i = 0; i < n; i += 1) {
    const delta = i < n - declineBars ? (i % 2 === 0 ? 1 : -1) * oscAmp : -declineStep;
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    bars.push({ time: 1700000000 + i * 300, open, high, low, close, tick_volume: 100 });
    price = close;
  }
  return bars;
}

const RSI_STRATEGY = {
  id: 'strategy-rsi',
  name: 'RSI Mean Reversion',
  rule_set: {
    regime_fit: { trend_quality_max: 0.4 },
    signal: { type: 'rsi_reversion', period: 14, oversold: 30, overbought: 70 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

function baseDeps(overrides = {}) {
  const bars = genOversoldBars();
  const insertedTrades = [];
  const insertedDecisions = [];
  const notifications = [];

  return {
    botInstanceId: 'bi-1',
    userId: 'user-1',
    watchlist: ['EURUSD'],
    maxAgeHours: 24,
    now: () => new Date('2026-08-11T12:00:00Z'),
    getMatchedAccountInfo: async () => ({
      account_type: 'demo',
      equity: 10,
      last_validated_at: '2026-08-11T11:00:00Z',
    }),
    listOpenTradesForUser: async () => [],
    listActiveStrategies: async () => [RSI_STRATEGY],
    getRates: async () => ({ bars }),
    getSymbolInfo: async () => ({ ...FX_SYMBOL_INFO, bid: 1.0976, ask: 1.0978 }),
    getPositions: async () => [],
    getOrderHistory: async () => ({ close_price: 1.1, profit: 5, close_time: 1700003000 }),
    placeOrder: async () => ({ ticket: 555, price: 1.0978, volume: 0.02 }),
    insertOpenRealTrade: async (args) => {
      insertedTrades.push(args);
      return { id: 'trade-1', ...args };
    },
    closeRealTrade: async (id, args) => ({ id, ...args, status: 'closed' }),
    insertDecision: async (args) => {
      insertedDecisions.push(args);
      return args;
    },
    forceNotifyUser: async (userId, type, message) => {
      notifications.push({ userId, type, message });
      return null;
    },
    _insertedTrades: insertedTrades,
    _insertedDecisions: insertedDecisions,
    _notifications: notifications,
    ...overrides,
  };
}

describe('m5-real-dispatch: Layer 0 account-info retry', () => {
  it('succeeds after one retry (mirrors bot-runtime.js ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS)', async () => {
    let calls = 0;
    const deps = baseDeps({
      getMatchedAccountInfo: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('MT5 account_info unavailable: (-10004, "No IPC connection")');
          err.code = -10004;
          throw err;
        }
        return { account_type: 'demo', equity: 10, last_validated_at: '2026-08-11T11:00:00Z' };
      },
    });

    const result = await attemptOpen(deps);
    assert.equal(calls, 2);
    assert.equal(result.halt, false);
  });

  it('halts after both the first attempt and the single retry fail', async () => {
    let calls = 0;
    const deps = baseDeps({
      getMatchedAccountInfo: async () => {
        calls += 1;
        const err = new Error('No IPC connection');
        err.code = -10004;
        throw err;
      },
    });

    const result = await attemptOpen(deps);
    assert.equal(calls, 2, 'exactly one retry, not an unbounded loop');
    assert.equal(result.halt, true);
    assert.equal(result.outcome, 'account_info_unavailable');
    assert.equal(result.details.retried, true);
  });
});

describe('m5-real-dispatch: connection freshness / equity preconditions', () => {
  it('halts on a stale broker connection', async () => {
    const deps = baseDeps({
      getMatchedAccountInfo: async () => ({
        account_type: 'demo',
        equity: 10,
        last_validated_at: '2020-01-01T00:00:00Z', // far outside 24h
      }),
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, true);
    assert.equal(result.outcome, 'stale_broker_connection');
  });

  it('halts on invalid/non-positive live equity', async () => {
    const deps = baseDeps({
      getMatchedAccountInfo: async () => ({
        account_type: 'demo',
        equity: 0,
        last_validated_at: '2026-08-11T11:00:00Z',
      }),
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, true);
    assert.equal(result.outcome, 'invalid_live_equity');
  });
});

describe('m5-real-dispatch: system-wide one_open_trade_per_user', () => {
  it('blocks (without halting) when the user already has an open trade in any asset class', async () => {
    const deps = baseDeps({
      listOpenTradesForUser: async () => [{ id: 'other-trade', asset_class: 'forex_gold' }],
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'one_open_trade_blocked');
    assert.equal(deps._insertedTrades.length, 0, 'must never place an order while blocked');
  });
});

describe('m5-real-dispatch: clamp-skip at $5/$10 matches the M5 probe (XAUUSD/USDJPY)', () => {
  it('XAUUSD at $5 equity skips below volume_min, does not place an order', async () => {
    // Gold-scale bars (base ~4380, amplitude scaled ~20000x vs the EURUSD
    // default) so the resulting ATR/stop-distance lands in XAUUSD's real
    // M5 ballpark (probe: ATR14 ~4.23, stop distance ~6.34), not a tiny
    // EURUSD-scale stop that would under-represent gold's real risk.
    const bars = genOversoldBars({ base: 4380, oscAmp: 2, declineStep: 16, wick: 1 });
    const deps = baseDeps({
      watchlist: ['XAUUSD'],
      getMatchedAccountInfo: async () => ({
        account_type: 'demo',
        equity: 5,
        last_validated_at: '2026-08-11T11:00:00Z',
      }),
      getRates: async () => ({ bars }),
      getSymbolInfo: async () => ({ ...XAU_SYMBOL_INFO, bid: 4378, ask: 4380 }),
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'skipped_below_volume_min');
    assert.equal(deps._insertedTrades.length, 0);
    assert.equal(deps._notifications.length, 0);
  });

  it('USDJPY at $10 equity skips below volume_min, does not place an order', async () => {
    const bars = genOversoldBars({ base: 150, oscAmp: 0.01, declineStep: 0.08, wick: 0.005 });
    const deps = baseDeps({
      watchlist: ['USDJPY'],
      getMatchedAccountInfo: async () => ({
        account_type: 'demo',
        equity: 10,
        last_validated_at: '2026-08-11T11:00:00Z',
      }),
      getRates: async () => ({ bars }),
      getSymbolInfo: async () => ({ ...FX_SYMBOL_INFO, bid: 149.4, ask: 149.42 }),
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'skipped_below_volume_min');
    assert.equal(deps._insertedTrades.length, 0);
  });
});

describe('m5-real-dispatch: attemptOpen — successful real open', () => {
  it('places a real order, records the trade with asset_class=m5_forex_gold, logs, and notifies', async () => {
    const deps = baseDeps();
    const result = await attemptOpen(deps);

    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'opened');
    assert.equal(result.openTrade.symbol, 'EURUSD');
    assert.equal(result.openTrade.brokerTicket, 555);

    assert.equal(deps._insertedTrades.length, 1);
    assert.equal(deps._insertedTrades[0].assetClass, ASSET_CLASS);
    assert.equal(deps._insertedTrades[0].brokerTicket, 555);
    assert.equal(deps._insertedTrades[0].botInstanceId, 'bi-1');

    assert.equal(deps._insertedDecisions.length, 1);
    assert.equal(deps._insertedDecisions[0].decisionType, 'real_order_placed');
    assert.equal(deps._insertedDecisions[0].assetClass, ASSET_CLASS);

    assert.equal(deps._notifications.length, 1);
    assert.equal(deps._notifications[0].type, 'real_order');
  });

  it('halts (does not silently skip) when placeOrder itself fails', async () => {
    const deps = baseDeps({
      placeOrder: async () => {
        throw new Error('MT5_ORDER_PLACE_FAILED: retcode 10004');
      },
    });
    const result = await attemptOpen(deps);
    assert.equal(result.halt, true);
    assert.equal(result.outcome, 'place_order_failed');
    assert.equal(deps._insertedTrades.length, 0, 'must not record a trade for a rejected order');
  });
});

describe('m5-real-dispatch: attemptMonitor — broker-authoritative close detection', () => {
  const openTrade = {
    tradeRowId: 'trade-1',
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.0978,
    stopPrice: 1.0948,
    targetPrice: 1.1038,
    lotSize: 0.02,
    contractSize: 100000,
    brokerTicket: 555,
  };

  it('does nothing while the ticket is still open at the broker', async () => {
    const deps = baseDeps({ getPositions: async () => [{ ticket: 555 }] });
    const result = await attemptMonitor(deps, openTrade);
    assert.equal(result.outcome, 'still_open');
    assert.equal(result.halt, false);
    assert.equal(deps._insertedDecisions.length, 0);
  });

  it('reconciles via order history once the ticket disappears, closes the trade, and notifies', async () => {
    const deps = baseDeps({
      getPositions: async () => [], // ticket gone
      getOrderHistory: async () => ({ close_price: 1.1038, profit: 12, close_time: 1700003600 }),
    });
    const result = await attemptMonitor(deps, openTrade);

    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'closed');
    assert.equal(result.closedTrade.pnl, 12);
    assert.equal(result.closedTrade.wasWin, true);

    assert.equal(deps._insertedDecisions.length, 1);
    assert.equal(deps._insertedDecisions[0].decisionType, 'real_order_closed');
    assert.equal(deps._notifications.length, 1);
  });

  it('halts if order history never becomes available (never invents an exit/pnl)', async () => {
    const deps = baseDeps({
      getPositions: async () => [],
      getOrderHistory: async () => {
        throw new Error('deal not found in history yet');
      },
    });
    const result = await attemptMonitor(deps, openTrade);
    assert.equal(result.halt, true);
    assert.equal(result.outcome, 'order_history_unavailable');
  });

  it('a transient getPositions error retries next tick, never invents a close', async () => {
    const deps = baseDeps({
      getPositions: async () => {
        throw new Error('connector timeout');
      },
    });
    const result = await attemptMonitor(deps, openTrade);
    assert.equal(result.halt, false);
    assert.equal(result.outcome, 'monitor_transient_error');
  });
});
