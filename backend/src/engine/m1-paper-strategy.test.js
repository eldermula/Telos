'use strict';

/**
 * M1 PAPER-ONLY EXPERIMENT — pure-math coverage (docs/15_M1_Forex_Paper_Experiment.md).
 *
 * ATR fixtures: original 2026-08-11 M1 probe (1000 bars/instrument).
 * Spread fixtures: live bid/ask samples from the 2026-08-11/12 spread probe
 * (8 samples/symbol) that motivated SPREAD_STOP_MULTIPLE = 2.0.
 *
 * New stop = max(1.5×ATR14, 2.0 × mean_live_spread). Min-viable balances
 * below are recomputed with that formula on the original probe ATRs + the
 * observed mean spreads (so the delta vs the old probe mins is attributable
 * to the spread floor, not a different ATR day).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  computeAppliedRisk,
  resolveContractSize,
  isGoldFamilySymbol,
  SPREAD_STOP_MULTIPLE,
  resolveM1StopDistance,
  evaluateM1Tick,
  evaluateM1Monitor,
} = require('./m1-paper-strategy');

const { computeSyntheticRawLotSize, clampLotSize } = require('./synthetic-lot-clamp');

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

const tierMatrixPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src', 'tierMatrix.js');
const { bootstrapRiskPct, TIER_MATRIX } = require(tierMatrixPath);

/** Original M1 probe ATR14 + ATR-only stop (pre spread floor). */
const M1_PROBE_ATR = {
  EURUSD: { atr14: 0.00004407888194360689, atrStop: 0.00006611832291541033, contractSize: 100000 },
  GBPUSD: { atr14: 0.00005448971573144887, atrStop: 0.00008173457359717331, contractSize: 100000 },
  USDJPY: { atr14: 0.0044485257442623384, atrStop: 0.006672788616393508, contractSize: 100000 },
  AUDUSD: { atr14: 0.00005290931370080406, atrStop: 0.00007936397055120609, contractSize: 100000 },
  USDCAD: { atr14: 0.00003589941597767033, atrStop: 0.000053849123966505496, contractSize: 100000 },
  XAUUSD: { atr14: 0.8852525197800026, atrStop: 1.327878779670004, contractSize: 100 },
};

/**
 * Live mean spreads (8 samples) from the spread probe that chose
 * SPREAD_STOP_MULTIPLE = 2.0. See docs/15.
 */
const LIVE_MEAN_SPREAD = {
  EURUSD: 0.00012875,
  GBPUSD: 0.00013625,
  USDJPY: 0.015,
  AUDUSD: 0.0001275,
  USDCAD: 0.00015,
  XAUUSD: 0.1825,
};

/** Old (ATR-only) min-viable from the original M1 probe. */
const OLD_MIN_VIABLE = {
  EURUSD: 0.34,
  GBPUSD: 0.41,
  USDJPY: 21.32,
  AUDUSD: 0.4,
  USDCAD: 0.27,
  XAUUSD: 6.64,
};

/**
 * Spread-aware stop + min-viable (probe ATR + observed mean spread).
 * Recomputed 2026-08-12 (ceiled to cents so clamp clears): EURUSD $1.29,
 * GBPUSD $1.37, USDJPY $50.01, AUDUSD $1.28, USDCAD $1.51, XAUUSD $6.64
 * (floor does not bind on gold — min unchanged vs ATR-only probe).
 */
