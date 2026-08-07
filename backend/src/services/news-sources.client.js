'use strict';

const path = require('path');
const { parseRssItems } = require('./rss-parser');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { normalizeCalendarFeed } = require(path.join(newsIntelligencePath, 'calendarMapping.js'));

/**
 * 08_Bot_Architecture.md Section 9.3 — free data sources for Module 3.
 * The calendar feed is Forex Factory's public (unofficial) JSON
 * endpoint, already accepted on record (CHANGELOG Phase 6 kickoff) as
 * an ordinary Module 3 failure surface, not a documented/versioned API.
 * RSS sources are in priority order — primary tried first, secondary
 * only on failure/timeout, per Section 9.3's fallback design (not a
 * merge of both every cycle).
 */
const CALENDAR_URL =
  process.env.NEWS_CALENDAR_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const RSS_SOURCES = [
  { name: 'forexlive', url: process.env.NEWS_RSS_PRIMARY_URL || 'https://www.forexlive.com/feed/news' },
  { name: 'fxstreet', url: process.env.NEWS_RSS_SECONDARY_URL || 'https://www.fxstreet.com/rss/news' },
];

const FETCH_TIMEOUT_MS = Number(process.env.NEWS_SOURCE_TIMEOUT_MS) || 5000;
const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; TelosBot/1.0; +https://telos.local)' };
// Observed live during 6.3's own testing: the calendar feed is
// Cloudflare-fronted with `cache-control: public, max-age=60` — a
// reasonable default backoff when a source doesn't send its own
// `Retry-After`.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = Number(process.env.NEWS_RATE_LIMIT_BACKOFF_MS) || 60000;

/**
 * A 429 means the source is up and answering, just telling us to slow
 * down — a materially different signal than a network error or a 5xx.
 * Kept as its own error type (rather than a generic Error) so the
 * caller's health tracker can back off without counting it toward
 * "this source looks actually broken."
 */
class RateLimitedError extends Error {
  constructor(message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: FETCH_HEADERS,
  });
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
    throw new RateLimitedError(`${url} responded 429 (rate-limited)`, { retryAfterMs });
  }
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return response.text();
}

async function getEconomicCalendar() {
  const text = await fetchText(CALENDAR_URL);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Calendar feed returned invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error('Calendar feed did not return an array');
  }
  return normalizeCalendarFeed(raw);
}

/**
 * Tries each RSS source in priority order; returns the first one that
 * succeeds. Throws only if every source fails — the caller (Section
 * 9.1's fallback / Section 9.3's health tracker) decides what to do
 * about a total outage, this function just tries what it's given.
 *
 * If *every* source failed with a 429, the aggregated error is itself
 * a `RateLimitedError` (using the shortest of the sources' requested
 * backoffs) so the caller can back off rather than treat "all six
 * sources are rate-limited right now" the same as "all sources are
 * actually down."  Mixed failures (some 429, some real errors) count
 * as a real failure — a genuine error alongside a 429 isn't a clean
 * "just slow down" signal.
 */
async function getHeadlines() {
  const errors = [];
  let allRateLimited = true;
  let shortestRetryAfterMs = null;

  for (const source of RSS_SOURCES) {
    try {
      const xml = await fetchText(source.url);
      const items = parseRssItems(xml);
      return { source: source.name, items };
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
      if (err instanceof RateLimitedError) {
        shortestRetryAfterMs =
          shortestRetryAfterMs === null ? err.retryAfterMs : Math.min(shortestRetryAfterMs, err.retryAfterMs);
      } else {
        allRateLimited = false;
      }
    }
  }

  const message = `All RSS sources failed — ${errors.join('; ')}`;
  if (allRateLimited && shortestRetryAfterMs !== null) {
    throw new RateLimitedError(message, { retryAfterMs: shortestRetryAfterMs });
  }
  throw new Error(message);
}

module.exports = { getEconomicCalendar, getHeadlines, RateLimitedError, CALENDAR_URL, RSS_SOURCES };
