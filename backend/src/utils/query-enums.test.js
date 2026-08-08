'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRangeQuery,
  parseStrategyStatusQuery,
  parseRiskTierParam,
} = require('./query-enums');
const { AppError } = require('./app-error');

describe('query-enums (Zod group C)', () => {
  it('parseRangeQuery accepts omit and allowed values', () => {
    assert.equal(parseRangeQuery({}), undefined);
    assert.equal(parseRangeQuery({ range: '7d' }), '7d');
  });

  it('parseRangeQuery rejects unknown range', () => {
    assert.throws(() => parseRangeQuery({ range: '1y' }), AppError);
  });

  it('parseStrategyStatusQuery accepts omit and known status', () => {
    assert.equal(parseStrategyStatusQuery({}), undefined);
    assert.equal(parseStrategyStatusQuery({ status: 'active' }), 'active');
  });

  it('parseStrategyStatusQuery rejects unknown status', () => {
    assert.throws(() => parseStrategyStatusQuery({ status: 'draft' }), AppError);
  });

  it('parseRiskTierParam accepts 0–7', () => {
    assert.equal(parseRiskTierParam('0'), 0);
    assert.equal(parseRiskTierParam('7'), 7);
  });

  it('parseRiskTierParam rejects out of range', () => {
    assert.throws(() => parseRiskTierParam('8'), AppError);
    assert.throws(() => parseRiskTierParam('x'), AppError);
  });
});
