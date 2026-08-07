'use strict';

const path = require('path');
const { redis } = require('../db/redis');
const newsSources = require('../services/news-sources.client');
const { RateLimitedError } = newsSources;
const { classifyHeadlinesBatch } = require('../services/headline-classifier.client');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { aggregateNewsIntelligence } = require(path.join(newsIntelligencePath, 'aggregate.js'));
const { hashHeadline } = require(path.join(newsIntelligencePath, 'contentHash.js'));
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

/**
 * Module 3 — News & Sentiment Intelligence Worker
 * (08_Bot_Architecture.md Section 9.0/9.3). One combined computation
 * per cycle (not per instrument — Module 3 parses headlines/calendar
 * once, then `aggregateNewsIntelligence` fans the result out to every
 * watchlist instrument), cached as a single Redis entry.
 */

// Section 9.2's proposed slow-path cadence, same as Module 2.
const CACHE_TTL_SECONDS = Number(process.env.NEWS_INTELLIGENCE_CACHE_TTL_SECONDS) || 20;
const CACHE_KEY = 'news:intelligence';

// Section 9.3 — content-hash dedup so an already-seen headline doesn't
// trigger a repeat, billable LLM call on the next cycle. 24h is long
// enough to cover this bot's realistic re-poll window without keys
// accumulating forever.
const SEEN_HASH_TTL_SECONDS = Number(process.env.NEWS_SEEN_HASH_TTL_SECONDS) || 60 * 60 * 24;
function seenHashKey(hash) {
  return `news:seen-hash:${hash}`;
}

// Section 9.3 — per-source health tracker. Calendar and the RSS
// headline chain are tracked as two independent sources (a calendar
// outage shouldn't count against/degrade the RSS chain and vice
// versa); the two RSS feeds inside getHeadlines() are one "headlines"
// source for this purpose, matching how getHeadlines() already
// returns one combined result regardless of which underlying feed
// answered.
const HEALTH_FAILURE_THRESHOLD = Number(process.env.NEWS_HEALTH_FAILURE_THRESHOLD) || 5;
const HEALTH_COOLDOWN_SECONDS = Number(process.env.NEWS_HEALTH_COOLDOWN_SECONDS) || 5 * 60;
// Fallback if a 429 gave no usable Retry-After — matches news-sources
// .client.js's own default, kept in sync via the same env var.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = Number(process.env.NEWS_RATE_LIMIT_BACKOFF_MS) || 60000;

function healthKey(source) {
  return `news:health:${source}`;
}

const EMPTY_HEALTH_STATE = Object.freeze({ consecutiveFailures: 0, degradedUntil: null, rateLimitedUntil: null });

async function getHealthState(source) {
  const raw = await redis.get(healthKey(source)).catch(() => null);
  if (!raw) return { ...EMPTY_HEALTH_STATE };
  try {
    return { ...EMPTY_HEALTH_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_HEALTH_STATE };
  }
}

/**
 * A source is "skip for now" for two distinct reasons that must not
 * be conflated: `degradedUntil` (Section 9.3's original 5-consecutive
 * -hard-failures rule — "this source looks actually broken") and
 * `rateLimitedUntil` (a 429 — "this source is fine, we're just asking
 * too fast"). Either one being in the future is reason enough to skip
 * attempting the source this cycle; which one is why is what the two
 * separate fields are for.
 */
async function isDegraded(source) {
  const state = await getHealthState(source);
  const now = Date.now();
  return Boolean(
    (state.degradedUntil && now < state.degradedUntil) || (state.rateLimitedUntil && now < state.rateLimitedUntil)
  );
}

/**
 * `succeeded = true` clears both tracks entirely — a working request
 * means whatever backoff/degradation was in effect no longer applies.
 * `succeeded = false` branches on the *type* of failure:
 * - `RateLimitedError` -> sets `rateLimitedUntil` for exactly as long
 *   as the source asked (or the default backoff) and deliberately
 *   leaves `consecutiveFailures`/`degradedUntil` untouched. A string
 *   of 429s means the source is up and telling us to slow down, not
 *   that it's down — it shouldn't escalate toward the same 5-minute
 *   "assume it's broken" degradation a real failure does.
 * - anything else -> the original Section 9.3 behavior: increment
 *   `consecutiveFailures`, degrade for `HEALTH_COOLDOWN_SECONDS` once
 *   the threshold is hit.
 */
