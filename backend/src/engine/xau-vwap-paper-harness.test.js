'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createXauVwapPaperHarness } = require('./xau-vwap-paper-harness');
const { MIN_BARS } = require('./xau-vwap-paper-strategy');

function genStretchCrossBars() {
  const dayStart = 1700000000;
  const bars = [];
  const base = 4370;
  for (let i = 0; i < MIN_BARS - 1; i += 1) {
    const close = base + (i % 2 === 0 ? 0.2 : -0.2);
    bars.push({
      time: dayStart + i * 300,
      open: close,
      high: close + 0.4,
      low: close - 0.4,
      close,
      tick_volume: 100,
    });
  }
  const prevClose = bars[bars.length - 1].close;
  const stretchClose = prevClose + 50;
  bars.push({
    time: bars[bars.length - 1].time + 300,
    open: prevClose,
    high: stretchClose + 2,
    low: prevClose - 1,
    close: stretchClose,
    tick_volume: 200,
  });
  return bars;
}

function makeFakeConnector({ balance = 50, bars = genStretchCrossBars() } = {}) {
  const calls = [];
  const symbolInfo = {
    bid: bars[bars.length - 1].close - 0.05,
    ask: bars[bars.length - 1].close + 0.13,
    volume_min: 0.01,
    volume_step: 0.01,
    volume_max: 20,
    trade_contract_size: 100,
  };
  return {
    calls,
    async getAccountInfo() {
      calls.push('getAccountInfo');
      return { ok: true, balance, equity: balance };
    },
    async getRates(symbol, opts) {
      calls.push(`getRates:${symbol}:${opts.timeframe}`);
      return { ok: true, bars };
    },
    async getSymbolInfo(symbol) {
      calls.push(`getSymbolInfo:${symbol}`);
      return symbolInfo;
    },
  };
}

describe('xau-vwap-paper-harness: lifecycle', () => {
  it('start/stop idempotently', () => {
    const harness = createXauVwapPaperHarness({
      mt5Connector: makeFakeConnector(),
      tickMs: 1_000_000,
    });
    assert.equal(harness.getStatus().status, 'stopped');
    harness.start();
    assert.equal(harness.getStatus().status, 'running');
    harness.stop();
    assert.equal(harness.getStatus().status, 'stopped');
    harness._resetForTests();
  });
});

describe('xau-vwap-paper-harness: tick opens on stretch cross', () => {
  it('opens paper trade when p90 VWAP cross fires', async () => {
    const harness = createXauVwapPaperHarness({
      mt5Connector: makeFakeConnector(),
      tickMs: 1_000_000,
    });
    await harness.tick();
    const st = harness.getStatus();
    assert.ok(st.openTrade);
    assert.equal(st.openTrade.symbol, 'XAUUSD');
    assert.equal(st.openTrade.direction, 'SELL');
    harness._resetForTests();
  });
});

describe('xau-vwap-paper-harness: isolation', () => {
  it('fake connector has no placeOrder/closeOrder — harness never calls them', () => {
    const codeOnly = fs
      .readFileSync(path.join(__dirname, 'xau-vwap-paper-harness.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.equal(/\bplaceOrder\s*\(/.test(codeOnly), false);
    assert.equal(/\bcloseOrder\s*\(/.test(codeOnly), false);
    assert.equal(/require\([^)]*m5-real/.test(codeOnly), false);
    assert.equal(/require\([^)]*bot-runtime/.test(codeOnly), false);
  });
});
