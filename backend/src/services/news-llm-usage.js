'use strict';

/**
 * Module 3 LLM usage counters — write companions live in
 * claude-classify.client.js (recordClaudeUsage). This module is the
 * read side so spend is never write-only mystery counters.
 */

const USAGE_KEYS = Object.freeze({
  inputTokens: 'news:llm:usage:input_tokens',
  outputTokens: 'news:llm:usage:output_tokens',
  calls: 'news:llm:usage:calls',
  estimatedCostUsd: 'news:llm:usage:estimated_cost_usd',
});

function utcMonthKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthUsageKeys(monthKey = utcMonthKey()) {
  const prefix = `news:llm:usage:${monthKey}`;
  return {
    inputTokens: `${prefix}:input_tokens`,
    outputTokens: `${prefix}:output_tokens`,
    calls: `${prefix}:calls`,
    estimatedCostUsd: `${prefix}:estimated_cost_usd`,
    month: monthKey,
  };
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} redis ioredis-like client with .get
 * @param {{ now?: Date }} [opts]
 */
async function getNewsLlmUsage(redis, opts = {}) {
  const month = monthUsageKeys(utcMonthKey(opts.now || new Date()));
  const keys = [
    USAGE_KEYS.inputTokens,
    USAGE_KEYS.outputTokens,
    USAGE_KEYS.calls,
    USAGE_KEYS.estimatedCostUsd,
    month.inputTokens,
    month.outputTokens,
    month.calls,
    month.estimatedCostUsd,
  ];
  const values = await Promise.all(keys.map((k) => redis.get(k).catch(() => null)));
  return {
    lifetime: {
      calls: toInt(values[2]),
      input_tokens: toInt(values[0]),
      output_tokens: toInt(values[1]),
      estimated_cost_usd: toFloat(values[3]),
    },
    current_month: {
      month: month.month,
      calls: toInt(values[6]),
      input_tokens: toInt(values[4]),
      output_tokens: toInt(values[5]),
      estimated_cost_usd: toFloat(values[7]),
    },
  };
}

module.exports = {
  USAGE_KEYS,
  utcMonthKey,
  monthUsageKeys,
  getNewsLlmUsage,
};