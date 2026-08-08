'use strict';

const path = require('path');
const { CRYPTO_NEWS_LLM_ENABLED } = require('../config/env');
const { redis } = require('../db/redis');
const {
  callClaudeMessages,
  recordClaudeUsage,
  DEFAULT_MODEL,
  DEFAULT_INPUT_USD_PER_MTOK,
  DEFAULT_OUTPUT_USD_PER_MTOK,
} = require('./claude-classify.client');

const cryptoNewsPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'crypto-news-intelligence',
  'src'
);
const { classifyCryptoHeadlineStub } = require(path.join(cryptoNewsPath, 'stubClassifier.js'));
const {
  buildCryptoClassifyBatchPrompt,
  parseCryptoClassifyBatchResponse,
} = require(path.join(cryptoNewsPath, 'llmClassifyParse.js'));

/**
 * Crypto Increment B classifier seam — parallel to forex
 * headline-classifier.client.js. Own kill switch
 * CRYPTO_NEWS_LLM_ENABLED (default off). Never touches NEWS_LLM_ENABLED.
 */
async function classifyCryptoHeadlinesBatch(titles, options = {}) {
  if (!Array.isArray(titles)) {
    throw new TypeError('classifyCryptoHeadlinesBatch requires an array of titles');
  }
  if (titles.length === 0) return [];

  const enabled =
    options.newsLlmEnabled !== undefined ? options.newsLlmEnabled : CRYPTO_NEWS_LLM_ENABLED;
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.ANTHROPIC_API_KEY;
  const stub =
    options.classifyStub ||
    ((list) => list.map((title) => classifyCryptoHeadlineStub(title)));
  const log = options.log || console.log;

  if (!enabled) return stub(titles);
  if (!apiKey) {
    log('[crypto-news-llm] CRYPTO_NEWS_LLM_ENABLED but ANTHROPIC_API_KEY missing — stub fallback');
    return stub(titles);
  }

  const classifyWithClaude =
    options.classifyWithClaude ||
    (async (list) => {
      const { system, user } = buildCryptoClassifyBatchPrompt(list);
      const model = process.env.CRYPTO_NEWS_LLM_MODEL || process.env.NEWS_LLM_MODEL || DEFAULT_MODEL;
      const maxTokens = Number(process.env.CRYPTO_NEWS_LLM_MAX_TOKENS) || 2048;
      const timeoutMs = Number(process.env.CRYPTO_NEWS_LLM_TIMEOUT_MS) || 20000;
      const inputUsdPerMTok =
        Number(process.env.NEWS_LLM_INPUT_USD_PER_MTOK) || DEFAULT_INPUT_USD_PER_MTOK;
      const outputUsdPerMTok =
        Number(process.env.NEWS_LLM_OUTPUT_USD_PER_MTOK) || DEFAULT_OUTPUT_USD_PER_MTOK;

      const { text, usage } = await callClaudeMessages({
        system,
        user,
        apiKey,
        model,
        maxTokens,
        timeoutMs,
        inputUsdPerMTok,
        outputUsdPerMTok,
        fetchImpl: options.fetchImpl,
      });
      const classifications = parseCryptoClassifyBatchResponse(text, list.length);
      const fullUsage = { ...usage, titleCount: list.length, model };
      // Reuse forex usage counters with a distinct log prefix; Redis
      // lifetime keys stay shared so OPS spend checks still see total
      // Anthropic spend. Prefix in the log line only.
      await recordClaudeUsage(fullUsage, {
        redis: options.redis !== undefined ? options.redis : redis,
        log: (line) => log(line.replace('[news-llm]', '[crypto-news-llm]')),
      });
      return { classifications, usage: fullUsage };
    });

  try {
    const { classifications } = await classifyWithClaude(titles);
    return classifications;
  } catch (err) {
    log(
      '[crypto-news-llm] Claude classification failed — stub fallback: ' +
        (err && err.message ? err.message : err)
    );
    return stub(titles);
  }
}

module.exports = { classifyCryptoHeadlinesBatch };
