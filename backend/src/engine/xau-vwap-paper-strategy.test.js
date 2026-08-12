'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  SYMBOL,
  SPREAD_STOP_MULTIPLE,
  ATR_STOP_MULTIPLE,
  attachIntradayVwap,
  empiricalP90AbsDist,
  detectP90Cross,
  resolveStopDistance,
  evaluateXauVwapTick,
  evaluateXauVwapMonitor,
  MIN_BARS,
} = require('./xau-vwap-paper-strategy');

function genFlatNearVwapBars({ n = MIN_BARS, base = 4370, noise = 0.5, dayStart = 1700000000 }) {
  const bars = [];
  for (let i = 0; i < n; i += 1) {
    const wobble = (i % 3 === 0 ? 1 : -1) * noise * 0.2;
    const close = base + wobble;
    bars.push({
      time: dayStart + i * 300,
      open: close - 0.1,
      high: close + 0.3,
      low: close - 0.3,
      close,
      tick_volume: 100,
    });
  }
  return bars;
}

function genStretchCrossBars() {
  const bars = genFlatNearVwapBars({ n: MIN_BARS - 1, base: 4370, noise: 0.3 });
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

describe('xau-vwap-paper-strategy: VWAP p90 detection', () => {
  it('empiricalP90AbsDist returns 90th percentile of |close-vwap|', () => {
    const bars = genStretchCrossBars();
    const enriched = attachIntradayVwap(bars);
    const p90 = empiricalP90AbsDist(enriched);
    assert.ok(p90 > 0);
    const absSorted = enriched.map((e) => e.absDist).filter((v) => v > 0).sort((a, b) => a - b);
    const idx = Math.ceil(absSorted.length * 0.9) - 1;
    assert.ok(Math.abs(p90 - absSorted[idx]) < 0.01);
  });

  it('detectP90Cross fires on same-day cross into p90 stretch', () => {
    const bars = genStretchCrossBars();
    const enriched = attachIntradayVwap(bars);
    const p90 = empiricalP90AbsDist(enriched);
    const signal = detectP90Cross(enriched, p90);
    assert.ok(signal);
    assert.equal(signal.direction, 'SELL');
  });
});

describe('xau-vwap-paper-strategy: spread-aware stop matches backtest formula', () => {
  it('stopDistance = max(1.5*ATR, 2.0*spread)', () => {
    const atr = 4.0;
    const spread = 0.18;
    const meta = resolveStopDistance({
      currentATR: atr,
      symbolInfo: { bid: 4370, ask: 4370 + spread },
    });
    assert.ok(Math.abs(meta.atrStopDistance - ATR_STOP_MULTIPLE * atr) < 1e-9);
    assert.ok(Math.abs(meta.spreadFloor - SPREAD_STOP_MULTIPLE * spread) < 1e-9);
    assert.ok(
      Math.abs(meta.stopDistance - Math.max(ATR_STOP_MULTIPLE * atr, SPREAD_STOP_MULTIPLE * spread)) < 1e-9
    );
    assert.equal(meta.flooredBySpread, false);
  });

  it('floors when 2*spread exceeds 1.5*ATR', () => {
    const atr = 0.05;
    const spread = 0.18;
    const meta = resolveStopDistance({
      currentATR: atr,
      symbolInfo: { bid: 4370, ask: 4370 + spread },
    });
    assert.ok(Math.abs(meta.stopDistance - SPREAD_STOP_MULTIPLE * spread) < 1e-9);
    assert.equal(meta.flooredBySpread, true);
  });
});

describe('xau-vwap-paper-strategy: evaluateXauVwapTick', () => {
  it('opens SELL toward VWAP on p90 stretch cross with sufficient balance', () => {
    const bars = genStretchCrossBars();
    const symbolInfo = {
      bid: bars[bars.length - 1].close - 0.05,
      ask: bars[bars.length - 1].close + 0.13,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 20,
      trade_contract_size: 100,
    };
    const result = evaluateXauVwapTick({ bars, symbolInfo, balance: 50 });
    assert.equal(result.outcome, 'opened');
    assert.equal(result.trade.symbol, SYMBOL);
    assert.equal(result.trade.direction, 'SELL');
    assert.ok(result.trade.stopDistance >= SPREAD_STOP_MULTIPLE * 0.13);
  });
});

describe('xau-vwap-paper-strategy: evaluateXauVwapMonitor', () => {
  it('closes on target hit', () => {
    const trade = {
      direction: 'SELL',
      entryPrice: 4420,
      stopPrice: 4430,
      targetPrice: 4400,
      lotSize: 0.01,
      contractSize: 100,
    };
    const result = evaluateXauVwapMonitor(trade, { bid: 4399, ask: 4400 });
    assert.equal(result.outcome, 'target_hit');
    assert.ok(result.pnl > 0);
  });
});

describe('xau-vwap-paper-strategy: structural isolation from real-dispatch', () => {
  it('does not import placeOrder, closeOrder, m5-real, or bot-runtime', () => {
    const codeOnly = fs
      .readFileSync(path.join(__dirname, 'xau-vwap-paper-strategy.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.equal(/\bplaceOrder\s*\(/.test(codeOnly), false);
    assert.equal(/\bcloseOrder\s*\(/.test(codeOnly), false);
    assert.equal(/require\([^)]*m5-real/.test(codeOnly), false);
    assert.equal(/require\([^)]*bot-runtime/.test(codeOnly), false);
    assert.equal(/REAL_TRADING_ENABLED/.test(codeOnly), false);
  });
});
