'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { hashHeadline } = require('../src/contentHash');

test('same headline text always produces the same hash', () => {
  const a = hashHeadline('US July non-farm payrolls -23K vs +80K expected');
  const b = hashHeadline('US July non-farm payrolls -23K vs +80K expected');
  assert.equal(a, b);
});

test('is case/whitespace-insensitive (same headline, trivial formatting difference)', () => {
  const a = hashHeadline('  US July Non-Farm Payrolls -23K vs +80K expected  ');
  const b = hashHeadline('us july non-farm payrolls -23k vs +80k expected');
  assert.equal(a, b);
});

test('different headlines produce different hashes', () => {
  const a = hashHeadline('US July non-farm payrolls -23K vs +80K expected');
  const b = hashHeadline('Canada July employment change +75.1K vs +15K expected');
  assert.notEqual(a, b);
});

test('rejects empty/non-string input rather than hashing nothing useful', () => {
  assert.throws(() => hashHeadline(''), TypeError);
  assert.throws(() => hashHeadline('   '), TypeError);
  assert.throws(() => hashHeadline(null), TypeError);
});
