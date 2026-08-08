'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  utcMonthKey,
  monthUsageKeys,
  getNewsLlmUsage,
} = require('./news-llm-usage');

describe('news-llm-usage', () => {
  it('utcMonthKey formats YYYY-MM in UTC', () => {
    assert.equal(utcMonthKey(new Date('2026-08-08T12:00:00Z')), '2026-08');
    assert.equal(utcMonthKey(new Date('2026-01-01T00:00:00Z')), '2026-01');
  });

  it('monthUsageKeys nests under news:llm:usage:{YYYY-MM}:*', () => {
    const keys = monthUsageKeys('2026-08');
    assert.equal(keys.month, '2026-08');
    assert.equal(keys.inputTokens, 'news:llm:usage:2026-08:input_tokens');
    assert.equal(keys.estimatedCostUsd, 'news:llm:usage:2026-08:estimated_cost_usd');
  });

  it('getNewsLlmUsage reads lifetime + current month', async () => {
    const store = {
      'news:llm:usage:input_tokens': '1000',
      'news:llm:usage:output_tokens': '200',
      'news:llm:usage:calls': '3',
      'news:llm:usage:estimated_cost_usd': '0.0125',
      'news:llm:usage:2026-08:input_tokens': '400',
      'news:llm:usage:2026-08:output_tokens': '80',
      'news:llm:usage:2026-08:calls': '1',
      'news:llm:usage:2026-08:estimated_cost_usd': '0.004',
    };
    const redis = {
      get: async (k) => (k in store ? store[k] : null),
    };
    const usage = await getNewsLlmUsage(redis, { now: new Date('2026-08-15T00:00:00Z') });
    assert.deepEqual(usage.lifetime, {
      calls: 3,
      input_tokens: 1000,
      output_tokens: 200,
      estimated_cost_usd: 0.0125,
    });
    assert.deepEqual(usage.current_month, {
      month: '2026-08',
      calls: 1,
      input_tokens: 400,
      output_tokens: 80,
      estimated_cost_usd: 0.004,
    });
  });

  it('getNewsLlmUsage returns zeros when keys missing', async () => {
    const redis = { get: async () => null };
    const usage = await getNewsLlmUsage(redis, { now: new Date('2026-08-01T00:00:00Z') });
    assert.equal(usage.lifetime.calls, 0);
    assert.equal(usage.current_month.estimated_cost_usd, 0);
    assert.equal(usage.current_month.month, '2026-08');
  });
});