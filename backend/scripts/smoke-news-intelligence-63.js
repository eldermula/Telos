/**
 * Increment 6.3 smoke, step 2 — Module 3 (News & Sentiment
 * Intelligence Worker), wired end-to-end: live calendar + RSS ->
 * content-hash dedup -> DRY_RUN stub classification -> rule-based
 * fan-out/aggregation -> Redis cache, plus Section 9.1's fallback and
 * Section 9.3's per-source health tracker.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { connectRedis, redis } = require('../src/db/redis');
const { WATCHLIST } = require(path.join(__dirname, '..', '..', 'bot', 'news-intelligence', 'src', 'watchlist.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertWellFormedResult(result, label) {
  for (const instrument of WATCHLIST) {
    const entry = result[instrument];
    assert(entry, `${label}: missing ${instrument}`);
    assert(
      typeof entry.market_quality === 'number' && entry.market_quality >= 0 && entry.market_quality <= 1,
      `${label}: ${instrument} market_quality out of range: ${entry.market_quality}`
    );
    assert(
      typeof entry.news_impact_score === 'number' && entry.news_impact_score >= 0 && entry.news_impact_score <= 1,
      `${label}: ${instrument} news_impact_score out of range: ${entry.news_impact_score}`
    );
  }
}

async function main() {
  await connectRedis();
  const newsIntelligence = require('../src/engine/news-intelligence.service');

  // Clean slate so results below are deterministic — including every
  // seen-hash key from a previous run, otherwise today's headlines
  // (still the same top stories within the RSS feed's refresh window)
  // would already be marked seen and dedup would mask the real check.
  await redis.del(newsIntelligence.CACHE_KEY);
  await redis.del(newsIntelligence.healthKey('calendar'));
  await redis.del(newsIntelligence.healthKey('headlines'));
  const seenHashKeys = await redis.keys('news:seen-hash:*');
  if (seenHashKeys.length > 0) await redis.del(...seenHashKeys);

  // 1. Fresh compute — real calendar + RSS, real (stub) classification.
  const first = await newsIntelligence.computeFreshNewsIntelligence();
  console.log('first_pass', {
    sources: first.sources,
    new_headline_count: first.new_headline_count,
    EURUSD: first.EURUSD,
    XAUUSD: first.XAUUSD,
  });
  assertWellFormedResult(first, 'first_pass');
  assert(first.stale === false, 'expected a fresh (non-fallback) result');
  // Best-effort, confirmed: don't hard-require *both* sources to succeed
  // here — Forex Factory's free calendar endpoint is observed to rate-limit
  // under repeated close-together requests (this session's own testing
  // triggered a real 429; see CHANGELOG), which is exactly the scenario
  // the best-effort design exists to tolerate. Require at least one.
  assert(first.sources.calendar || first.sources.headlines, 'expected at least one source to succeed');
  if (!first.sources.calendar) console.log('NOTE: calendar source failed this run (likely rate-limited) — best-effort path exercised for real');
  assert(first.new_headline_count > 0, 'expected at least one newly-classified headline on a clean slate');

  // 2. Dedup — same headlines, run again immediately: most/all should
  // already be marked seen, so new_headline_count should drop sharply.
  const second = await newsIntelligence.computeFreshNewsIntelligence();
  console.log('second_pass new_headline_count', second.new_headline_count, '(first was', first.new_headline_count, ')');
  assert(
    second.new_headline_count <= first.new_headline_count,
    `expected dedup to reduce or hold new_headline_count, got ${second.new_headline_count} > ${first.new_headline_count}`
  );

  // 3. Cache — getNewsIntelligence() populates Redis with the documented TTL.
  await redis.del(newsIntelligence.CACHE_KEY);
  const cachedResult = await newsIntelligence.getNewsIntelligence();
  assertWellFormedResult(cachedResult, 'cached_result');
  const ttl = await redis.ttl(newsIntelligence.CACHE_KEY);
  console.log('cache_ttl_seconds', ttl);
  assert(ttl > 0 && ttl <= newsIntelligence.CACHE_TTL_SECONDS, `unexpected TTL: ${ttl}`);
  const secondRead = await newsIntelligence.getNewsIntelligence();
  assert(JSON.stringify(secondRead) === JSON.stringify(cachedResult), 'second read should be an identical cache hit');

  // 4. Health tracker — 5 consecutive recorded HARD failures degrade a
  // source; a 6th failure keeps it degraded rather than re-arming.
  await redis.del(newsIntelligence.healthKey('calendar'));
  for (let i = 0; i < newsIntelligence.HEALTH_FAILURE_THRESHOLD; i += 1) {
    await newsIntelligence.recordSourceOutcome('calendar', false, new Error('simulated hard failure'));
  }
  const degradedAfterThreshold = await newsIntelligence.isDegraded('calendar');
  const stateAfterThreshold = await newsIntelligence.getHealthState('calendar');
  console.log('degraded_after_threshold_failures', degradedAfterThreshold, stateAfterThreshold);
  assert(degradedAfterThreshold === true, 'expected calendar to be marked degraded after the failure threshold');
  assert(stateAfterThreshold.consecutiveFailures === newsIntelligence.HEALTH_FAILURE_THRESHOLD, 'expected consecutiveFailures to match the threshold exactly');
  assert(stateAfterThreshold.rateLimitedUntil === null, 'hard failures must not set rateLimitedUntil');

  await newsIntelligence.recordSourceOutcome('calendar', true);
  const degradedAfterSuccess = await newsIntelligence.isDegraded('calendar');
  assert(degradedAfterSuccess === false, 'expected a success to immediately clear the degraded state');

  // 4b. Health tracker — a 429 (RateLimitedError) must back off WITHOUT
  // touching consecutiveFailures/degradedUntil — a different signal
  // than a real failure, confirmed distinct per this increment's fix.
  await redis.del(newsIntelligence.healthKey('calendar'));
  const { RateLimitedError } = require('../src/services/news-sources.client');
  await newsIntelligence.recordSourceOutcome('calendar', false, new RateLimitedError('simulated 429', { retryAfterMs: 5000 }));
  const stateAfterRateLimit = await newsIntelligence.getHealthState('calendar');
  console.log('state_after_rate_limit', stateAfterRateLimit);
  assert(stateAfterRateLimit.consecutiveFailures === 0, 'a rate-limit must not increment consecutiveFailures');
  assert(stateAfterRateLimit.degradedUntil === null, 'a rate-limit must not set degradedUntil');
  assert(stateAfterRateLimit.rateLimitedUntil > Date.now(), 'expected rateLimitedUntil to be set in the future');
  assert(await newsIntelligence.isDegraded('calendar'), 'expected isDegraded to skip a rate-limited source too');

  // Mixing in real failures afterward must still escalate normally —
  // the rate-limit backoff doesn't mask/absorb real failures.
  for (let i = 0; i < newsIntelligence.HEALTH_FAILURE_THRESHOLD; i += 1) {
    await newsIntelligence.recordSourceOutcome('calendar', false, new Error('simulated hard failure after rate limit'));
  }
  const stateAfterMixed = await newsIntelligence.getHealthState('calendar');
  console.log('state_after_mixed', stateAfterMixed);
  assert(stateAfterMixed.consecutiveFailures === newsIntelligence.HEALTH_FAILURE_THRESHOLD, 'hard failures after a rate-limit must still count normally');
  assert(stateAfterMixed.degradedUntil > Date.now(), 'expected degradedUntil to be set once the hard-failure threshold is hit');

  await redis.del(newsIntelligence.healthKey('calendar'));

  // 5. Total-outage fallback — force both sources to fail (bad URLs,
  // module cache busted so the env override takes effect) and confirm
  // Section 9.1's neutral fallback is returned and NOT cached.
  process.env.NEWS_CALENDAR_URL = 'https://127.0.0.1:9/no-calendar';
  process.env.NEWS_RSS_PRIMARY_URL = 'https://127.0.0.1:9/no-rss-1';
  process.env.NEWS_RSS_SECONDARY_URL = 'https://127.0.0.1:9/no-rss-2';
  process.env.NEWS_SOURCE_TIMEOUT_MS = '2000';
  for (const modPath of [
    '../src/services/news-sources.client',
    '../src/services/rss-parser',
    '../src/engine/news-intelligence.service',
  ]) {
    delete require.cache[require.resolve(modPath)];
  }
  const brokenNewsIntelligence = require('../src/engine/news-intelligence.service');
  await redis.del(brokenNewsIntelligence.healthKey('calendar'));
  await redis.del(brokenNewsIntelligence.healthKey('headlines'));
  await redis.del(brokenNewsIntelligence.CACHE_KEY);

  const fallback = await brokenNewsIntelligence.getNewsIntelligence();
  console.log('fallback', { stale: fallback.stale, reason: fallback.reason, EURUSD: fallback.EURUSD });
  assert(fallback.stale === true, 'expected fallback result to be marked stale');
  for (const instrument of WATCHLIST) {
    assert(fallback[instrument].market_quality === 0.5, `expected neutral market_quality for ${instrument}`);
    assert(fallback[instrument].news_impact_score === 0, `expected neutral news_impact_score for ${instrument}`);
  }
  const fallbackCached = await redis.get(brokenNewsIntelligence.CACHE_KEY);
  assert(fallbackCached === null, 'fallback result must not be written to the cache');

  await redis.del(newsIntelligence.CACHE_KEY);
  await redis.del(newsIntelligence.healthKey('calendar'));
  await redis.del(newsIntelligence.healthKey('headlines'));
  redis.disconnect();

  console.log('NEWS_INTELLIGENCE_63_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
