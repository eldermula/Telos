'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { rehydrateRunningRuntimes } = require('./trading-engine');

describe('rehydrateRunningRuntimes', () => {
  test('starts a runtime for each running instance and refreshes cache', async () => {
    const started = [];
    const cached = [];
    const results = await rehydrateRunningRuntimes({
      listRunning: async () => [
        { id: 'b1', status: 'running' },
        { id: 'b2', status: 'running' },
      ],
      startRuntime: async (instance) => {
        started.push(instance.id);
        return { _halted: false };
      },
      findById: async (id) => ({ id, status: 'running' }),
      setStatus: async (row) => {
        cached.push(row.id);
        return row;
      },
    });

    assert.deepEqual(started, ['b1', 'b2']);
    assert.deepEqual(cached, ['b1', 'b2']);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok && r.status === 'running' && r.halted === false));
  });

  test('isolates per-instance failure — others still rehydrate', async () => {
    const started = [];
    const results = await rehydrateRunningRuntimes({
      listRunning: async () => [
        { id: 'ok', status: 'running' },
        { id: 'bad', status: 'running' },
        { id: 'ok2', status: 'running' },
      ],
      startRuntime: async (instance) => {
        if (instance.id === 'bad') throw new Error('boom');
        started.push(instance.id);
        return { _halted: false };
      },
      findById: async (id) => ({ id, status: 'running' }),
      setStatus: async (row) => row,
    });

    assert.deepEqual(started, ['ok', 'ok2']);
    assert.equal(results.filter((r) => r.ok).length, 2);
    const failed = results.find((r) => r.id === 'bad');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /boom/);
  });

  test('empty running set is a no-op', async () => {
    const results = await rehydrateRunningRuntimes({
      listRunning: async () => [],
      startRuntime: async () => {
        throw new Error('should not start');
      },
    });
    assert.deepEqual(results, []);
  });

  test('E.7 halt during initialize is reported without throwing', async () => {
    const results = await rehydrateRunningRuntimes({
      listRunning: async () => [{ id: 'real-halt', status: 'running' }],
      startRuntime: async () => ({ _halted: true }),
      findById: async () => ({ id: 'real-halt', status: 'error' }),
      setStatus: async (row) => row,
    });
    assert.equal(results[0].ok, true);
    assert.equal(results[0].halted, true);
    assert.equal(results[0].status, 'error');
  });
});