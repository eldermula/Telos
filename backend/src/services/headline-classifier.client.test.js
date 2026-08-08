'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyHeadlinesBatch } = require('./headline-classifier.client');

const STUB_RESULT = [{ entities: ['STUB'], sentiment: 0, impact: 0.1 }];

describe('classifyHeadlinesBatch kill switch + stub fallback', () => {
  it('returns [] for empty titles', async () => {
    const out = await classifyHeadlinesBatch([], {
      newsLlmEnabled: true,
      apiKey: 'k',
      classifyWithClaude: async () => {
        throw new Error('should not call');
      },
    });
    assert.deepEqual(out, []);
  });

  it('uses stub when NEWS_LLM_ENABLED is off (default path)', async () => {
    let claudeCalls = 0;
    const out = await classifyHeadlinesBatch(['Fed holds rates'], {
      newsLlmEnabled: false,
      apiKey: 'present',
      classifyStub: () => STUB_RESULT,
      classifyWithClaude: async () => {
        claudeCalls += 1;
        return { classifications: [{ entities: ['LLM'], sentiment: 1, impact: 1 }] };
      },
    });
    assert.deepEqual(out, STUB_RESULT);
    assert.equal(claudeCalls, 0);
  });

  it('uses stub when enabled but API key missing', async () => {
    const logs = [];
    let claudeCalls = 0;
    const out = await classifyHeadlinesBatch(['ECB comments'], {
      newsLlmEnabled: true,
      apiKey: null,
      classifyStub: () => STUB_RESULT,
      classifyWithClaude: async () => {
        claudeCalls += 1;
        return { classifications: [] };
      },
      log: (l) => logs.push(l),
    });
    assert.deepEqual(out, STUB_RESULT);
    assert.equal(claudeCalls, 0);
    assert.ok(logs.some((l) => /ANTHROPIC_API_KEY missing/.test(l)));
  });

  it('returns Claude classifications when enabled + key present', async () => {
    const llm = [{ entities: ['USD'], sentiment: 0.3, impact: 0.7 }];
    const out = await classifyHeadlinesBatch(['USD strength'], {
      newsLlmEnabled: true,
      apiKey: 'test-key',
      classifyWithClaude: async (titles) => {
        assert.deepEqual(titles, ['USD strength']);
        return { classifications: llm };
      },
      classifyStub: () => STUB_RESULT,
    });
    assert.deepEqual(out, llm);
  });

  it('falls back to stub on Claude failure (never drops headlines)', async () => {
    const logs = [];
    const out = await classifyHeadlinesBatch(['Oil spike', 'Quiet open'], {
      newsLlmEnabled: true,
      apiKey: 'test-key',
      classifyWithClaude: async () => {
        throw new Error('timeout');
      },
      classifyStub: (titles) =>
        titles.map((title) => ({ entities: [title], sentiment: 0, impact: 0 })),
      log: (l) => logs.push(l),
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0].entities, ['Oil spike']);
    assert.ok(logs.some((l) => /stub fallback/.test(l) && /timeout/.test(l)));
  });

  it('rejects non-array titles', async () => {
    await assert.rejects(() => classifyHeadlinesBatch('x'), /array of titles/);
  });
});