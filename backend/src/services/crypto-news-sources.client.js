'use strict';

const { parseRssItems } = require('./rss-parser');
const { RateLimitedError } = require('./news-sources.client');

/**
 * Crypto Increment B — RSS sources only. No Forex Factory calendar
 * (docs/11 §3: zero reuse of the calendar feed).
 *
 * Primary/secondary chosen as free public crypto RSS outlets with
 * historically stable XML. Override via env without code changes.
 */
const CRYPTO_RSS_SOURCES = [
  {
    name: 'cointelegraph',
    url: process.env.CRYPTO_NEWS_RSS_PRIMARY_URL || 'https://cointelegraph.com/rss',
  },
  {
    name: 'coindesk',
    url:
      process.env.CRYPTO_NEWS_RSS_SECONDARY_URL ||
      'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml',
  },
];

const FETCH_TIMEOUT_MS = Number(process.env.CRYPTO_NEWS_SOURCE_TIMEOUT_MS) || 15000;
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TelosBot/1.0; +https://telos.local)',
};
const DEFAULT_RATE_LIMIT_BACKOFF_MS =
  Number(process.env.CRYPTO_NEWS_RATE_LIMIT_BACKOFF_MS) || 60000;

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : DEFAULT_RATE_LIMIT_BACKOFF_MS;
      throw new RateLimitedError(`HTTP 429 from ${url}`, {
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : DEFAULT_RATE_LIMIT_BACKOFF_MS,
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getCryptoHeadlines() {
  const errors = [];
  let allRateLimited = true;
  let shortestRetryAfterMs = null;

  for (const source of CRYPTO_RSS_SOURCES) {
    try {
      const xml = await fetchText(source.url);
      const items = parseRssItems(xml);
      return { source: source.name, items };
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
      if (err instanceof RateLimitedError) {
        shortestRetryAfterMs =
          shortestRetryAfterMs === null
            ? err.retryAfterMs
            : Math.min(shortestRetryAfterMs, err.retryAfterMs);
      } else {
        allRateLimited = false;
      }
    }
  }

  const message = `All crypto RSS sources failed — ${errors.join('; ')}`;
  if (allRateLimited && shortestRetryAfterMs !== null) {
    throw new RateLimitedError(message, { retryAfterMs: shortestRetryAfterMs });
  }
  throw new Error(message);
}

module.exports = { getCryptoHeadlines, CRYPTO_RSS_SOURCES, RateLimitedError };
