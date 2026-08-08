'use strict';

/**
 * Crypto Increment B smoke — live RSS + stub classification (LLM kill
 * switch left off). Does not flip CRYPTO_NEWS_LLM_ENABLED or NEWS_LLM_*.
 *
 *   node backend/scripts/smoke-crypto-news-b.js
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

// Force stub path for this smoke regardless of env — never spend here.
process.env.CRYPTO_NEWS_LLM_ENABLED = 'false';

const { connectRedis, redis } = require('../src/db/redis');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();
  const cryptoNews = require('../src/engine/crypto-news-intelligence.service');

  await redis.del(cryptoNews.CACHE_KEY);
  const seen = await redis.keys('crypto:news:seen-hash:*');
  if (seen.length) await redis.del(...seen);

  const first = await cryptoNews.computeFreshCryptoNewsIntelligence();
  console.log('first_pass', {
    sources: first.sources,
    new_headline_count: first.new_headline_count,
    BTCUSD: first.BTCUSD,
    ETHUSD: first.ETHUSD,
  });
  assert(first.stale === false, 'expected fresh result');
  assert(first.sources.headlines === true, 'expected headlines source');
  assert(first.BTCUSD && first.ETHUSD, 'missing instruments');
  assert(first.new_headline_count > 0, 'expected newly classified headlines on clean slate');

  const second = await cryptoNews.computeFreshCryptoNewsIntelligence();
  console.log('second_pass new_headline_count', second.new_headline_count);
  assert(
    second.new_headline_count <= first.new_headline_count,
    'dedup should not increase new_headline_count'
  );

  console.log('CRYPTO_NEWS_B_PASS');
}

main()
  .catch((err) => {
    console.error('CRYPTO_NEWS_B_FAIL', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
  });
