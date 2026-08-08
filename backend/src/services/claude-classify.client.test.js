'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  callClaudeMessages,
  classifyHeadlinesBatchWithClaude,
  recordClaudeUsage,
  DEFAULT_MODEL,
} = require('./claude-classify.client');

function mockFetchOk({ text, input_tokens = 100, output_tokens = 40 }) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        content: [{ type: 'text', text }],
        usage: { input_tokens, output_tokens },
      }),
  });
}

describe('callClaudeMessages', () => {
  it('returns text + estimated cost from usage', async () => {
    const { text, usage } = await callClaudeMessages({
      system: 'sys',
      user: 'usr',
      apiKey: 'test-key',
      fetchImpl: mockFetchOk({ text: '[{"entities":[],"sentiment":0,"impact":0}]', input_tokens: 1000, output_tokens: 500 }),
      inputUsdPerMTok: 3,
      outputUsdPerMTok: 15,
    });
    assert.match(text, /entities/);
    assert.equal(usage.inputTokens, 1000);
    assert.equal(usage.outputTokens, 500);
    assert.equal(usage.model, DEFAULT_MODEL);
    assert.ok(Math.abs(usage.estimatedCostUsd - (1000 / 1e6) * 3 - (500 / 1e6) * 15) < 1e-12);
  });

  it('throws on HTTP error', async () => {
    await assert.rejects(
      () =>
        callClaudeMessages({
          system: 'sys',
          user: 'usr',
          apiKey: 'test-key',
          fetchImpl: async () => ({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }),
          }),
        }),
      /HTTP 401/
    );
  });

  it('requires api key', async () => {
    await assert.rejects(
      () => callClaudeMessages({ system: 's', user: 'u', apiKey: '' }),
      /ANTHROPIC_API_KEY/
    );
  });
});

describe('classifyHeadlinesBatchWithClaude', () => {
  it('parses classifications and records usage', async () => {
    const logs = [];
    const redisOps = [];
    const redis = {
      incrby: async (k, v) => { redisOps.push(['incrby', k, v]); },
      incrbyfloat: async (k, v) => { redisOps.push(['incrbyfloat', k, v]); },
    };
    const payload = JSON.stringify([
      { entities: ['USD'], sentiment: 0.2, impact: 0.5 },
      { entities: [], sentiment: 0, impact: 0 },
    ]);
    const result = await classifyHeadlinesBatchWithClaude(
      ['Fed hikes', 'Quiet day'],
      {
        apiKey: 'test-key',
        fetchImpl: mockFetchOk({ text: payload, input_tokens: 200, output_tokens: 80 }),
        redis,
        log: (line) => logs.push(line),
      }
    );
    assert.equal(result.classifications.length, 2);
    assert.deepEqual(result.classifications[0].entities, ['USD']);
    assert.equal(result.usage.titleCount, 2);
    assert.ok(logs.some((l) => l.includes('claude_usage') && l.includes('estimated_cost_usd')));
    assert.ok(redisOps.some((o) => o[0] === 'incrby' && o[1] === 'news:llm:usage:input_tokens' && o[2] === 200));
    assert.ok(redisOps.some((o) => o[0] === 'incrby' && String(o[1]).includes(':input_tokens') && o[1] !== 'news:llm:usage:input_tokens' && o[2] === 200));
    assert.ok(redisOps.some((o) => o[0] === 'incrbyfloat' && String(o[1]).includes(':estimated_cost_usd') && o[1] !== 'news:llm:usage:estimated_cost_usd'));
    assert.ok(redisOps.some((o) => o[0] === 'incrbyfloat' && o[1] === 'news:llm:usage:estimated_cost_usd'));
  });
});

describe('recordClaudeUsage', () => {
  it('logs even when redis is absent', async () => {
    const logs = [];
    await recordClaudeUsage(
      {
        model: 'm',
        titleCount: 1,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0.0001,
      },
      { log: (l) => logs.push(l) }
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /claude_usage/);
  });
});