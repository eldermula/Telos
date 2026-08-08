'use strict';

/**
 * Crypto Increment B — orchestration for the parallel crypto news
 * pipeline. Own Redis namespace (`crypto:news:*`). Wired into
 * crypto-strategy-selection / crypto-bot-runtime (Increment E paper).
 */

const path = require('path');
const { redis } = require('../db/redis');
const { getCryptoHeadlines, RateLimitedError } = require('../services/crypto-news-sources.client');
const { classifyCryptoHeadlinesBatch } = require('../services/crypto-headline-classifier.client');

const cryptoNewsPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'crypto-news-intelligence',
  'src'
);
const { aggregateCryptoNewsIntelligence } = require(path.join(cryptoNewsPath, 'aggregate.js'));
const { hashHeadline } = require(path.join(cryptoNewsPath, 'contentHash.js'));
const { CRYPTO_WATCHLIST } = require(path.join(cryptoNewsPath, 'watchlist.js'));

const CACHE_KEY = 'crypto:news:intelligence';
const CACHE_TTL_SECONDS = Number(process.env.CRYPTO_NEWS_INTELLIGENCE_CACHE_TTL_SECONDS) || 20;
const SEEN_HASH_TTL_SECONDS = Number(process.env.CRYPTO_NEWS_SEEN_HASH_TTL_SECONDS) || 86400;
const HEALTH_FAILURE_THRESHOLD = Number(process.env.CRYPTO_NEWS_HEALTH_FAILURE_THRESHOLD) || 5;
const HEALTH_COOLDOWN_SECONDS = Number(process.env.CRYPTO_NEWS_HEALTH_COOLDOWN_SECONDS) || 300;

function seenHashKey(hash) {
  return `crypto:news:seen-hash:${hash}`;
}

function healthKey(source) {
  return `crypto:news:health:${source}`;
}

function fallbackResult(reason) {
  const perInstrument = {};
  for (const instrument of CRYPTO_WATCHLIST) {
    perInstrument[instrument] = { market_quality: 0.5, news_impact_score: 0 };
  }
  return { ...perInstrument, stale: true, reason };
}

async function getHealthState(source) {
  const raw = await redis.get(healthKey(source)).catch(() => null);
  if (!raw) {
    return { consecutiveFailures: 0, degradedUntil: null, rateLimitedUntil: null };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { consecutiveFailures: 0, degradedUntil: null, rateLimitedUntil: null };
  }
}

async function isDegraded(source) {
  const state = await getHealthState(source);
  const now = Date.now();
  if (state.rateLimitedUntil && state.rateLimitedUntil > now) return true;
  if (state.degradedUntil && state.degradedUntil > now) return true;
  return false;
}

async function recordSourceOutcome(source, ok, err = null) {
  const state = await getHealthState(source);
  if (ok) {
    const cleared = { consecutiveFailures: 0, degradedUntil: null, rateLimitedUntil: null };
    await redis
      .set(healthKey(source), JSON.stringify(cleared), 'EX', HEALTH_COOLDOWN_SECONDS * 4)
      .catch(() => {});
    return;
  }
  if (err instanceof RateLimitedError) {
    const next = {
      consecutiveFailures: state.consecutiveFailures || 0,
      degradedUntil: null,
      rateLimitedUntil: Date.now() + (err.retryAfterMs || 60000),
    };
    await redis
      .set(healthKey(source), JSON.stringify(next), 'EX', HEALTH_COOLDOWN_SECONDS * 4)
      .catch(() => {});
    return;
  }
  const consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  const degradedUntil =
    consecutiveFailures >= HEALTH_FAILURE_THRESHOLD
      ? Date.now() + HEALTH_COOLDOWN_SECONDS * 1000
      : null;
  await redis
    .set(
      healthKey(source),
      JSON.stringify({ consecutiveFailures, degradedUntil, rateLimitedUntil: null }),
      'EX',
      HEALTH_COOLDOWN_SECONDS * 4
    )
    .catch(() => {});
}

async function computeFreshCryptoNewsIntelligence() {
  let headlineItems = null;
  if (!(await isDegraded('headlines'))) {
    try {
      const { items } = await getCryptoHeadlines();
      headlineItems = items;
      await recordSourceOutcome('headlines', true);
    } catch (err) {
      const kind = err instanceof RateLimitedError ? 'rate-limited' : 'failed';
      console.error(`[crypto-news-intelligence] headlines: ${kind} — ${err.message}`);
      await recordSourceOutcome('headlines', false, err);
    }
  }

  if (headlineItems === null) {
    throw new Error('crypto headlines source unavailable this cycle');
  }

  let headlineClassifications = [];
  const newItems = [];
  for (const item of headlineItems) {
    const hash = hashHeadline(item.title);
    const alreadySeen = await redis.get(seenHashKey(hash)).catch(() => null);
    if (!alreadySeen) newItems.push({ ...item, hash });
  }

  if (newItems.length > 0) {
    headlineClassifications = await classifyCryptoHeadlinesBatch(
      newItems.map((item) => item.title)
    );
    await Promise.all(
      newItems.map((item) =>
        redis.set(seenHashKey(item.hash), '1', 'EX', SEEN_HASH_TTL_SECONDS).catch(() => {})
      )
    );
  }

  const perInstrument = aggregateCryptoNewsIntelligence({ headlineClassifications });
  return {
    ...perInstrument,
    stale: false,
    sources: { headlines: true, calendar: false },
    new_headline_count: headlineClassifications.length,
    asset_class: 'crypto',
  };
}

async function getCryptoNewsIntelligence() {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* recompute */
    }
  }

  let payload;
  try {
    payload = await computeFreshCryptoNewsIntelligence();
  } catch (err) {
    console.error(`[crypto-news-intelligence] outage this cycle: ${err.message}`);
    return fallbackResult(err.message);
  }

  await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((err) => {
    console.error(`[crypto-news-intelligence] cache write failed: ${err.message}`);
  });
  return payload;
}

module.exports = {
  getCryptoNewsIntelligence,
  computeFreshCryptoNewsIntelligence,
  isDegraded,
  getHealthState,
  recordSourceOutcome,
  fallbackResult,
  CACHE_KEY,
  CACHE_TTL_SECONDS,
  SEEN_HASH_TTL_SECONDS,
  HEALTH_FAILURE_THRESHOLD,
  HEALTH_COOLDOWN_SECONDS,
  healthKey,
  CRYPTO_WATCHLIST,
};
