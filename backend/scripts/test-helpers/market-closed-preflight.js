/**
 * Shared FX market-closed preflight for live smokes.
 *
 * MetaQuotes demo often leaves trade_mode_full=true over the weekend with
 * Friday's bid/ask still populated — tick_time age is the reliable signal.
 */

const DEFAULT_MAX_TICK_AGE_SEC = 15 * 60;

/**
 * @param {object} symbolInfo - connector getSymbolInfo body
 * @param {{ maxTickAgeSec?: number }} [opts]
 * @returns {{ closed: boolean, reason: string }}
 */
function assessMarketClosed(symbolInfo, opts = {}) {
  const maxTickAgeSec =
    opts.maxTickAgeSec != null ? Number(opts.maxTickAgeSec) : DEFAULT_MAX_TICK_AGE_SEC;

  if (!symbolInfo || !symbolInfo.trade_mode_full) {
    return {
      closed: true,
      reason: `trade_mode_full=${symbolInfo && symbolInfo.trade_mode_full}`,
    };
  }
  const bid = Number(symbolInfo.bid);
  const ask = Number(symbolInfo.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    return { closed: true, reason: `no live bid/ask (bid=${symbolInfo.bid}, ask=${symbolInfo.ask})` };
  }
  if (symbolInfo.tick_time == null || symbolInfo.tick_time === '') {
    return { closed: true, reason: 'tick_time missing' };
  }
  const tickTime = Number(symbolInfo.tick_time);
  if (!Number.isFinite(tickTime)) {
    return { closed: true, reason: `tick_time not numeric (${symbolInfo.tick_time})` };
  }
  const ageSec = Math.floor(Date.now() / 1000) - tickTime;
  // Allow small clock skew into the future; anything older than the
  // threshold is treated as a closed session (weekend last-quote).
  if (ageSec > maxTickAgeSec || ageSec < -120) {
    return {
      closed: true,
      reason: `stale tick_time age_sec=${ageSec} max=${maxTickAgeSec}`,
    };
  }
  return { closed: false, reason: `tick_age_sec=${ageSec}` };
}

module.exports = {
  assessMarketClosed,
  DEFAULT_MAX_TICK_AGE_SEC,
};
