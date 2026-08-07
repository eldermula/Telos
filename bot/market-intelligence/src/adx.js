'use strict';

/**
 * Wilder's ADX (08_Bot_Architecture.md Section 9.0, Module 2's
 * trend_quality input). `bars` must be in chronological order (oldest
 * first). Returns an array the same length as `bars`; entries are
 * `null` until enough history exists — the DM/TR smoothing needs
 * `period` bars, and the ADX average-of-DX needs another `period` on
 * top of that (~2 * period bars total before the first real value).
 */
function wilderADX(bars, period = 14) {
  const n = Array.isArray(bars) ? bars.length : 0;
  if (n < period + 1) return bars ? bars.map(() => null) : [];

  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);

  for (let i = 1; i < n; i += 1) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }

  const smoothedPlusDM = new Array(n).fill(null);
  const smoothedMinusDM = new Array(n).fill(null);
  const smoothedTR = new Array(n).fill(null);

  let sumPlusDM = 0;
  let sumMinusDM = 0;
  let sumTR = 0;
  for (let i = 1; i <= period; i += 1) {
    sumPlusDM += plusDM[i];
    sumMinusDM += minusDM[i];
    sumTR += tr[i];
  }
  smoothedPlusDM[period] = sumPlusDM;
  smoothedMinusDM[period] = sumMinusDM;
  smoothedTR[period] = sumTR;

  for (let i = period + 1; i < n; i += 1) {
    smoothedPlusDM[i] = smoothedPlusDM[i - 1] - smoothedPlusDM[i - 1] / period + plusDM[i];
    smoothedMinusDM[i] = smoothedMinusDM[i - 1] - smoothedMinusDM[i - 1] / period + minusDM[i];
    smoothedTR[i] = smoothedTR[i - 1] - smoothedTR[i - 1] / period + tr[i];
  }

  const dx = new Array(n).fill(null);
  for (let i = period; i < n; i += 1) {
    const sTR = smoothedTR[i];
    if (!sTR) {
      dx[i] = 0;
      continue;
    }
    const plusDI = (100 * smoothedPlusDM[i]) / sTR;
    const minusDI = (100 * smoothedMinusDM[i]) / sTR;
    const diSum = plusDI + minusDI;
    dx[i] = diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum;
  }

  const adx = new Array(n).fill(null);
  const adxStart = period * 2; // first index with a full period of DX values behind it
  if (n >= adxStart) {
    let sumDX = 0;
    for (let i = period; i < adxStart; i += 1) {
      sumDX += dx[i];
    }
    adx[adxStart - 1] = sumDX / period;
    for (let i = adxStart; i < n; i += 1) {
      adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
    }
  }

  return adx;
}

module.exports = { wilderADX };
