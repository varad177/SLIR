import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCircuitBreakers,
  executeModelAttempt
} from '../src/services/gatewayFailover.js';

const unreachableModel = {
  model_id: 'circuit-model',
  provider: 'mock',
  api_base: 'http://127.0.0.1:9/v1',
  timeout_ms: 200
};

const fakeDb = {
  prepare() {
    return {
      get() {
        return unreachableModel;
      }
    };
  }
};

test('circuit breaker opens after repeated network failures and skips upstream calls', async () => {
  clearCircuitBreakers();

  let lastResult;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    lastResult = await executeModelAttempt(fakeDb, 'circuit-model', { messages: [] });
    assert.equal(lastResult.ok, false);
    assert.notEqual(lastResult.reason, 'circuit_open');
  }

  const startedAt = Date.now();
  const blocked = await executeModelAttempt(fakeDb, 'circuit-model', { messages: [] });
  const elapsed = Date.now() - startedAt;

  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'circuit_open');
  assert.equal(blocked.status, 503);
  assert.ok(elapsed < 100, `expected circuit-open fast path, took ${elapsed}ms`);

  clearCircuitBreakers();
});
