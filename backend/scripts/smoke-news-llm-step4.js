'use strict';

/**
 * Module 3 Step 4 — one live Claude batch against real RSS headlines.
 *
 * Forces NEWS_LLM_ENABLED for this process only (does not flip prod).
 * If ANTHROPIC_API_KEY is only present as a commented line in .env,
 * loads it into process.env for this smoke (does not rewrite .env).
 *
 *   node backend/scripts/smoke-news-llm-step4.js
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: envPath });

function loadCommentedAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) return;
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^\s*#\s*ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/m);
  if (!match) return;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  if (value) process.env.ANTHROPIC_API_KEY = value;
}

loadCommentedAnthropicKey();
process.env.NEWS_LLM_ENABLED = 'true';

// Fresh load of env-dependent modules after kill-switch override.
for (const key of Object.keys(require.cache)) {
  if (
    key.includes(`${path.sep}config${path.sep}env.js`) ||
    key.includes(`${path.sep}headline-classifier.client.js`) ||
    key.includes(`${path.sep}claude-classify.client.js`) ||
    key.includes(`${path.sep}news-intelligence.service.js`)
  ) {
    delete require.cache[key];
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertClassificationShape(c, i) {
  assert(c && typeof c === 'object', `classifications[${i}] missing`);
  assert(Array.isArray(c.entities), `classifications[${i}].entities must be array`);
  assert(typeof c.sentiment === 'number', `classifications[${i}].sentiment must be number`);
  assert(typeof c.impact === 'number', `classifications[${i}].impact must be number`);
  assert(c.sentiment >= -1 && c.sentiment <= 1, `sentiment out of range at ${i}: ${c.sentiment}`);
  assert(c.impact >= 0 && c.impact <= 1, `impact out of range at ${i}: ${c.impact}`);
}

async function main() {
  assert(
    process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim(),
    'ANTHROPIC_API_KEY missing — uncomment it in backend/.env or export it before this smoke'
  );

  const { connectRedis, redis } = require('../src/db/redis');
  const { NEWS_LLM_ENABLED } = require('../src/config/env');
  const { getNewsLlmUsage } = require('../src/services/news-llm-usage');
  const newsSources = require('../src/services/news-sources.client');
  const { classifyHeadlinesBatch } = require('../src/services/headline-classifier.client');
  const { hashHeadline } = require('../../bot/news-intelligence/src/contentHash.js');

  assert(NEWS_LLM_ENABLED === true, 'NEWS_LLM_ENABLED must be true for this smoke process');

  await connectRedis();

  const usageBefore = await getNewsLlmUsage(redis);
  console.log('usage_before', JSON.stringify(usageBefore));

  // Fresh RSS pull (real network). Cap batch size so one smoke stays cheap.
  const MAX_TITLES = Number(process.env.NEWS_LLM_SMOKE_MAX_TITLES) || 5;
  const { items, source } = await newsSources.getHeadlines();
  assert(Array.isArray(items) && items.length > 0, 'expected live headlines from RSS');
  const titles = items.slice(0, MAX_TITLES).map((it) => it.title).filter(Boolean);
  assert(titles.length > 0, 'no usable titles');
  console.log('rss_source', source);
  console.log('titles', titles);

  // Clear seen-hash for these titles so dedup doesn't mask the run,
  // and so we can assert they get written after classification.
  const hashes = titles.map((t) => hashHeadline(t));
  const seenKeys = hashes.map((h) => `news:seen-hash:${h}`);
  if (seenKeys.length) await redis.del(...seenKeys);

  const logs = [];
  const classifications = await classifyHeadlinesBatch(titles, {
    newsLlmEnabled: true,
    apiKey: process.env.ANTHROPIC_API_KEY,
    redis,
    log: (line) => {
      logs.push(line);
      console.log(line);
    },
  });

  assert(!logs.some((l) => /stub fallback/.test(l)), 'Claude path fell back to stub — live call did not succeed');
  assert(classifications.length === titles.length, 'classification count must match titles');
  classifications.forEach(assertClassificationShape);

  // Mark seen exactly as news-intelligence.service does after success.
  await Promise.all(
    seenKeys.map((key) => redis.set(key, '1', 'EX', 86400))
  );
  const seenAfter = await Promise.all(seenKeys.map((k) => redis.get(k)));
  assert(
    seenAfter.every((v) => v === '1'),
    'expected Redis seen-hash keys set for every classified title'
  );

  // Second classify of the same titles through the service-style dedup
  // check: all should already be seen → 0 new items if we re-check hashes.
  const stillNew = [];
  for (let i = 0; i < titles.length; i += 1) {
    const already = await redis.get(seenKeys[i]);
    if (!already) stillNew.push(titles[i]);
  }
  assert(stillNew.length === 0, 'dedup failed — titles still look new after seen-hash write');

  const usageAfter = await getNewsLlmUsage(redis);
  const deltaCalls = usageAfter.lifetime.calls - usageBefore.lifetime.calls;
  const deltaIn = usageAfter.lifetime.input_tokens - usageBefore.lifetime.input_tokens;
  const deltaOut = usageAfter.lifetime.output_tokens - usageBefore.lifetime.output_tokens;
  const deltaCost =
    usageAfter.lifetime.estimated_cost_usd - usageBefore.lifetime.estimated_cost_usd;

  assert(deltaCalls >= 1, `expected usage calls to increment, delta=${deltaCalls}`);
  assert(deltaIn > 0, `expected input_tokens > 0, delta=${deltaIn}`);
  assert(deltaOut > 0, `expected output_tokens > 0, delta=${deltaOut}`);
  assert(deltaCost > 0, `expected estimated_cost_usd > 0, delta=${deltaCost}`);
  assert(
    logs.some((l) => l.includes('claude_usage') && l.includes('estimated_cost_usd')),
    'expected claude_usage log line'
  );

  const usageLog = logs.find((l) => l.includes('claude_usage'));
  const usageJson = JSON.parse(usageLog.replace(/^\[news-llm\] claude_usage\s+/, ''));

  console.log('\n=== STEP4_LIVE_RESULT ===');
  console.log(
    JSON.stringify(
      {
        model: usageJson.model,
        title_count: titles.length,
        titles,
        classifications,
        usage_log: usageJson,
        redis_delta: {
          calls: deltaCalls,
          input_tokens: deltaIn,
          output_tokens: deltaOut,
          estimated_cost_usd: deltaCost,
        },
        usage_after_month: usageAfter.current_month,
        seen_hash_keys_set: seenKeys.length,
        second_pass_still_new: stillNew.length,
      },
      null,
      2
    )
  );
  console.log('NEWS_LLM_STEP4_PASS');
}

main()
  .catch((err) => {
    console.error('NEWS_LLM_STEP4_FAIL', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const { redis } = require('../src/db/redis');
      await redis.quit();
    } catch {
      /* ignore */
    }
  });