'use strict';

const path = require('path');
const { NEWS_LLM_ENABLED } = require('../config/env');
const { redis } = require('../db/redis');
const { classifyHeadlinesBatchWithClaude } = require('./claude-classify.client');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { classifyHeadlineStub } = require(path.join(newsIntelligencePath, 'stubClassifier.js'));

/**
 * Module 3's LLM-parsing seam (08_Bot_Architecture.md Section 9.0/9.4).
 *
 * Kill switch: NEWS_LLM_ENABLED must be the exact string 'true' (see
 * env.js). Default off in every environment including production.
 * When on + ANTHROPIC_API_KEY present → Claude batch path. On any
 * failure (missing key, HTTP, timeout, bad JSON) → stub fallback for
 * the whole batch — never drop headlines (approved).
 *
 * Downstream only depends on `{entities, sentiment, impact}[]`.
 *
 * @param {string[]} titles
 * @param {{
 *   newsLlmEnabled?: boolean,
 *   apiKey?: string|null,
 *   classifyWithClaude?: Function,
 *   classifyStub?: Function,
 *   redis?: object,
 *   log?: Function,
 * }} [options] test seams
 */
async function classifyHeadlinesBatch(titles, options = {}) {
  if (!Array.isArray(titles)) {
    throw new TypeError('classifyHeadlinesBatch requires an array of titles');
  }
  if (titles.length === 0) {
    return [];
  }

  const enabled =
    options.newsLlmEnabled !== undefined ? options.newsLlmEnabled : NEWS_LLM_ENABLED;
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.ANTHROPIC_API_KEY;
  const stub =
    options.classifyStub || ((list) => list.map((title) => classifyHeadlineStub(title)));
  const log = options.log || console.log;

  if (!enabled) {
    return stub(titles);
  }
  if (!apiKey) {
    log('[news-llm] NEWS_LLM_ENABLED but ANTHROPIC_API_KEY missing — stub fallback');
    return stub(titles);
  }

  const claude =
    options.classifyWithClaude ||
    ((list) =>
      classifyHeadlinesBatchWithClaude(list, {
        apiKey,
        redis: options.redis !== undefined ? options.redis : redis,
        log,
      }));

  try {
    const { classifications } = await claude(titles);
    return classifications;
  } catch (err) {
    log(
      '[news-llm] Claude classification failed — stub fallback: ' +
        (err && err.message ? err.message : err)
    );
    return stub(titles);
  }
}

module.exports = { classifyHeadlinesBatch };