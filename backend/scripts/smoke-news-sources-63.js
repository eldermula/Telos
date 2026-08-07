/**
 * Increment 6.3 smoke, step 1 — Module 3's data-source connector layer
 * only (08_Bot_Architecture.md Section 9.3), tested independently
 * before any LLM parsing/scoring/caching is wired on top: the
 * Forex Factory calendar feed and the two-source RSS fallback chain,
 * both against live sources.
 */
const newsSources = require('../src/services/news-sources.client');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  // 1. Economic calendar — structured, no LLM needed.
  const events = await newsSources.getEconomicCalendar();
  console.log('calendar_event_count', events.length);
  assert(Array.isArray(events) && events.length > 0, 'expected at least one calendar event');
  for (const event of events) {
    assert(typeof event.title === 'string', 'event missing title');
    assert(['LOW', 'MEDIUM', 'HIGH'].includes(event.impact), `bad impact: ${event.impact}`);
    assert(Array.isArray(event.instruments), 'event.instruments must be an array');
  }
  const highImpactUsd = events.find((e) => e.currency === 'USD' && e.impact === 'HIGH');
  console.log('sample_high_impact_usd_event', highImpactUsd);
  if (highImpactUsd) {
    assert(
      highImpactUsd.instruments.includes('XAUUSD'),
      'expected a USD event to resolve to XAUUSD (USD-denominated) among its instruments'
    );
  }

  // 2. Headlines — RSS fallback chain, real network.
  const { source, items } = await newsSources.getHeadlines();
  console.log('headline_source', source, 'headline_count', items.length);
  assert(['forexlive', 'fxstreet'].includes(source), `unexpected source: ${source}`);
  assert(items.length > 0, 'expected at least one headline');
  for (const item of items.slice(0, 5)) {
    console.log(' -', item.title);
    assert(item.title.length > 0, 'headline missing title');
    assert(typeof item.guid === 'string' && item.guid.length > 0, 'headline missing guid');
  }

  // 3. Fallback chain — force both RSS sources to fail and confirm the
  // aggregated error surfaces cleanly rather than hanging or crashing
  // with something unhelpful. Re-requires the module with bad URLs
  // (env is read at module-load time), isolated from the checks above.
  process.env.NEWS_RSS_PRIMARY_URL = 'https://127.0.0.1:9/does-not-exist';
  process.env.NEWS_RSS_SECONDARY_URL = 'https://127.0.0.1:9/does-not-exist-either';
  process.env.NEWS_SOURCE_TIMEOUT_MS = '2000';
  delete require.cache[require.resolve('../src/services/news-sources.client')];
  delete require.cache[require.resolve('../src/services/rss-parser')];
  const brokenNewsSources = require('../src/services/news-sources.client');

  let threw = false;
  try {
    await brokenNewsSources.getHeadlines();
  } catch (err) {
    threw = true;
    console.log('expected_all_sources_failed_error', err.message);
    assert(err.message.includes('forexlive'), 'expected error to mention forexlive');
    assert(err.message.includes('fxstreet'), 'expected error to mention fxstreet');
  }
  assert(threw, 'expected getHeadlines to throw when every RSS source fails');

  console.log('NEWS_SOURCES_63_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
