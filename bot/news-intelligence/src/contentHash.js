'use strict';

const crypto = require('crypto');

/**
 * 08_Bot_Architecture.md Section 9.3 — content-hash dedup so a
 * headline already seen in a previous cycle doesn't trigger a
 * repeat, billable LLM call. Case/whitespace-normalized so trivial
 * formatting differences between feeds/refetches don't produce a
 * different hash for what is, in substance, the same headline.
 */
function hashHeadline(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new TypeError('hashHeadline requires a non-empty title string');
  }
  return crypto.createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

module.exports = { hashHeadline };
