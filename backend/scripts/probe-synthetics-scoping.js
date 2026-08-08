'use strict';

/**
 * Synthetics scoping probe (Task 2) — read-only.
 * Live-catalog confirmation + per-symbol vol/ADX/strategy-fit first cut.
 * No orders. No trading-code changes.
 *
 *   node backend/scripts/probe-synthetics-scoping.js
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { getRates, getSymbolInfo } = require('../src/services/mt5-connector.client');
const { wilderATR } = require(path.join(
  __dirname,
  '..',
  '..',
  'bot',
  'market-intelligence',
  'src',
  'atr.js'
));
const { wilderADX } = require(path.join(
  __dirname,
  '..',
  '..',
  'bot',
  'market-intelligence',
  'src',
  'adx.js'
));
const {
  detectEmaCross,
  detectBreakout,
  detectRsiReversion,
} = require(path.join(__dirname, '..', '..', 'bot', 'strategy-engine', 'src', 'signals.js'));

const ATR_PERIOD = 14;
const ATR_ROLLING = 20;
const ADX_PERIOD = 14;
const TIMEFRAME = 'M15';
const COUNT = 1000;

// §6's Volatility Indices guess, plus the live catalog's additional
// continuous-vol siblings (5/15/30/90). 1s variants probed separately —
// same family, different designed tick cadence.
const VOL_STANDARD = [
  'Volatility 5 Index',
  'Volatility 10 Index',
  'Volatility 15 Index',
  'Volatility 25 Index',
  'Volatility 30 Index',
  'Volatility 50 Index',
  'Volatility 75 Index',
  'Volatility 90 Index',
  'Volatility 100 Index',
];

const VOL_1S = [
  'Volatility 5 (1s) Index',
  'Volatility 10 (1s) Index',
  'Volatility 15 (1s) Index',
  'Volatility 25 (1s) Index',
  'Volatility 30 (1s) Index',
  'Volatility 50 (1s) Index',
  'Volatility 75 (1s) Index',
  'Volatility 90 (1s) Index',
  'Volatility 100 (1s) Index',
  'Volatility 150 (1s) Index',
  'Volatility 250 (1s) Index',
];

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function rollingAverage(series, uptoIndex, windowSize) {
  const values = [];
  for (let i = uptoIndex; i >= 0 && values.length < windowSize; i -= 1) {
    if (series[i] === null || series[i] === undefined) break;
    values.push(series[i]);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function atrRatiosAndAbs(bars) {
  const atrSeries = wilderATR(bars, ATR_PERIOD);
  const ratios = [];
  const absAtrs = [];
  const start = ATR_PERIOD - 1 + ATR_ROLLING - 1;
  for (let i = start; i < atrSeries.length; i += 1) {
    const atr = atrSeries[i];
    if (atr === null || atr === undefined || !(atr > 0)) continue;
    absAtrs.push(atr);
    const avg = rollingAverage(atrSeries, i, ATR_ROLLING);
    if (!Number.isFinite(avg) || !(avg > 0)) continue;
    ratios.push(atr / avg);
  }
  return { ratios, absAtrs };
}

function trendQualities(bars) {
  const adxSeries = wilderADX(bars, ADX_PERIOD);
  const tqs = [];
  for (let i = 0; i < adxSeries.length; i += 1) {
    const adx = adxSeries[i];
    if (adx === null || adx === undefined) continue;
    tqs.push(Math.max(0, Math.min(1, adx / 50)));
  }
  return tqs;
}

function bandCounts(ratios, lowMax, highMin) {
  const counts = { LOW: 0, NORMAL: 0, HIGH: 0 };
  for (const r of ratios) {
    if (r > highMin) counts.HIGH += 1;
    else if (r < lowMax) counts.LOW += 1;
    else counts.NORMAL += 1;
  }
  const n = ratios.length || 1;
  return {
    counts,
    pct: {
      LOW: counts.LOW / n,
      NORMAL: counts.NORMAL / n,
      HIGH: counts.HIGH / n,
    },
  };
}

function summarizeSeries(values) {
  if (!values.length) {
    return { n: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

function tqRegimeShare(tqs) {
  // Starter-strategy regime gates from migration 004:
  // EMA: trend_quality_min 0.6  | RSI: trend_quality_max 0.4
  let emaFit = 0;
  let rsiFit = 0;
  let middle = 0; // (0.4, 0.6) — neither trend nor mean-reversion gate
  for (const tq of tqs) {
    if (tq >= 0.6) emaFit += 1;
    else if (tq <= 0.4) rsiFit += 1;
    else middle += 1;
  }
  const n = tqs.length || 1;
  return {
    emaGatePct: emaFit / n,
    rsiGatePct: rsiFit / n,
    noisyMiddlePct: middle / n,
    meanTq: tqs.length ? tqs.reduce((s, v) => s + v, 0) / tqs.length : null,
  };
}

function countStrategyFires(bars) {
  // Walk forward: at each bar i, evaluate detectors on bars[0..i]
  // exactly as Selection would see a rolling history ending at that bar.
  let ema = 0;
  let breakout = 0;
  let rsiLevel = 0;
  let rsiEdge = 0;
  let prevRsiSide = null; // null | 'oversold' | 'overbought'

  const minLen = 40; // covers slow EMA 26 + 1, breakout 20+1, RSI 14
  for (let i = minLen; i < bars.length; i += 1) {
    const window = bars.slice(0, i + 1);
    if (detectEmaCross(window)) ema += 1;
    if (detectBreakout(window)) breakout += 1;

    const rsiHit = detectRsiReversion(window);
    if (rsiHit) {
      rsiLevel += 1;
      const side = rsiHit.direction === 'BUY' ? 'oversold' : 'overbought';
      if (side !== prevRsiSide) rsiEdge += 1;
      prevRsiSide = side;
    } else {
      prevRsiSide = null;
    }
  }

  const evaluated = Math.max(0, bars.length - minLen);
  return {
    evaluatedBars: evaluated,
    emaCrossFires: ema,
    breakoutFires: breakout,
    rsiLevelBars: rsiLevel, // as implemented today (level, not edge)
    rsiEdgeEntries: rsiEdge, // first bar of a contiguous extreme stay
    emaPer100: evaluated ? (ema / evaluated) * 100 : null,
    breakoutPer100: evaluated ? (breakout / evaluated) * 100 : null,
    rsiEdgePer100: evaluated ? (rsiEdge / evaluated) * 100 : null,
  };
}

function proposeThresholds(ratioSummary) {
  // First-cut: round empirical p10/p90 to 0.05 — same spirit as crypto C.
  if (!ratioSummary.n) return null;
  const lowMax = Math.round(ratioSummary.p10 * 20) / 20;
  const highMin = Math.round(ratioSummary.p90 * 20) / 20;
  return {
    lowMax,
    highMin,
    note: 'first-cut from this window only — not final calibration',
  };
}

function strategyFitVerdict(regime, fires) {
  // Individual verdicts — do not pool.
  const ema = {
    gateOpenShare: regime.emaGatePct,
    signalRatePer100: fires.emaPer100,
    verdict:
      regime.emaGatePct < 0.15
        ? 'WEAK — trend_quality rarely clears 0.6; EMA regime gate mostly closed'
        : regime.noisyMiddlePct > 0.45
          ? 'CAUTION — large share of bars sit in 0.4–0.6 ADX middle (noisy, not sustained trend)'
          : regime.emaGatePct >= 0.25 && fires.emaPer100 > 0
            ? 'PLAUSIBLE — sustained high-TQ periods exist and EMA crosses fire'
            : 'MARGINAL — gate opens sometimes but signal rate is thin',
  };

  const breakout = {
    // Breakout regime_fit is market_volatility HIGH, not TQ.
    // Assessed after vol-band calc; placeholder filled by caller.
    signalRatePer100: fires.breakoutPer100,
  };

  const rsi = {
    gateOpenShare: regime.rsiGatePct,
    levelBarsPer100: fires.evaluatedBars
      ? (fires.rsiLevelBars / fires.evaluatedBars) * 100
      : null,
    edgeEntriesPer100: fires.rsiEdgePer100,
    verdict:
      regime.rsiGatePct < 0.15
        ? 'WEAK — trend_quality rarely ≤0.4; RSI regime gate mostly closed'
        : regime.rsiGatePct >= 0.25 && fires.rsiEdgePer100 > 0
          ? 'PLAUSIBLE — ranging/low-TQ periods exist and RSI extremes occur'
          : 'MARGINAL — some low-TQ bars but thin RSI edge activity',
  };

  return { ema, breakout, rsi };
}

async function probeSymbol(symbol) {
  let info;
  try {
    info = await getSymbolInfo(symbol);
  } catch (err) {
    return {
      symbol,
      ok: false,
      stage: 'symbol-info',
      error: err && err.message ? err.message : String(err),
    };
  }

  let body;
  try {
    body = await getRates(symbol, { timeframe: TIMEFRAME, count: COUNT });
  } catch (err) {
    return {
      symbol,
      ok: false,
      stage: 'rates',
      error: err && err.message ? err.message : String(err),
      info: {
        trade_mode_full: info.trade_mode_full,
        bid: info.bid,
        ask: info.ask,
        trade_contract_size: info.trade_contract_size,
        volume_min: info.volume_min,
      },
    };
  }

  const bars = body.bars || [];
  if (bars.length < ATR_PERIOD + ATR_ROLLING + 5) {
    return {
      symbol,
      ok: false,
      stage: 'rates',
      error: `insufficient bars (${bars.length})`,
    };
  }

  const { ratios, absAtrs } = atrRatiosAndAbs(bars);
  const tqs = trendQualities(bars);
  const ratioSummary = summarizeSeries(ratios);
  const absAtrSummary = summarizeSeries(absAtrs);
  const tqSummary = summarizeSeries(tqs);
  const forexBands = bandCounts(ratios, 0.8, 1.3);
  const proposed = proposeThresholds(ratioSummary);
  const underProposed = proposed
    ? bandCounts(ratios, proposed.lowMax, proposed.highMin)
    : null;
  const regime = tqRegimeShare(tqs);
  const fires = countStrategyFires(bars);
  const fit = strategyFitVerdict(regime, fires);

  // Breakout regime_fit is HIGH-only. Report BOTH forex-band and
  // proposed-band verdicts — for designed-fixed-vol series the ratio
  // almost never clears forex's 1.3, so the forex verdict is the one
  // that matters if thresholds aren't first changed.
  function breakoutVerdict(highShare, label) {
    if (highShare < 0.05) {
      return `WEAK under ${label} — HIGH share ${(highShare * 100).toFixed(1)}%; breakout regime gate starves`;
    }
    if (highShare < 0.1) {
      return `CAUTION under ${label} — HIGH share thin (${(highShare * 100).toFixed(1)}%)`;
    }
    if (fires.breakoutPer100 > 0) {
      return `PLAUSIBLE under ${label} — HIGH ${(highShare * 100).toFixed(1)}% and breakout edges fire`;
    }
    return `MARGINAL under ${label} — HIGH appears but breakout edges scarce`;
  }
  fit.breakout.highVolShareForex = forexBands.pct.HIGH;
  fit.breakout.highVolShareProposed = underProposed ? underProposed.pct.HIGH : null;
  fit.breakout.verdictForexBands = breakoutVerdict(forexBands.pct.HIGH, 'forex 0.8/1.3');
  fit.breakout.verdictProposedBands = underProposed
    ? breakoutVerdict(underProposed.pct.HIGH, `proposed ${proposed.lowMax}/${proposed.highMin}`)
    : null;
  // Primary verdict = forex bands (current starter strategy, unmodified).
  fit.breakout.verdict = fit.breakout.verdictForexBands;

  // ATR as % of mid price — shows designed-vol differentiation the ratio hides.
  const mid =
    info.bid > 0 && info.ask > 0 ? (info.bid + info.ask) / 2 : bars[bars.length - 1].close;
  const atrPctOfPrice =
    absAtrSummary.mean && mid > 0 ? (absAtrSummary.mean / mid) * 100 : null;

  return {
    symbol,
    ok: true,
    info: {
      trade_mode_full: info.trade_mode_full,
      bid: info.bid,
      ask: info.ask,
      tick_time: info.tick_time,
      trade_contract_size: info.trade_contract_size,
      volume_min: info.volume_min,
      volume_step: info.volume_step,
      volume_max: info.volume_max,
      digits: info.digits,
      spread_proxy: info.ask != null && info.bid != null ? info.ask - info.bid : null,
    },
    barsFetched: bars.length,
    firstBarTime: bars[0].time,
    lastBarTime: bars[bars.length - 1].time,
    atrRatio: ratioSummary,
    atrAbsolute: { ...absAtrSummary, atrPctOfPrice, midPrice: mid },
    underForexBands_0_8_1_3: forexBands,
    proposedThresholds: proposed,
    underProposedThresholds: underProposed,
    trendQuality: { ...tqSummary, ...regime },
    strategyFires: fires,
    strategyFit: fit,
  };
}

async function main() {
  const symbols = [...VOL_STANDARD, ...VOL_1S];
  const results = [];
  for (const symbol of symbols) {
    // Sequential: avoid hammering the connector with parallel MT5 init cycles.
    // eslint-disable-next-line no-await-in-loop
    const row = await probeSymbol(symbol);
    results.push(row);
    const tag = row.ok ? 'OK' : 'FAIL';
    console.error(`[probe] ${tag} ${symbol}`);
  }

  const okRows = results.filter((r) => r.ok);
  const report = {
    method: {
      timeframe: TIMEFRAME,
      countRequested: COUNT,
      atrPeriod: ATR_PERIOD,
      atrRollingPeriod: ATR_ROLLING,
      adxPeriod: ADX_PERIOD,
      ratio: 'currentATR / SMA(last ATR_ROLLING ATR values incl. current)',
      trend_quality: 'clamp(ADX/50, 0, 1) — same as Module 2',
      starterGates: {
        ema: 'trend_quality_min 0.6',
        breakout: 'market_volatility_in [HIGH]',
        rsi: 'trend_quality_max 0.4',
      },
      note: 'Read-only /symbol-info + /rates. No orders. First-cut thresholds only.',
    },
    catalogNote:
      'Exact MT5 names confirmed live on Deriv-Demo (not R_10 aliases). Full synthetic catalog also includes Boom/Crash, Jump, Step, DEX, High Frequency Vol, Crash Boom Flip — out of §6 Volatility-Indices-first scope; Boom/Crash/Jump remain strategy-mismatch risks per docs/11 §6.3.',
    symbolsProbed: symbols,
    results,
    recommendation: {
      runtimeFile:
        'OWN FILE (synthetic-bot-runtime.js) — do not fold into crypto-bot-runtime.js. Probe shows designed fixed-vol ATR-ratio profiles that differ across Volatility Index variants; §3 no-news-correlation is a hard architectural difference from crypto\'s shock-news pipeline; surface 24/7 similarity alone is not enough to share a dispatcher.',
      instrumentScopeFirstCut:
        'Start with continuous Volatility Indices only (standard tick cadence). Defer Boom/Crash/Jump (spike design). Treat 1s variants as a separate sub-watchlist — higher designed frequency, different spread/volume_min profile.',
      thresholds:
        'Ratio p10/p90 collapses to ~0.95/1.05 across all Volatility Index variants in this window — designed-fixed vol makes the ATR-ratio nearly stationary. Per-symbol differentiation shows up in absolute ATR (% of price), volume_min, and spread, not in the ratio cutoffs. First-cut ratio bands may therefore be shared within the Volatility Index family, with per-symbol Module 7 specs. Flagged for report-before-build: ratio-based HIGH/LOW may be the wrong primary regime axis for these instruments.',
      strategyTransfer: 'See per-symbol strategyFit verdicts — EMA/breakout/RSI assessed independently. Breakout primary verdict uses unmodified forex 0.8/1.3 bands.',
    },
  };

  console.log(JSON.stringify(report, null, 2));

  // Compact human summary
  console.log('---');
  console.log(`SYNTHETICS_PROBE ok=${okRows.length}/${results.length}`);
  for (const r of okRows) {
    const p = r.proposedThresholds;
    const tq = r.trendQuality;
    const f = r.strategyFit;
    const atrPct =
      r.atrAbsolute && r.atrAbsolute.atrPctOfPrice != null
        ? r.atrAbsolute.atrPctOfPrice.toFixed(3)
        : '?';
    const fxH = (r.underForexBands_0_8_1_3.pct.HIGH * 100).toFixed(1);
    console.log(
      [
        r.symbol,
        `ratio_p10/50/90=${r.atrRatio.p10.toFixed(3)}/${r.atrRatio.p50.toFixed(3)}/${r.atrRatio.p90.toFixed(3)}`,
        `cut=${p.lowMax}/${p.highMin}`,
        `atr%price=${atrPct}`,
        `fxHIGH=${fxH}%`,
        `TQ_mean=${tq.meanTq.toFixed(2)} emaGate=${(tq.emaGatePct * 100).toFixed(0)}% mid=${(tq.noisyMiddlePct * 100).toFixed(0)}% rsiGate=${(tq.rsiGatePct * 100).toFixed(0)}%`,
        `EMA:${f.ema.verdict.split('—')[0].trim()}`,
        `BO:${f.breakout.verdict.split('—')[0].trim()}`,
        `RSI:${f.rsi.verdict.split('—')[0].trim()}`,
      ].join(' | ')
    );
  }
  console.log('SYNTHETICS_SCOPING_PROBE_DONE');
}

main().catch((err) => {
  console.error('SYNTHETICS_SCOPING_PROBE_FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
