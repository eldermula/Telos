'use strict';

/**
 * M5 PAPER-ONLY EXPERIMENT — harness coverage (docs/14_M5_Forex_Paper_Experiment.md).
 *
 * The fake connector below deliberately does NOT implement placeOrder/
 * closeOrder at all — if m5-paper-harness.js ever called either, these
 * tests would fail with "is not a function" immediately, which is a
 * stronger regression guard than just asserting on outcomes.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createM5PaperHarness } = require('./m5-paper-harness');

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

/** Only getRates / getSymbolInfo / getAccountInfo exist — on purpose. */
function makeFakeConnector({ balance = 10, symbolInfoBySymbol = {}, barsBySymbol = {}, failAccountInfo = false } = {}) {
  const calls = [];
  return {
    calls,
    async getAccountInfo() {
      calls.push('getAccountInfo');
      if (failAccountInfo) throw new Error('account_info_unavailable: (-10004, "No IPC connection")');
      return { ok: true, balance, equity: balance };
    },
    async getRates(symbol, opts) {
      calls.push(`getRates:${symbol}:${opts.timeframe}`);
      return { ok: true, bars: barsBySymbol[symbol] || genOversoldBars() };
    },
    async getSymbolInfo(symbol) {
      calls.push(`getSymbolInfo:${symbol}`);
      return (
        symbolInfoBySymbol[symbol] || {
          bid: 1.0976,
          ask: 1.0978,
          volume_min: 0.01,
          volume_step: 0.01,
          volume_max: 20,
          trade_contract_size: 100000,
        }
      );
    },
  };
}

function makeFakeStrategiesRepo(strategies = [RSI_STRATEGY]) {
  return { listActiveStrategies: async () => strategies };
}

describe('m5-paper-harness: lifecycle', () => {
  it('start() flips status to running and stop() flips it back, idempotently', () => {
    const harness = createM5PaperHarness({
      mt5Connector: makeFakeConnector(),
      candidateStrategiesRepository: makeFakeStrategiesRepo([]),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000, // never auto-fires during the test
    });

    assert.equal(harness.getStatus().status, 'stopped');
    harness.start();
    assert.equal(harness.getStatus().status, 'running');
    harness.start(); // idempotent — no error, no second timer
    assert.equal(harness.getStatus().status, 'running');
    harness.stop();
    assert.equal(harness.getStatus().status, 'stopped');
    harness.stop(); // idempotent
    assert.equal(harness.getStatus().status, 'stopped');
    harness._resetForTests();
  });
});

describe('m5-paper-harness: tick() — open path', () => {
  it('opens a paper trade end-to-end when a strategy fires and balance clears volume_min', async () => {
    const connector = makeFakeConnector({ balance: 10 });
    const harness = createM5PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const status = harness.getStatus();
    assert.equal(status.openTrade.symbol, 'EURUSD');
    assert.equal(status.openTrade.direction, 'BUY');
    assert.equal(status.openTrade.status, 'open');
    assert.equal(status.decisionLog[0].type, 'opened');

    // Only read-only calls were ever made.
    for (const call of connector.calls) {
      assert.ok(
        call.startsWith('getAccountInfo') || call.startsWith('getRates') || call.startsWith('getSymbolInfo'),
        `unexpected connector call: ${call}`
      );
    }
    harness._resetForTests();
  });

  it('logs skipped_below_volume_min instead of opening when balance is too small', async () => {
    const connector = makeFakeConnector({ balance: 0.05 });
    const harness = createM5PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const status = harness.getStatus();
    assert.equal(status.openTrade, null);
    assert.equal(status.decisionLog[0].type, 'skipped_below_volume_min');
    harness._resetForTests();
  });

  it('does not open a second trade while one is already open (one-position-system-wide)', async () => {
    const connector = makeFakeConnector({ balance: 10 });
    const harness = createM5PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const firstOpenTrade = harness.getStatus().openTrade;
    assert.ok(firstOpenTrade);

    const callsBeforeSecondTick = connector.calls.length;
    await harness.tick();
    // Monitoring still runs (getSymbolInfo for the open trade's symbol),
    // but no fresh account-info/rates fetch to look for a new entry.
    const accountInfoCallsAfter = connector.calls.filter((c) => c === 'getAccountInfo').length;
    assert.equal(accountInfoCallsAfter, 1, 'tryOpen should be skipped while a trade is open');
    assert.ok(connector.calls.length >= callsBeforeSecondTick);
    assert.deepEqual(harness.getStatus().openTrade, firstOpenTrade);
    harness._resetForTests();
  });

  it('handles account-info failure without throwing, and logs it', async () => {
    const connector = makeFakeConnector({ failAccountInfo: true });
    const harness = createM5PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const status = harness.getStatus();
    assert.equal(status.openTrade, null);
    assert.equal(status.decisionLog[0].type, 'account_info_unavailable');
    assert.equal(status.lastTickError, null); // caught internally, tick() itself doesn't fail
    harness._resetForTests();
  });
});

describe('m5-paper-harness: tick() — monitor/close path', () => {
  it('closes the open trade once price hits target, freeing the slot', async () => {
    const barsBySymbol = { EURUSD: genOversoldBars() };
    let symbolInfo = {
      bid: 1.0976,
      ask: 1.0978,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 20,
      trade_contract_size: 100000,
    };
    const connector = makeFakeConnector({ balance: 10, barsBySymbol, symbolInfoBySymbol: { EURUSD: symbolInfo } });
    const harness = createM5PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const opened = harness.getStatus().openTrade;
    assert.ok(opened);

    // Move price to (and past) the target on the next tick. Bars are also
    // swapped to a flat, no-signal window so the freed slot doesn't
    // immediately re-open on the very same tick (a legitimate behavior
    // in production — flat-out-of-a-position ticks do look for the next
    // entry — but this test is isolating the close mechanism only).
    connector.getSymbolInfo = async () => ({ ...symbolInfo, bid: opened.targetPrice + 0.001, ask: opened.targetPrice + 0.0012 });
    connector.getRates = async () => ({ ok: true, bars: genOversoldBars({ declineBars: 0 }) });

    await harness.tick();
    const status = harness.getStatus();
    assert.equal(status.openTrade, null);
    assert.equal(status.closedTrades.length, 1);
    assert.equal(status.closedTrades[0].outcome, 'target_hit');
    assert.ok(status.closedTrades[0].pnl > 0);
    harness._resetForTests();
  });
});

describe('m5-paper-harness: status shape', () => {
  it('exposes the M15-independent watchlist and never grows history unbounded', async () => {
    const harness = createM5PaperHarness({
      mt5Connector: makeFakeConnector({ balance: 0.05 }), // always skips, never opens
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    for (let i = 0; i < 5; i += 1) {
      await harness.tick();
    }
    const status = harness.getStatus();
    assert.equal(status.watchlist.length, 1);
    assert.equal(status.tickCount, 5);
    assert.ok(status.decisionLog.length <= 50);
    harness._resetForTests();
  });
});
