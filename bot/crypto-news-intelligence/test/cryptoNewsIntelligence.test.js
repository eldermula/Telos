'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CRYPTO_WATCHLIST, instrumentsForEntity } = require('../src/watchlist');
const { hashHeadline } = require('../src/contentHash');
const { classifyCryptoHeadlineStub } = require('../src/stubClassifier');
const { fanOutClassification } = require('../src/fanOut');
const { aggregateCryptoNewsIntelligence } = require('../src/aggregate');
const {
  buildCryptoClassifyBatchPrompt,
  parseCryptoClassifyBatchResponse,
  ALLOWED_ENTITIES,
} = require('../src/llmClassifyParse');

describe('crypto watchlist', () => {
  it('is BTC/ETH only', () => {
    assert.deepEqual([...CRYPTO_WATCHLIST], ['BTCUSD', 'ETHUSD']);
    assert.deepEqual(instrumentsForEntity('BTC'), ['BTCUSD']);
    assert.deepEqual(instrumentsForEntity('CRYPTO'), ['BTCUSD', 'ETHUSD']);
  });
});

describe('contentHash', () => {
  it('normalizes case/whitespace', () => {
    assert.equal(hashHeadline('  Bitcoin ETF  '), hashHeadline('bitcoin etf'));
  });
});

describe('classifyCryptoHeadlineStub', () => {
  it('scores exchange hack as high-impact BTC/ETH-relevant', () => {
    const c = classifyCryptoHeadlineStub('Major crypto exchange hack suspends withdrawals');
    assert.ok(c.entities.includes('CRYPTO') || c.entities.includes('BTC'));
    assert.ok(c.impact >= 0.9);
    assert.ok(c.sentiment <= 0);
  });

  it('returns neutral empty for unrelated headlines', () => {
    assert.deepEqual(classifyCryptoHeadlineStub('Local football club wins cup'), {
      entities: [],
      sentiment: 0,
      impact: 0,
    });
  });

  it('tags ETH-specific headlines', () => {
    const c = classifyCryptoHeadlineStub('Ethereum network upgrade drives ETH higher');
    assert.ok(c.entities.includes('ETH'));
    assert.ok(c.sentiment > 0);
  });
});

describe('aggregateCryptoNewsIntelligence', () => {
  it('returns every watchlist instrument with max impact and sentiment quality', () => {
    const out = aggregateCryptoNewsIntelligence({
      headlineClassifications: [
        { entities: ['BTC'], sentiment: -0.8, impact: 0.95 },
        { entities: ['ETH'], sentiment: 0.4, impact: 0.3 },
      ],
    });
    assert.equal(out.BTCUSD.news_impact_score, 0.95);
    assert.ok(out.BTCUSD.market_quality < 0.5);
    assert.equal(out.ETHUSD.news_impact_score, 0.3);
    assert.ok(out.ETHUSD.market_quality > 0.5);
  });

  it('CRYPTO entity fans to both instruments', () => {
    const rows = fanOutClassification({ entities: ['CRYPTO'], sentiment: 0, impact: 0.7 });
    assert.equal(rows.length, 2);
    const out = aggregateCryptoNewsIntelligence({
      headlineClassifications: [{ entities: ['CRYPTO'], sentiment: 0, impact: 0.7 }],
    });
    assert.equal(out.BTCUSD.news_impact_score, 0.7);
    assert.equal(out.ETHUSD.news_impact_score, 0.7);
  });
});

describe('llmClassifyParse crypto', () => {
  it('builds a shock-oriented prompt with BTC/ETH entities', () => {
    const { system, user } = buildCryptoClassifyBatchPrompt(['Bitcoin ETF inflows rise']);
    assert.match(system, /unscheduled shock/i);
    assert.ok(ALLOWED_ENTITIES.includes('BTC'));
    assert.match(user, /Bitcoin ETF/);
  });

  it('parses fenced JSON', () => {
    const text = '```json\n[{"entities":["BTC"],"sentiment":-0.5,"impact":0.9}]\n```';
    const out = parseCryptoClassifyBatchResponse(text, 1);
    assert.deepEqual(out[0].entities, ['BTC']);
  });

  it('rejects unknown entities', () => {
    assert.throws(
      () => parseCryptoClassifyBatchResponse('[{"entities":["USD"],"sentiment":0,"impact":0}]', 1),
      /unknown entity/
    );
  });
});
