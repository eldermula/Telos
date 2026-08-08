'use strict';

/**
 * Daily drawdown for the micro circuit breaker (08_Bot_Architecture §7).
 *
 * Day boundary: UTC calendar day.
 * Baseline: peak-of-day equity within that day.
 * Persistence: bot_instances.daily_drawdown_day / daily_start_equity /
 * daily_peak_equity (updated by BotRuntime; this module stays pure).
 */

/**
 * @param {Date|string|number} [now]
 * @returns {string} YYYY-MM-DD in UTC
 */
function utcDayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`utcDayKey: invalid date ${now}`);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ currentEquity: number, dayPeakEquity: number }} args
 * @returns {number} in [0, +∞) — typically [0, 1] for normal accounts
 */
function computeDailyDrawdownPct({ currentEquity, dayPeakEquity }) {
  if (!Number.isFinite(currentEquity)) {
    throw new RangeError(`currentEquity must be finite, got ${currentEquity}`);
  }
  if (!Number.isFinite(dayPeakEquity) || dayPeakEquity <= 0) {
    return 0;
  }
  return Math.max(0, (dayPeakEquity - currentEquity) / dayPeakEquity);
}

/**
 * @typedef {{ day: string|null, startEquity: number|null, peakEquity: number|null }} DailyDrawdownMarkers
 */

/**
 * Rollover / peak-update for a known current equity reading.
 *
 * @param {{
 *   now?: Date|string|number,
 *   currentEquity: number,
 *   markers: DailyDrawdownMarkers|null|undefined,
 *   dayKeyFn?: (now: Date|string|number) => string,
 * }} args
 * @returns {{ markers: DailyDrawdownMarkers, dailyDrawdownPct: number, rolledOver: boolean }}
 */
function nextDailyDrawdownMarkers({
  now = new Date(),
  currentEquity,
  markers,
  dayKeyFn = utcDayKey,
}) {
  if (!Number.isFinite(currentEquity) || currentEquity < 0) {
    throw new RangeError(`currentEquity must be a non-negative finite number, got ${currentEquity}`);
  }

  const day = dayKeyFn(now);
  const prev = markers || { day: null, startEquity: null, peakEquity: null };
  const needsRollover =
    prev.day == null ||
    prev.startEquity == null ||
    prev.peakEquity == null ||
    prev.day !== day;

  if (needsRollover) {
    const next = {
      day,
      startEquity: currentEquity,
      peakEquity: currentEquity,
    };
    return {
      markers: next,
      dailyDrawdownPct: computeDailyDrawdownPct({
        currentEquity,
        dayPeakEquity: next.peakEquity,
      }),
      rolledOver: true,
    };
  }

  const peakEquity = Math.max(Number(prev.peakEquity), currentEquity);
  const next = {
    day: prev.day,
    startEquity: Number(prev.startEquity),
    peakEquity,
  };
  return {
    markers: next,
    dailyDrawdownPct: computeDailyDrawdownPct({
      currentEquity,
      dayPeakEquity: next.peakEquity,
    }),
    rolledOver: false,
  };
}

/**
 * Mirror APIRS Peak Reset Vector for daily markers when profit-lock
 * subtracts lockedProfitAmount from balance and lifetime peak.
 * Without this, a good-day lock looks like a same-day crash.
 *
 * @param {{
 *   markers: DailyDrawdownMarkers|null|undefined,
 *   lockedProfitAmount: number,
 *   currentEquity: number,
 * }} args
 * @returns {DailyDrawdownMarkers|null}
 */
function shrinkDailyDrawdownMarkersForProfitLock({
  markers,
  lockedProfitAmount,
  currentEquity,
}) {
  if (!markers || markers.day == null) {
    return markers || null;
  }
  if (!Number.isFinite(lockedProfitAmount) || lockedProfitAmount <= 0) {
    return markers;
  }
  if (!Number.isFinite(currentEquity)) {
    throw new RangeError(`currentEquity must be finite, got ${currentEquity}`);
  }

  const shrink = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return value;
    return Math.max(currentEquity, Number(value) - lockedProfitAmount);
  };

  return {
    day: markers.day,
    startEquity: shrink(markers.startEquity),
    peakEquity: shrink(markers.peakEquity),
  };
}

module.exports = {
  utcDayKey,
  computeDailyDrawdownPct,
  nextDailyDrawdownMarkers,
  shrinkDailyDrawdownMarkersForProfitLock,
};
