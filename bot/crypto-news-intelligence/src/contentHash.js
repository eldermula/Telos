'use strict';

const crypto = require('crypto');

/**
 * Same content-hash contract as forex Module 3 — trim + lower before hash
 * so trivial case/whitespace variants don't burn a second LLM call.
 */
function hashHeadline(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new TypeError('hashHeadline requires a non-empty title string');
  }
  return crypto.createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

module.exports = { hashHeadline };
