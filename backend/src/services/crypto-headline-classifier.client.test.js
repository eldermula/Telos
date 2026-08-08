'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyCryptoHeadlinesBatch } = require('./crypto-headline-classifier.client');

const STUB = [{ entities: ['BTC'], sentiment: -0.5, impact: 0.9 }];

describe('classifyCryptoHeadlinesBatch', () => {
  it('uses stub when CRYPTO_NEWS_LLM_ENABLED is off', async () => {
    let claudeCalls = 0;
    const out = await classifyCryptoHeadlinesBatch(['Bitcoin hack'], {
      newsLlmEnabled: false,
      apiKey: 'present',
      classifyStub: () => STUB,
      classifyWithClaude: async () => {
        claudeCalls += 1;
        return { classifications: [] };
      },
    });
    assert.deepEqual(out, STUB);
    assert.equal(claudeCalls, 0);
  });

  it('falls back to stub on Claude failure while switch is on', async () => {
    const logs = [];
    const out = await classifyCryptoHeadlinesBatch(['ETH news', 'BTC news'], {
      newsLlmEnabled: true,
      apiKey: 'k',
      classifyWithClaude: async () => {
        throw new Error('timeout');
      },
      classifyStub: (titles) =>
        titles.map((t) => ({ entities: ['CRYPTO'], sentiment: 0, impact: 0.1, title: t })),
      log: (l) => logs.push(l),
    });
    assert.equal(out.length, 2);
    assert.ok(logs.some((l) => /stub fallback/.test(l)));
  });
});
