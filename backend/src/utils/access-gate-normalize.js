'use strict';

/**
 * Site-wide access gate — Phase 8.5 / 09_Security.md.
 *
 * Normalizes passphrase text the same way on both the stored env value
 * and the submitted attempt before comparing: lowercase → strip
 * punctuation → collapse whitespace. The verse itself never leaves
 * the server.
 */

function normalizeGatePhrase(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function phrasesMatch(stored, attempt) {
  const a = normalizeGatePhrase(stored);
  const b = normalizeGatePhrase(attempt);
  if (!a || !b) return false;
  return a === b;
}

module.exports = { normalizeGatePhrase, phrasesMatch };
