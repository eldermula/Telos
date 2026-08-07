'use strict';

const path = require('path');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { classifyHeadlineStub } = require(path.join(newsIntelligencePath, 'stubClassifier.js'));

/**
 * Module 3's LLM-parsing seam (08_Bot_Architecture.md Section 9.0/9.4
 * — Claude and/or OpenAI per `FR-BOT-1`). No `ANTHROPIC_API_KEY` or
 * `OPENAI_API_KEY` is configured yet, so this runs the deterministic
 * `classifyHeadlineStub` DRY_RUN stand-in for every headline —
 * intentionally the *only* path right now, not a conditional branch
 * that silently does nothing once a key shows up. **Wiring a real
 * batched LLM call is flagged future work, not done here.**
 *
 * Batched per the confirmed cost-control approach: one call in, N
 * titles, N classifications back in the same order — matches Section
 * 9.0's "once per headline" outcome (one classification per headline)
 * without one round-trip per headline. The stub itself is synchronous
 * and free, so batching doesn't change its cost today, but this is
 * the seam a real batched Claude/OpenAI call replaces later —
 * everything downstream (fan-out, aggregation, caching) only depends
 * on this function's `{entities, sentiment, impact}[]` return shape,
 * not on how it was produced.
 */
async function classifyHeadlinesBatch(titles) {
  if (!Array.isArray(titles)) {
    throw new TypeError('classifyHeadlinesBatch requires an array of titles');
  }
  return titles.map((title) => classifyHeadlineStub(title));
}

module.exports = { classifyHeadlinesBatch };
