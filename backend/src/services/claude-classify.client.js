'use strict';

/**
 * Module 3 Step 2 — Anthropic Claude Messages API client for headline
 * classification. Kill switch lives in headline-classifier.client.js
 * (NEWS_LLM_ENABLED). Always returns token usage + estimated USD
 * so cost is never invisible on the first live call.
 */

const path = require('path');
const {
  buildClassifyBatchPrompt,
  parseClassifyBatchResponse,
} = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'news-intelligence',
  'src',
  'llmClassifyParse.js'
));
const { monthUsageKeys } = require('./news-llm-usage');
const { estimateClaudeCostUsd } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'news-intelligence',
  'src',
  'estimateClaudeCost.js'
));

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_INPUT_USD_PER_MTOK = 3;
const DEFAULT_OUTPUT_USD_PER_MTOK = 15;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * @param {{
 *   inputTokens: number,
 *   outputTokens: number,
 *   estimatedCostUsd: number,
 *   model: string,
 *   titleCount: number,
 * }} usage
 * @param {{ redis?: object, log?: Function }} [sinks]
 */
async function recordClaudeUsage(usage, sinks = {}) {
  const log = sinks.log || console.log;
  log(
    '[news-llm] claude_usage ' +
      JSON.stringify({
        model: usage.model,
        title_count: usage.titleCount,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        estimated_cost_usd: Number(usage.estimatedCostUsd.toFixed(8)),
      })
  );

  const redis = sinks.redis;
  if (!redis) return;
  try {
    const month = monthUsageKeys();
    if (typeof redis.incrby === 'function') {
      await redis.incrby('news:llm:usage:input_tokens', usage.inputTokens);
      await redis.incrby('news:llm:usage:output_tokens', usage.outputTokens);
      await redis.incrby('news:llm:usage:calls', 1);
      await redis.incrby(month.inputTokens, usage.inputTokens);
      await redis.incrby(month.outputTokens, usage.outputTokens);
      await redis.incrby(month.calls, 1);
    }
    if (typeof redis.incrbyfloat === 'function') {
      await redis.incrbyfloat('news:llm:usage:estimated_cost_usd', usage.estimatedCostUsd);
      await redis.incrbyfloat(month.estimatedCostUsd, usage.estimatedCostUsd);
    }
  } catch (err) {
    log('[news-llm] usage redis write failed: ' + (err && err.message ? err.message : err));
  }
}

/**
 * Low-level Messages call. Injectable fetchImpl for tests.
 *
 * @returns {Promise<{ text: string, usage: { inputTokens: number, outputTokens: number, estimatedCostUsd: number, model: string } }>}
 */
async function callClaudeMessages({
  system,
  user,
  apiKey,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  inputUsdPerMTok = DEFAULT_INPUT_USD_PER_MTOK,
  outputUsdPerMTok = DEFAULT_OUTPUT_USD_PER_MTOK,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('ANTHROPIC_API_KEY is required for Claude classification');
  }
  if (typeof system !== 'string' || !system.trim()) {
    throw new TypeError('system prompt required');
  }
  if (typeof user !== 'string' || !user.trim()) {
    throw new TypeError('user prompt required');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Claude classification timed out after ' + timeoutMs + 'ms');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error('Claude API returned non-JSON (HTTP ' + response.status + ')');
  }

  if (!response.ok) {
    const msg =
      (body && body.error && body.error.message) ||
      bodyText.slice(0, 200) ||
      'unknown error';
    throw new Error('Claude API HTTP ' + response.status + ': ' + msg);
  }

  const blocks = Array.isArray(body.content) ? body.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) {
    throw new Error('Claude API response had no text content');
  }

  const inputTokens = Number(body.usage && body.usage.input_tokens) || 0;
  const outputTokens = Number(body.usage && body.usage.output_tokens) || 0;
  const estimatedCostUsd = estimateClaudeCostUsd({
    inputTokens,
    outputTokens,
    inputUsdPerMTok,
    outputUsdPerMTok,
  });

  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      model,
    },
  };
}

/**
 * Classify a batch of headline titles via Claude. Parses into the
 * Module 3 shape and records usage (console + optional Redis).
 *
 * @param {string[]} titles
 * @param {object} [options]
 */
async function classifyHeadlinesBatchWithClaude(titles, options = {}) {
  const {
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.NEWS_LLM_MODEL || DEFAULT_MODEL,
    maxTokens = Number(process.env.NEWS_LLM_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
    timeoutMs = Number(process.env.NEWS_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    inputUsdPerMTok =
      Number(process.env.NEWS_LLM_INPUT_USD_PER_MTOK) || DEFAULT_INPUT_USD_PER_MTOK,
    outputUsdPerMTok =
      Number(process.env.NEWS_LLM_OUTPUT_USD_PER_MTOK) || DEFAULT_OUTPUT_USD_PER_MTOK,
    fetchImpl,
    redis,
    log,
    recordUsage = recordClaudeUsage,
  } = options;

  const { system, user } = buildClassifyBatchPrompt(titles);
  const { text, usage } = await callClaudeMessages({
    system,
    user,
    apiKey,
    model,
    maxTokens,
    timeoutMs,
    inputUsdPerMTok,
    outputUsdPerMTok,
    fetchImpl,
  });

  const classifications = parseClassifyBatchResponse(text, titles.length);
  const fullUsage = { ...usage, titleCount: titles.length };
  await recordUsage(fullUsage, { redis, log });

  return { classifications, usage: fullUsage, rawText: text };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_INPUT_USD_PER_MTOK,
  DEFAULT_OUTPUT_USD_PER_MTOK,
  callClaudeMessages,
  classifyHeadlinesBatchWithClaude,
  recordClaudeUsage,
  estimateClaudeCostUsd,
};