const M1_SPREAD_AWARE = {
  EURUSD: { stopDistance: 0.0002575, minViableBalance: 1.29 },
  GBPUSD: { stopDistance: 0.0002725, minViableBalance: 1.37 },
  USDJPY: { stopDistance: 0.03, minViableBalance: 50.01 },
  AUDUSD: { stopDistance: 0.000255, minViableBalance: 1.28 },
  USDCAD: { stopDistance: 0.0003, minViableBalance: 1.51 },
  XAUUSD: { stopDistance: 1.327878779670004, minViableBalance: 6.64 },
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

describe('m1-paper-strategy: ATR baseline still matches the original probe', () => {
  for (const [symbol, fixture] of Object.entries(M1_PROBE_ATR)) {
    it(`${symbol}: 1.5x ATR14(M1) reproduces the probe's ATR stop`, () => {
      const { stopDistance } = computeStopTarget({
        entryPrice: 1,
        direction: 'BUY',
        currentATR: fixture.atr14,
        stopRule: { multiple: 1.5 },
        targetRule: { ratio: 2 },
      });
      assert.ok(
        Math.abs(stopDistance - fixture.atrStop) < 1e-9,
        `${symbol}: expected ~${fixture.atrStop}, got ${stopDistance}`
      );
    });
  }
});

describe('m1-paper-strategy: spread-aware stop floor (SPREAD_STOP_MULTIPLE=2.0)', () => {
  it('exports SPREAD_STOP_MULTIPLE = 2.0 (chosen from live M1 spreads)', () => {
    assert.equal(SPREAD_STOP_MULTIPLE, 2.0);
  });

  for (const [symbol, atrFix] of Object.entries(M1_PROBE_ATR)) {
    it(`${symbol}: stop = max(ATR stop, 2× mean spread) matches fixture`, () => {
      const spread = LIVE_MEAN_SPREAD[symbol];
      const expected = M1_SPREAD_AWARE[symbol].stopDistance;
      const resolved = resolveM1StopDistance({
        currentATR: atrFix.atr14,
        stopRule: { multiple: 1.5 },
        symbolInfo: { bid: 1, ask: 1 + spread },
      });
      assert.ok(
        Math.abs(resolved.stopDistance - expected) < 1e-9,
        `${symbol}: expected ${expected}, got ${resolved.stopDistance}`
      );
      const shouldFloor = expected > atrFix.atrStop + 1e-15;
      assert.equal(resolved.flooredBySpread, shouldFloor);
    });
  }

  it('USDCAD Session-A style: ATR stop inside spread is floored above the book', () => {
    // Session A stops ~0.000077–0.00008 vs live USDCAD spread ~0.00015
    const resolved = resolveM1StopDistance({
      currentATR: 0.000053849123966505496 / 1.5,
      stopRule: { multiple: 1.5 },
      symbolInfo: { bid: 1.39201, ask: 1.39216 },
    });
    const spread = 0.00015;
    assert.ok(resolved.atrStopDistance < spread, 'ATR stop was inside the spread');
    assert.equal(resolved.flooredBySpread, true);
    assert.ok(resolved.stopDistance >= SPREAD_STOP_MULTIPLE * spread - 1e-12);
    assert.ok(resolved.stopDistance > spread, 'floor must clear opposite side of book');
  });
});

describe('m1-paper-strategy: clamp-skip with spread-aware stops', () => {
  const VIABLE_AT_5_AND_10 = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD'];

  for (const symbol of VIABLE_AT_5_AND_10) {
    it(`${symbol} still clears volume_min at both $5 and $10 after spread floor`, () => {
      const stop = M1_SPREAD_AWARE[symbol].stopDistance;
      const contractSize = M1_PROBE_ATR[symbol].contractSize;
      const symbolInfo = symbolInfoFor(symbol);
      for (const balance of [5, 10]) {
        const appliedRisk = computeAppliedRisk(balance);
        const raw = computeSyntheticRawLotSize({
          effectiveBalance: balance,
          appliedRisk,
          entryPrice: 1,
          stopPrice: 1 - stop,
          contractSize,
        });
        const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
        assert.equal(clamp.skipped, false, `${symbol} at $${balance} should NOT be skipped`);
      }
    });
  }

  it('XAUUSD clamp-skips at $5 but clears at $10 (spread floor does not bind)', () => {
    const stop = M1_SPREAD_AWARE.XAUUSD.stopDistance;
    const symbolInfo = symbolInfoFor('XAUUSD');
    const entry = 4375;
    const contractSize = 100;

    const at5 = clampLotSize(
      computeSyntheticRawLotSize({
        effectiveBalance: 5,
        appliedRisk: computeAppliedRisk(5),
        entryPrice: entry,
        stopPrice: entry - stop,
        contractSize,
      }).rawLotSize,
      symbolInfo
    );
    assert.equal(at5.skipped, true, 'XAUUSD at $5 should skip');

    const at10 = clampLotSize(
      computeSyntheticRawLotSize({
        effectiveBalance: 10,
        appliedRisk: computeAppliedRisk(10),
        entryPrice: entry,
        stopPrice: entry - stop,
        contractSize,
      }).rawLotSize,
      symbolInfo
    );
    assert.equal(at10.skipped, false, 'XAUUSD at $10 should NOT skip');
  });

  it('USDJPY correctly clamp-skips at both $5 and $10 (wider after spread floor)', () => {
    const stop = M1_SPREAD_AWARE.USDJPY.stopDistance;
    const symbolInfo = symbolInfoFor('USDJPY');
    for (const balance of [5, 10]) {
      const appliedRisk = computeAppliedRisk(balance);
      const raw = computeSyntheticRawLotSize({
        effectiveBalance: balance,
        appliedRisk,
        entryPrice: 159,
        stopPrice: 159 - stop,
        contractSize: 100000,
      });
      const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
      assert.equal(clamp.skipped, true, `USDJPY at $${balance} should be skipped`);
      assert.equal(clamp.reason, 'below_volume_min');
    }
  });

  it('spread-aware min-viable opens; a trivially small balance skips', () => {
    const below = 0.05;
    for (const [symbol, aware] of Object.entries(M1_SPREAD_AWARE)) {
      const symbolInfo = symbolInfoFor(symbol);
      const entry = symbol === 'XAUUSD' ? 4375 : symbol === 'USDJPY' ? 159 : 1;
      const contractSize = M1_PROBE_ATR[symbol].contractSize;

      const rawBelow = computeSyntheticRawLotSize({
        effectiveBalance: below,
        appliedRisk: computeAppliedRisk(below),
        entryPrice: entry,
        stopPrice: entry - aware.stopDistance,
        contractSize,
      });
      assert.equal(
        clampLotSize(rawBelow.rawLotSize, symbolInfo).skipped,
        true,
        `${symbol}: $${below} should skip`
      );

      const rawAt = computeSyntheticRawLotSize({
        effectiveBalance: aware.minViableBalance,
        appliedRisk: computeAppliedRisk(aware.minViableBalance),
        entryPrice: entry,
        stopPrice: entry - aware.stopDistance,
        contractSize,
      });
      assert.equal(
        clampLotSize(rawAt.rawLotSize, symbolInfo).skipped,
        false,
        `${symbol}: $${aware.minViableBalance} (spread-aware minimum) should NOT skip`
      );

      // Document that FX mins rose vs the ATR-only probe; XAU unchanged.
      if (symbol !== 'XAUUSD') {
        assert.ok(
          aware.minViableBalance > OLD_MIN_VIABLE[symbol],
          `${symbol}: new min should exceed old ATR-only min $${OLD_MIN_VIABLE[symbol]}`
        );
      } else {
        assert.equal(aware.minViableBalance, OLD_MIN_VIABLE.XAUUSD);
      }
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
  it('opens a paper trade with spread-floored stop when ATR stop is inside the spread', () => {
    const bars = genOversoldBars();
    // Spread 0.0004 → floor 0.0008; fixture 1.5×ATR ≈ 0.00051 so floor binds.
    const bid = 1.0976;
    const ask = 1.098;
    const spread = ask - bid;
    const symbolInfo = { ...FX_SYMBOL_INFO, bid, ask, trade_contract_size: 100000 };

    const result = evaluateM1Tick({
      instruments: [{ symbol: 'EURUSD', bars, symbolInfo }],
      strategies: [RSI_STRATEGY],
      balance: 10,
    });

    assert.equal(result.outcome, 'opened');
    assert.equal(result.trade.symbol, 'EURUSD');
    assert.equal(result.trade.direction, 'BUY');
    assert.equal(result.trade.strategyName, 'RSI Mean Reversion');
    assert.equal(result.trade.entryPrice, ask);
    assert.equal(result.trade.flooredBySpread, true);
    assert.ok(
      Math.abs(result.trade.stopDistance - SPREAD_STOP_MULTIPLE * spread) < 1e-12,
      `expected floor stop ${SPREAD_STOP_MULTIPLE * spread}, got ${result.trade.stopDistance}`
    );
    // BUY stop below entry by stopDistance; target 2R above.
    assert.ok(Math.abs(result.trade.stopPrice - (ask - result.trade.stopDistance)) < 1e-12);
    assert.ok(Math.abs(result.trade.targetPrice - (ask + 2 * result.trade.stopDistance)) < 1e-12);
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
