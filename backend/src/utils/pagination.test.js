'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination, DEFAULT_LIMIT } = require('./pagination');
const { AppError } = require('./app-error');

describe('parsePagination (Zod group B)', () => {
  it('defaults omitted page/limit', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('accepts valid page/limit', () => {
    assert.deepEqual(parsePagination({ page: '2', limit: '10' }), {
      page: 2,
      limit: 10,
      offset: 10,
    });
  });

  it('rejects garbage page', () => {
    assert.throws(() => parsePagination({ page: 'abc' }), (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    });
  });

  it('rejects limit above max', () => {
    assert.throws(() => parsePagination({ limit: '999' }), (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 422);
      return true;
    });
  });

  it('rejects non-positive limit', () => {
    assert.throws(() => parsePagination({ limit: '0' }), AppError);
  });
});
