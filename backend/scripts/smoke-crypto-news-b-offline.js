'use strict';

/**
 * Crypto Increment B offline smoke — no network. Proves stub classify →
 * aggregate → Redis seen-hash/cache path with fixture headlines.
 *
 *   node backend/scripts/smoke-crypto-news-b-offline.js
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});
process.env.CRYPTO_NEWS_LLM_ENABLED = 'false';

const { connectRedis, redis } = require('../src/db/redis');
const { classifyCryptoHeadlinesBatch } = require('../src/services/crypto-headline-classifier.client');
const cryptoNewsPath = path.join(__dirname, '..', '..', 'bot', 'crypto-news-intelligence', 'src');
const { aggregateCryptoNewsIntelligence } = require(path.join(cryptoNewsPath, 'aggregate.js'));
const { hashHeadline } = require(path.join(cryptoNewsPath, 'contentHash.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();
  const titles = [
    'Major crypto exchange hack suspends Bitcoin withdrawals',
    'Ethereum network upgrade drives ETH higher',
    'Local weather forecast sunny',
  ];

  const classifications = await classifyCryptoHeadlinesBatch(titles);
  assert(classifications.length === 3, 'classifications length');
  assert(classifications[0].impact >= 0.9, 'hack should be high impact');
  assert(classifications[2].impact === 0, 'unrelated should be zero');

  const agg = aggregateCryptoNewsIntelligence({ headlineClassifications: classifications });
  assert(agg.BTCUSD.news_impact_score >= 0.9, 'BTC impact');
  assert(agg.ETHUSD.market_quality > 0.5, 'ETH quality from positive headline');

  const hash = hashHeadline(titles[0]);
  const key = `crypto:news:seen-hash:${hash}`;
  await redis.del(key);
  await redis.set(key, '1', 'EX', 60);
  assert((await redis.get(key)) === '1', 'seen-hash write');

  console.log(JSON.stringify({ classifications, agg }, null, 2));
  console.log('CRYPTO_NEWS_B_OFFLINE_PASS');
}

main()
  .catch((err) => {
    console.error('CRYPTO_NEWS_B_OFFLINE_FAIL', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
  });
