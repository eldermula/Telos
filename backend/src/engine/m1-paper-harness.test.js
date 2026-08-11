'use strict';

/**
 * M1 PAPER-ONLY EXPERIMENT — harness coverage (docs/15_M1_Forex_Paper_Experiment.md).
 *
 * The fake connector deliberately does NOT implement placeOrder/closeOrder
 * at all — if m1-paper-harness.js ever called either, these tests would
 * fail with "is not a function" immediately.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createM1PaperHarness } = require('./m1-paper-harness');

function genOversoldBars({ n = 60, base = 1.1, oscAmp = 0.0001, declineBars = 3, declineStep = 0.0008, wick = 0.00005 } = {}) {
  const bars = [];
  let price = base;
  for (let i = 0; i < n; i += 1) {
    const delta = i < n - declineBars ? (i % 2 === 0 ? 1 : -1) * oscAmp : -declineStep;
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    bars.push({ time: 1700000000 + i * 60, open, high, low, close, tick_volume: 100 });
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

describe('m1-paper-harness: lifecycle', () => {
  it('start() flips status to running and stop() flips it back, idempotently', () => {
    const harness = createM1PaperHarness({
      mt5Connector: makeFakeConnector(),
      candidateStrategiesRepository: makeFakeStrategiesRepo([]),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    assert.equal(harness.getStatus().status, 'stopped');
    harness.start();
    assert.equal(harness.getStatus().status, 'running');
    harness.start();
    assert.equal(harness.getStatus().status, 'running');
    harness.stop();
    assert.equal(harness.getStatus().status, 'stopped');
    harness.stop();
    assert.equal(harness.getStatus().status, 'stopped');
    harness._resetForTests();
  });
});

describe('m1-paper-harness: tick() — open path', () => {
  it('opens a paper trade end-to-end when a strategy fires and balance clears volume_min', async () => {
    const connector = makeFakeConnector({ balance: 10 });
    const harness = createM1PaperHarness({
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

    for (const call of connector.calls) {
      assert.ok(
        call.startsWith('getAccountInfo') || call.startsWith('getRates') || call.startsWith('getSymbolInfo'),
        `unexpected connector call: ${call}`
      );
    }
    // Must request M1 bars, not M5/M15.
    assert.ok(connector.calls.some((c) => c === 'getRates:EURUSD:M1'));
    harness._resetForTests();
  });

  it('logs skipped_below_volume_min instead of opening when balance is too small', async () => {
    const connector = makeFakeConnector({ balance: 0.05 });
    const harness = createM1PaperHarness({
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

  it('does not open a second trade while one is already open', async () => {
    const connector = makeFakeConnector({ balance: 10 });
    const harness = createM1PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const firstOpenTrade = harness.getStatus().openTrade;
    assert.ok(firstOpenTrade);

    await harness.tick();
    const accountInfoCallsAfter = connector.calls.filter((c) => c === 'getAccountInfo').length;
    assert.equal(accountInfoCallsAfter, 1);
    assert.deepEqual(harness.getStatus().openTrade, firstOpenTrade);
    harness._resetForTests();
  });

  it('handles account-info failure without throwing, and logs it', async () => {
    const connector = makeFakeConnector({ failAccountInfo: true });
    const harness = createM1PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const status = harness.getStatus();
    assert.equal(status.openTrade, null);
    assert.equal(status.decisionLog[0].type, 'account_info_unavailable');
    assert.equal(status.lastTickError, null);
    harness._resetForTests();
  });
});

describe('m1-paper-harness: tick() — monitor/close path', () => {
  it('closes the open trade once price hits target, freeing the slot', async () => {
    const barsBySymbol = { EURUSD: genOversoldBars() };
    const symbolInfo = {
      bid: 1.0976,
      ask: 1.0978,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 20,
      trade_contract_size: 100000,
    };
    const connector = makeFakeConnector({ balance: 10, barsBySymbol, symbolInfoBySymbol: { EURUSD: symbolInfo } });
    const harness = createM1PaperHarness({
      mt5Connector: connector,
      candidateStrategiesRepository: makeFakeStrategiesRepo(),
      watchlist: ['EURUSD'],
      tickMs: 1_000_000,
    });

    await harness.tick();
    const opened = harness.getStatus().openTrade;
    assert.ok(opened);

    connector.getSymbolInfo = async () => ({
      ...symbolInfo,
      bid: opened.targetPrice + 0.001,
      ask: opened.targetPrice + 0.0012,
    });
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

describe('m1-paper-harness: structural isolation', () => {
  it('source never calls placeOrder/closeOrder or imports real-dispatch modules', () => {
    const src = fs.readFileSync(require.resolve('./m1-paper-harness'), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/require\([^)]*(m5-real-dispatch|m5-real-harness|bot-runtime|trading-engine)/.test(codeOnly), false);
    assert.equal(/\bplaceOrder\s*\(/.test(codeOnly), false);
    assert.equal(/\bcloseOrder\s*\(/.test(codeOnly), false);
    assert.equal(/REAL_TRADING_ENABLED/.test(codeOnly), false);
  });
});
