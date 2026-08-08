'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateClaudeCostUsd } = require('../src/estimateClaudeCost');

describe('estimateClaudeCostUsd', () => {
  it('computes from per-MTok rates', () => {
    // 1M in @ $3 + 1M out @ $15 = $18
    assert.equal(
      estimateClaudeCostUsd({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        inputUsdPerMTok: 3,
        outputUsdPerMTok: 15,
      }),
      18
    );
  });

  it('scales linearly for small batches', () => {
    const usd = estimateClaudeCostUsd({
      inputTokens: 1000,
      outputTokens: 500,
      inputUsdPerMTok: 3,
      outputUsdPerMTok: 15,
    });
    assert.ok(Math.abs(usd - (1000 / 1e6) * 3 - (500 / 1e6) * 15) < 1e-12);
  });

  it('rejects negative token counts', () => {
    assert.throws(
      () => estimateClaudeCostUsd({ inputTokens: -1, outputTokens: 0 }),
      /inputTokens/
    );
  });
});