async function recordSourceOutcome(source, succeeded, err = null) {
  const key = healthKey(source);

  if (succeeded) {
    await redis.set(key, JSON.stringify(EMPTY_HEALTH_STATE), 'EX', HEALTH_COOLDOWN_SECONDS * 4).catch(() => {});
    return { ...EMPTY_HEALTH_STATE };
  }

  const state = await getHealthState(source);

  if (err instanceof RateLimitedError) {
    state.rateLimitedUntil = Date.now() + (err.retryAfterMs || DEFAULT_RATE_LIMIT_BACKOFF_MS);
  } else {
    state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
    if (state.consecutiveFailures >= HEALTH_FAILURE_THRESHOLD) {
      state.degradedUntil = Date.now() + HEALTH_COOLDOWN_SECONDS * 1000;
    }
  }

  await redis.set(key, JSON.stringify(state), 'EX', HEALTH_COOLDOWN_SECONDS * 4).catch(() => {});
  return state;
}

/**
 * Section 9.1's existing failure fallback: neutral `market_quality`,
 * zero `news_impact_score`, for every watchlist instrument.
 */
function fallbackResult(reason) {
  const perInstrument = {};
  for (const instrument of WATCHLIST) {
    perInstrument[instrument] = { market_quality: 0.5, news_impact_score: 0 };
  }
  return { ...perInstrument, stale: true, reason };
}

/**
 * Fetches calendar + headlines best-effort (confirmed: a single
 * source failing doesn't force the full Section 9.1 fallback if the
 * other succeeded — only a *total* outage does), dedupes new
 * headlines against Redis, classifies only the new ones (batched),
 * and aggregates everything into the per-instrument result.
 */
async function computeFreshNewsIntelligence() {
  let calendarEvents = null;
  if (!(await isDegraded('calendar'))) {
    try {
      calendarEvents = await newsSources.getEconomicCalendar();
      await recordSourceOutcome('calendar', true);
    } catch (err) {
      const kind = err instanceof RateLimitedError ? 'rate-limited' : 'failed';
      console.error(`[news-intelligence] calendar: ${kind} — ${err.message}`);
      await recordSourceOutcome('calendar', false, err);
    }
  }

  let headlineItems = null;
  if (!(await isDegraded('headlines'))) {
    try {
      const { items } = await newsSources.getHeadlines();
      headlineItems = items;
      await recordSourceOutcome('headlines', true);
    } catch (err) {
      const kind = err instanceof RateLimitedError ? 'rate-limited' : 'failed';
      console.error(`[news-intelligence] headlines: ${kind} — ${err.message}`);
      await recordSourceOutcome('headlines', false, err);
    }
  }

  if (calendarEvents === null && headlineItems === null) {
    throw new Error('both calendar and headlines sources unavailable this cycle');
  }

  let headlineClassifications = [];
  if (headlineItems) {
    const newItems = [];
    for (const item of headlineItems) {
      const hash = hashHeadline(item.title);
      const alreadySeen = await redis.get(seenHashKey(hash)).catch(() => null);
      if (!alreadySeen) newItems.push({ ...item, hash });
    }

    if (newItems.length > 0) {
      const classifications = await classifyHeadlinesBatch(newItems.map((item) => item.title));
      headlineClassifications = classifications;
      // Marked seen only after a successful classification — a crash
      // mid-cycle re-processes the same headline next time rather than
      // silently losing it.
      await Promise.all(
        newItems.map((item) => redis.set(seenHashKey(item.hash), '1', 'EX', SEEN_HASH_TTL_SECONDS).catch(() => {}))
      );
    }
  }

  const perInstrument = aggregateNewsIntelligence({
    calendarEvents: calendarEvents || [],
    headlineClassifications,
  });

  return {
    ...perInstrument,
    stale: false,
    sources: { calendar: calendarEvents !== null, headlines: headlineItems !== null },
    new_headline_count: headlineClassifications.length,
  };
}

async function getNewsIntelligence() {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through and recompute
    }
  }

  let payload;
  try {
    payload = await computeFreshNewsIntelligence();
  } catch (err) {
    console.error(`[news-intelligence] total outage this cycle: ${err.message}`);
    return fallbackResult(err.message);
  }

  await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((err) => {
    console.error(`[news-intelligence] cache write failed: ${err.message}`);
  });
  return payload;
}

module.exports = {
  getNewsIntelligence,
  computeFreshNewsIntelligence,
  isDegraded,
  getHealthState,
  recordSourceOutcome,
  CACHE_KEY,
  CACHE_TTL_SECONDS,
  HEALTH_FAILURE_THRESHOLD,
  HEALTH_COOLDOWN_SECONDS,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  healthKey,
  seenHashKey,
};
