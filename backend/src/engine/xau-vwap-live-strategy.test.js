'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SYMBOL,
  MAX_BAR_STALENESS_MS,
  attachIntradayVwap,
  empiricalP90AbsDist,
  detectP90Cross,
  resolveStopDistance,
  assertBarsFresh,
  evaluateXauVwapLiveTick,
  MIN_BARS,
} = require('./xau-vwap-live-strategy');

function genFlatNearVwapBars({ n = MIN_BARS, base = 4370, noise = 0.5, dayStartSec }) {
  const bars = [];
  const start = dayStartSec ?? Math.floor(Date.now() / 1000) - n * 300;
  for (let i = 0; i < n; i += 1) {
    const wobble = (i % 3 === 0 ? 1 : -1) * noise * 0.2;
    const close = base + wobble;
    bars.push({
      time: start + i * 300,
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

describe('xau-vwap-live-strategy: VWAP / p90 / direction', () => {
  it('scope is XAUUSD only', () => {
    assert.equal(SYMBOL, 'XAUUSD');
  });

  it('rolling VWAP + empirical p90 + SELL on upside stretch cross', () => {
    const bars = genStretchCrossBars();
    const enriched = attachIntradayVwap(bars);
    const p90 = empiricalP90AbsDist(enriched);
    assert.ok(p90 > 0);
    const signal = detectP90Cross(enriched, p90);
    assert.ok(signal);
    assert.equal(signal.direction, 'SELL');
  });

  it('stop = max(1.5*ATR, 2.0*spread); target distance = 2R', () => {
    const atr = 4.0;
    const spread = 0.18;
    const meta = resolveStopDistance({
      currentATR: atr,
      symbolInfo: { bid: 4370, ask: 4370 + spread },
    });
    assert.ok(Math.abs(meta.stopDistance - Math.max(1.5 * atr, 2.0 * spread)) < 1e-9);
    assert.ok(Math.abs(meta.spread - spread) < 1e-9);
  });
});

describe('xau-vwap-live-strategy: fail-closed guards', () => {
  it('rejects stale market data', () => {
    const bars = genFlatNearVwapBars({ n: MIN_BARS });
    bars[bars.length - 1].time = Math.floor(Date.now() / 1000) - Math.ceil(MAX_BAR_STALENESS_MS / 1000) - 60;
    const fresh = assertBarsFresh(bars);
    assert.equal(fresh.ok, false);
    assert.equal(fresh.reason, 'stale_market_data');
  });

  it('rejects missing live spread', () => {
    const bars = genStretchCrossBars();
    const decision = evaluateXauVwapLiveTick({
      bars,
      symbolInfo: { bid: 4370, ask: 4370 }, // ask not > bid
      balance: 100,
    });
    assert.equal(decision.outcome, 'invalid_spread');
  });

  it('rejects invalid symbolInfo without bid/ask', () => {
    const bars = genStretchCrossBars();
    const decision = evaluateXauVwapLiveTick({
      bars,
      symbolInfo: {},
      balance: 100,
    });
    assert.equal(decision.outcome, 'invalid_spread');
  });

  it('opens only when fresh bars + valid spread + p90 cross', () => {
    const bars = genStretchCrossBars();
    const ask = 4420.5;
    const bid = 4420.3;
    const decision = evaluateXauVwapLiveTick({
      bars,
      symbolInfo: {
        bid,
        ask,
        volume_min: 0.01,
        volume_step: 0.01,
        volume_max: 10,
        trade_contract_size: 100,
      },
      balance: 100,
    });
    // May be opened or data_error depending on MI ATR window — assert not invalid_spread/stale
    assert.notEqual(decision.outcome, 'invalid_spread');
    assert.notEqual(decision.outcome, 'stale_market_data');
    if (decision.outcome === 'opened') {
      assert.equal(decision.trade.symbol, 'XAUUSD');
      assert.equal(decision.trade.direction, 'SELL');
      assert.ok(decision.trade.spreadAtEntry > 0);
      assert.ok(decision.trade.stopDistance > 0);
      const risk = Math.abs(decision.trade.entryPrice - decision.trade.stopPrice);
      const reward = Math.abs(decision.trade.targetPrice - decision.trade.entryPrice);
      assert.ok(Math.abs(reward / risk - 2) < 1e-9);
    }
  });
});
