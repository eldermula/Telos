'use strict';

/**
 * One-line Module 3 LLM spend check (no dashboard).
 *
 *   node backend/scripts/news-llm-usage.js
 *
 * Reads Redis lifetime + current UTC-month counters written by
 * claude-classify.client.js. Safe when Redis is empty (zeros).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { redis } = require('../src/db/redis');
const { getNewsLlmUsage } = require('../src/services/news-llm-usage');
const { NEWS_LLM_ENABLED } = require('../src/config/env');

async function main() {
  const usage = await getNewsLlmUsage(redis);
  const month = usage.current_month;
  console.log(
    `[news-llm] enabled=${NEWS_LLM_ENABLED} month=${month.month} ` +
      `calls=${month.calls} input_tokens=${month.input_tokens} ` +
      `output_tokens=${month.output_tokens} ` +
      `estimated_cost_usd=${month.estimated_cost_usd.toFixed(6)} ` +
      `(lifetime_usd=${usage.lifetime.estimated_cost_usd.toFixed(6)})`
  );
  console.log(JSON.stringify({ enabled: NEWS_LLM_ENABLED, ...usage }, null, 2));
}

main()
  .catch((err) => {
    console.error('[news-llm] usage read failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
  });