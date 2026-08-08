'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_ENTITIES,
  buildClassifyBatchPrompt,
  normalizeClassification,
  parseClassifyBatchResponse,
} = require('../src/llmClassifyParse');

describe('buildClassifyBatchPrompt', () => {
  it('numbers titles and lists allowed entities', () => {
    const { system, user } = buildClassifyBatchPrompt(['Fed hikes rates', 'ECB holds']);
    assert.match(system, /USD/);
    assert.match(system, /XAU/);
    assert.match(user, /1\. Fed hikes rates/);
    assert.match(user, /2\. ECB holds/);
    assert.match(user, /2 headlines/);
  });

  it('rejects empty / non-string titles', () => {
    assert.throws(() => buildClassifyBatchPrompt([]), /non-empty/);
    assert.throws(() => buildClassifyBatchPrompt(['ok', '']), /titles\[1\]/);
  });
});

describe('normalizeClassification', () => {
  it('uppercases entities and accepts bounds', () => {
    assert.deepEqual(
      normalizeClassification({ entities: ['usd', 'XAU'], sentiment: -0.5, impact: 0.8 }),
      { entities: ['USD', 'XAU'], sentiment: -0.5, impact: 0.8 }
    );
  });

  it('rejects unknown entities and out-of-range scores', () => {
    assert.throws(
      () => normalizeClassification({ entities: ['BTC'], sentiment: 0, impact: 0 }),
      /unknown entity/
    );
    assert.throws(
      () => normalizeClassification({ entities: [], sentiment: 2, impact: 0 }),
      /sentiment/
    );
    assert.throws(
      () => normalizeClassification({ entities: [], sentiment: 0, impact: -0.1 }),
      /impact/
    );
  });
});

describe('parseClassifyBatchResponse', () => {
  it('parses a bare JSON array', () => {
    const out = parseClassifyBatchResponse(
      JSON.stringify([
        { entities: ['USD'], sentiment: 0.2, impact: 0.5 },
        { entities: [], sentiment: 0, impact: 0 },
      ]),
      2
    );
    assert.equal(out.length, 2);
    assert.deepEqual(out[0].entities, ['USD']);
    assert.equal(out[1].impact, 0);
  });

  it('strips markdown fences', () => {
    const fenced = '```json\n[{"entities":["EUR"],"sentiment":-0.1,"impact":0.3}]\n```';
    const out = parseClassifyBatchResponse(fenced, 1);
    assert.deepEqual(out[0].entities, ['EUR']);
  });

  it('rejects length mismatch and invalid JSON', () => {
    assert.throws(
      () => parseClassifyBatchResponse('[{"entities":[],"sentiment":0,"impact":0}]', 2),
      /expected 2/
    );
    assert.throws(() => parseClassifyBatchResponse('not-json', 1), /parse failed/);
  });
});

describe('ALLOWED_ENTITIES', () => {
  it('matches stub classifier currency tags', () => {
    assert.ok(ALLOWED_ENTITIES.includes('USD'));
    assert.ok(ALLOWED_ENTITIES.includes('XAU'));
  });
});