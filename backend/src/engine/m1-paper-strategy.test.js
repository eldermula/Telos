'use strict';

/**
 * M1 PAPER-ONLY EXPERIMENT — pure-math coverage (docs/15_M1_Forex_Paper_Experiment.md).
 *
 * Stop-distance and clamp-skip fixtures below are taken directly from the
 * 2026-08-11 M1 probe report (real live connector data, M1 timeframe,
 * 1000 bars/instrument) — not re-derived or approximated here:
 *   Stop distance (1.5x ATR14, M1): EURUSD 0.00006612, GBPUSD 0.00008173,
 *   USDJPY 0.00667279, AUDUSD 0.00007936, USDCAD 0.00005385, XAUUSD 1.32788.
 *   Min viable balance (current bootstrap curve): EURUSD $0.34, GBPUSD
 *   $0.41, AUDUSD $0.40, USDCAD $0.27 (all viable at $5) — XAUUSD $6.64
 *   (SKIP at $5, OK at $10), USDJPY $21.32 (NOT viable at $5 or $10).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  computeAppliedRisk,
  resolveContractSize,
  isGoldFamilySymbol,
  evaluateM1Tick,
  evaluateM1Monitor,
} = require('./m1-paper-strategy');

const { computeSyntheticRawLotSize, clampLotSize } = require('./synthetic-lot-clamp');

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

const tierMatrixPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src', 'tierMatrix.js');
const { bootstrapRiskPct, TIER_MATRIX } = require(tierMatrixPath);

const M1_PROBE_FIXTURES = {
  EURUSD: { atr14: 0.00004407888194360689, stopDistance: 0.00006611832291541033, contractSize: 100000, minViableBalance: 0.34 },
  GBPUSD: { atr14: 0.00005448971573144887, stopDistance: 0.00008173457359717331, contractSize: 100000, minViableBalance: 0.41 },
  USDJPY: { atr14: 0.0044485257442623384, stopDistance: 0.006672788616393508, contractSize: 100000, minViableBalance: 21.32 },
  AUDUSD: { atr14: 0.00005290931370080406, stopDistance: 0.00007936397055120609, contractSize: 100000, minViableBalance: 0.4 },
  USDCAD: { atr14: 0.00003589941597767033, stopDistance: 0.000053849123966505496, contractSize: 100000, minViableBalance: 0.27 },
  XAUUSD: { atr14: 0.8852525197800026, stopDistance: 1.327878779670004, contractSize: 100, minViableBalance: 6.64 },
};

const FX_SYMBOL_INFO = { volume_min: 0.01, volume_step: 0.01, volume_max: 20 };
const XAU_SYMBOL_INFO = { volume_min: 0.01, volume_step: 0.01, volume_max: 10 };

function symbolInfoFor(symbol) {
  return symbol === 'XAUUSD' ? { ...XAU_SYMBOL_INFO } : { ...FX_SYMBOL_INFO };
}

describe('m1-paper-strategy: computeAppliedRisk (bootstrap curve reuse)', () => {
  it('matches bootstrapRiskPct below $50, same as the M1/M5/M15 probes', () => {
    assert.equal(computeAppliedRisk(10), 0.1);
    assert.equal(computeAppliedRisk(5), bootstrapRiskPct(5));
    assert.equal(computeAppliedRisk(30), bootstrapRiskPct(30));
    assert.equal(computeAppliedRisk(49.99), bootstrapRiskPct(49.99));
  });

  it('uses Tier 0 ceiling at/above $50', () => {
    assert.equal(computeAppliedRisk(50), TIER_MATRIX[0].maxRiskCeiling);
    assert.equal(computeAppliedRisk(500), TIER_MATRIX[0].maxRiskCeiling);
  });

  it('rejects non-positive balances', () => {
    assert.throws(() => computeAppliedRisk(0), RangeError);
    assert.throws(() => computeAppliedRisk(-5), RangeError);
  });
});

describe('m1-paper-strategy: resolveContractSize', () => {
  it('prefers a live trade_contract_size when present', () => {
    assert.equal(resolveContractSize('EURUSD', { trade_contract_size: 100000 }), 100000);
    assert.equal(resolveContractSize('XAUUSD', { trade_contract_size: 100 }), 100);
  });

  it('falls back gold-aware when trade_contract_size is missing/zero', () => {
    assert.equal(resolveContractSize('XAUUSD', {}), 100);
    assert.equal(resolveContractSize('xauusd', { trade_contract_size: 0 }), 100);
    assert.equal(resolveContractSize('EURUSD', {}), 100000);
  });

  it('isGoldFamilySymbol matches only XAU*', () => {
    assert.equal(isGoldFamilySymbol('XAUUSD'), true);
    assert.equal(isGoldFamilySymbol('XAGUSD'), false);
    assert.equal(isGoldFamilySymbol('EURUSD'), false);
  });
});

describe('m1-paper-strategy: M1 stop distances match the real probe numbers exactly', () => {
  for (const [symbol, fixture] of Object.entries(M1_PROBE_FIXTURES)) {
    it(`${symbol}: 1.5x ATR14(M1) reproduces the probe's stop distance`, () => {
      const { stopDistance } = computeStopTarget({
        entryPrice: 1,
        direction: 'BUY',
        currentATR: fixture.atr14,
        stopRule: { multiple: 1.5 },
        targetRule: { ratio: 2 },
      });
      assert.ok(
        Math.abs(stopDistance - fixture.stopDistance) < 1e-9,
        `${symbol}: expected ~${fixture.stopDistance}, got ${stopDistance}`
      );
    });
  }
});

describe('m1-paper-strategy: clamp-skip at $5/$10 matches the M1 probe', () => {
  const VIABLE_AT_5_AND_10 = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD'];

  for (const symbol of VIABLE_AT_5_AND_10) {
    it(`${symbol} clears volume_min at both $5 and $10 (per probe)`, () => {
      const fixture = M1_PROBE_FIXTURES[symbol];
      const symbolInfo = symbolInfoFor(symbol);
      for (const balance of [5, 10]) {
        const appliedRisk = computeAppliedRisk(balance);
        const raw = computeSyntheticRawLotSize({
          effectiveBalance: balance,
          appliedRisk,
          entryPrice: 1,
          stopPrice: 1 - fixture.stopDistance,
          contractSize: fixture.contractSize,
        });
        const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
        assert.equal(clamp.skipped, false, `${symbol} at $${balance} should NOT be skipped`);
      }
    });
  }

  it('XAUUSD clamp-skips at $5 but clears at $10 (per probe)', () => {
    const fixture = M1_PROBE_FIXTURES.XAUUSD;
    const symbolInfo = symbolInfoFor('XAUUSD');
    const entry = 4375;

    const at5 = clampLotSize(
      computeSyntheticRawLotSize({
        effectiveBalance: 5,
        appliedRisk: computeAppliedRisk(5),
        entryPrice: entry,
        stopPrice: entry - fixture.stopDistance,
        contractSize: fixture.contractSize,
      }).rawLotSize,
      symbolInfo
    );
    assert.equal(at5.skipped, true, 'XAUUSD at $5 should skip');

    const at10 = clampLotSize(
      computeSyntheticRawLotSize({
        effectiveBalance: 10,
        appliedRisk: computeAppliedRisk(10),
        entryPrice: entry,
        stopPrice: entry - fixture.stopDistance,
        contractSize: fixture.contractSize,
      }).rawLotSize,
      symbolInfo
    );
    assert.equal(at10.skipped, false, 'XAUUSD at $10 should NOT skip');
  });

  it('USDJPY correctly clamp-skips at both $5 and $10 (per probe)', () => {
    const fixture = M1_PROBE_FIXTURES.USDJPY;
    const symbolInfo = symbolInfoFor('USDJPY');
    for (const balance of [5, 10]) {
      const appliedRisk = computeAppliedRisk(balance);
      const raw = computeSyntheticRawLotSize({
        effectiveBalance: balance,
        appliedRisk,
        entryPrice: 159,
        stopPrice: 159 - fixture.stopDistance,
        contractSize: fixture.contractSize,
      });
      const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
      assert.equal(clamp.skipped, true, `USDJPY at $${balance} should be skipped`);
      assert.equal(clamp.reason, 'below_volume_min');
    }
  });

  it('a trivially small balance skips and the probe minimum itself opens', () => {
    const below = 0.05;
    for (const [symbol, fixture] of Object.entries(M1_PROBE_FIXTURES)) {
      const symbolInfo = symbolInfoFor(symbol);
      const entry = symbol === 'XAUUSD' ? 4375 : symbol === 'USDJPY' ? 159 : 1;

      const rawBelow = computeSyntheticRawLotSize({
        effectiveBalance: below,
        appliedRisk: computeAppliedRisk(below),
        entryPrice: entry,
        stopPrice: entry - fixture.stopDistance,
        contractSize: fixture.contractSize,
      });
      assert.equal(
        clampLotSize(rawBelow.rawLotSize, symbolInfo).skipped,
        true,
        `${symbol}: $${below} should skip`
      );

      const rawAt = computeSyntheticRawLotSize({
        effectiveBalance: fixture.minViableBalance,
        appliedRisk: computeAppliedRisk(fixture.minViableBalance),
        entryPrice: entry,
        stopPrice: entry - fixture.stopDistance,
        contractSize: fixture.contractSize,
      });
      assert.equal(
        clampLotSize(rawAt.rawLotSize, symbolInfo).skipped,
        false,
        `${symbol}: $${fixture.minViableBalance} (probe minimum) should NOT skip`
      );
    }
  });
});

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

const EMA_STRATEGY = {
  id: 'strategy-ema',
  name: 'MA Crossover',
  rule_set: {
    regime_fit: { trend_quality_min: 0.6 },
    signal: { type: 'ema_cross', fast_period: 12, slow_period: 26 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

describe('m1-paper-strategy: evaluateM1Tick end-to-end', () => {
  it('opens a paper trade when a strategy fires and balance clears volume_min', () => {
    const bars = genOversoldBars();
    const symbolInfo = { ...FX_SYMBOL_INFO, bid: 1.0976, ask: 1.0978, trade_contract_size: 100000 };

    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars, symbolInfo }],
      strategies: [RSI_STRATEGY],
      balance: 10,
    });

    assert.equal(result.outcome, 'opened');
    assert.equal(result.trade.symbol, 'EURUSD');
    assert.equal(result.trade.direction, 'BUY');
    assert.equal(result.trade.strategyName, 'RSI Mean Reversion');
    assert.equal(result.trade.entryPrice, 1.0978);
    assert.ok(result.trade.lotSize >= 0.01);
    assert.equal(result.trade.appliedRisk, 0.1);
  });

  it('reports skipped_below_volume_min instead of opening when balance is too small', () => {
    const bars = genOversoldBars();
    const symbolInfo = { ...FX_SYMBOL_INFO, bid: 1.0976, ask: 1.0978, trade_contract_size: 100000 };

    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars, symbolInfo }],
      strategies: [RSI_STRATEGY],
      balance: 0.5,
    });

    assert.equal(result.outcome, 'skipped_below_volume_min');
    assert.equal(result.reason, 'below_volume_min');
  });

  it('returns no_signal when no strategy fires (EMA gate closed on this fixture)', () => {
    const bars = genOversoldBars();
    const symbolInfo = { ...FX_SYMBOL_INFO, bid: 1.0976, ask: 1.0978, trade_contract_size: 100000 };

    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars, symbolInfo }],
      strategies: [EMA_STRATEGY],
      balance: 10,
    });

    assert.equal(result.outcome, 'no_signal');
  });

  it('returns no_signal (with dataErrors) when a symbol has insufficient bars', () => {
    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars: genOversoldBars({ n: 10 }), symbolInfo: FX_SYMBOL_INFO }],
      strategies: [RSI_STRATEGY],
      balance: 10,
    });

    assert.equal(result.outcome, 'no_signal');
    assert.equal(result.dataErrors.length, 1);
  });

  it('returns no_signal when there are no active strategies at all', () => {
    const bars = genOversoldBars();
    const symbolInfo = { ...FX_SYMBOL_INFO, bid: 1.0976, ask: 1.0978, trade_contract_size: 100000 };
    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars, symbolInfo }],
      strategies: [],
      balance: 10,
    });
    assert.equal(result.outcome, 'no_signal');
  });
});

describe('m1-paper-strategy: evaluateM1Monitor', () => {
  const openTrade = {
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.095,
    targetPrice: 1.11,
    lotSize: 0.02,
    contractSize: 100000,
  };

  it('returns null when neither stop nor target is hit', () => {
    assert.equal(evaluateM1Monitor(openTrade, { bid: 1.101, ask: 1.1012 }), null);
  });

  it('closes at target with positive pnl on a BUY', () => {
    const result = evaluateM1Monitor(openTrade, { bid: 1.111, ask: 1.1112 });
    assert.equal(result.outcome, 'target_hit');
    assert.equal(result.closePrice, 1.11);
    assert.ok(result.pnl > 0);
  });

  it('closes at stop with negative pnl on a BUY', () => {
    const result = evaluateM1Monitor(openTrade, { bid: 1.094, ask: 1.0942 });
    assert.equal(result.outcome, 'stop_hit');
    assert.equal(result.closePrice, 1.095);
    assert.ok(result.pnl < 0);
  });

  it('handles a SELL trade symmetrically', () => {
    const sellTrade = {
      symbol: 'EURUSD',
      direction: 'SELL',
      entryPrice: 1.1,
      stopPrice: 1.105,
      targetPrice: 1.09,
      lotSize: 0.02,
      contractSize: 100000,
    };
    const targetHit = evaluateM1Monitor(sellTrade, { bid: 1.0897, ask: 1.0899 });
    assert.equal(targetHit.outcome, 'target_hit');
    assert.ok(targetHit.pnl > 0);

    const stopHit = evaluateM1Monitor(sellTrade, { bid: 1.1049, ask: 1.1051 });
    assert.equal(stopHit.outcome, 'stop_hit');
    assert.ok(stopHit.pnl < 0);
  });

  it('returns null when the tick has no live price', () => {
    assert.equal(evaluateM1Monitor(openTrade, { bid: null, ask: null }), null);
  });
});

describe('m1-paper-strategy: structural isolation from real-dispatch', () => {
  it('does not import placeOrder, closeOrder, REAL_TRADING_ENABLED, or m5-real modules', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./m1-paper-strategy'), 'utf8');
    // Strip comments so documentation that names forbidden APIs does not trip the guard.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/require\([^)]*(placeOrder|closeOrder|REAL_TRADING_ENABLED|m5-real|bot-runtime|real-lot-sizing)/.test(codeOnly), false);
    assert.equal(/\bplaceOrder\s*\(/.test(codeOnly), false);
    assert.equal(/\bcloseOrder\s*\(/.test(codeOnly), false);
  });
});
