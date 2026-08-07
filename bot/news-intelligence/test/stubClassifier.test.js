'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyHeadlineStub } = require('../src/stubClassifier');

test('detects USD entity from Fed/NFP language', () => {
  const result = classifyHeadlineStub('US July non-farm payrolls -23K vs +80K expected');
  assert.ok(result.entities.includes('USD'), `expected USD entity, got ${result.entities}`);
});

test('detects JPY entity from BoJ/yen language', () => {
  const result = classifyHeadlineStub('BoJ holds rates as yen weakens further');
  assert.ok(result.entities.includes('JPY'));
});

test('detects the synthetic XAU tag from gold/safe-haven language', () => {
  const result = classifyHeadlineStub('Gold advances on safe-haven demand');
  assert.ok(result.entities.includes('XAU'));
});

test('can detect multiple entities in one headline', () => {
  const result = classifyHeadlineStub('EUR/GBP consolidates ahead of ECB and BoE decisions');
  assert.ok(result.entities.includes('EUR'));
  assert.ok(result.entities.includes('GBP'));
});

test('positive keyword language produces positive sentiment', () => {
  const result = classifyHeadlineStub('Dollar rallies as jobs data beats expectations');
  assert.ok(result.sentiment > 0, `expected positive sentiment, got ${result.sentiment}`);
});

test('negative keyword language produces negative sentiment', () => {
  const result = classifyHeadlineStub('Dollar plunges as jobs data misses expectations badly');
  assert.ok(result.sentiment < 0, `expected negative sentiment, got ${result.sentiment}`);
});

test('neutral/no-signal headline produces exactly zero sentiment', () => {
  const result = classifyHeadlineStub('EUR/USD trades in a narrow range Friday afternoon');
  assert.equal(result.sentiment, 0);
});

test('sentiment and impact always stay within their documented bounds', () => {
  const headlines = [
    'US July non-farm payrolls -23K vs +80K expected',
    'Dollar plunges as jobs data misses expectations badly and recession fears grow',
    'EUR/USD trades in a narrow range Friday afternoon',
    'Gold advances on safe-haven demand as yields fall',
  ];
  for (const title of headlines) {
    const { sentiment, impact } = classifyHeadlineStub(title);
    assert.ok(sentiment >= -1 && sentiment <= 1, `sentiment out of bounds: ${sentiment}`);
    assert.ok(impact >= 0 && impact <= 1, `impact out of bounds: ${impact}`);
  }
});

test('rejects empty/non-string input', () => {
  assert.throws(() => classifyHeadlineStub(''), TypeError);
  assert.throws(() => classifyHeadlineStub(null), TypeError);
});
