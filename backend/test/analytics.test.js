import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { AnalyticsService } from '../src/db/analyticsQueries.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-analytics-'));
  const file = path.join(dir, 'monitor.db');
  return { dir, file };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function insertEvent(db, overrides = {}) {
  const result = db.prepare(`
    INSERT INTO usage_events (
      request_id, trace_id, application_id, provider, model, call_type, status,
      is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
      estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
      load_duration_ms, cache_status, error_type, error_message, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.request_id || `req-${Math.random().toString(36).slice(2, 12)}`,
    overrides.trace_id || null,
    overrides.application_id || null,
    overrides.provider || 'ollama',
    overrides.model || 'qwen2.5:3b',
    'chat.completion',
    overrides.status || 'success',
    overrides.is_streaming || 0,
    overrides.prompt_tokens || 0,
    overrides.completion_tokens || 0,
    overrides.total_tokens || 0,
    overrides.tokens_estimated || 0,
    overrides.estimated_cost || 0,
    'confirmed_by_provider',
    overrides.latency_ms || 100,
    null,
    null,
    overrides.load_duration_ms || null,
    overrides.cache_status || null,
    overrides.error_type || null,
    overrides.error_message || null,
    overrides.timestamp || new Date().toISOString()
  );
  return Number(result.lastInsertRowid);
}

test('request search and failure status filters query usage events', () => {
  const { dir, file } = makeTempDb();
  const db = new Database(file);
  const analytics = new AnalyticsService(db);
  try {
    initSchema(db, file);

    const successId = insertEvent(db, { request_id: 'req_success_alpha', model: 'qwen2.5:3b' });
    const failId = insertEvent(db, {
      request_id: 'req_missing_beta',
      model: 'qwen2.5:7b',
      status: 'failure',
      error_type: 'upstream_500',
      error_message: 'Upstream provider exploded'
    });

    const failures = analytics.getRequests({ status: 'failure', page: 1, limit: 50 });
    assert.equal(failures.pagination.total, 1);
    assert.equal(failures.items[0].id, failId);
    assert.equal(failures.items[0].status, 'failure');
    assert.equal(failures.items[0].error_message, 'Upstream provider exploded');

    const found = analytics.getRequests({ search: 'req_missing_beta', page: 1, limit: 50 });
    assert.equal(found.pagination.total, 1);
    assert.equal(found.items[0].request_id, 'req_missing_beta');

    const byModel = analytics.getRequests({ model: 'qwen2.5:7b', page: 1, limit: 50 });
    assert.equal(byModel.pagination.total, 1);
    assert.equal(byModel.items[0].id, failId);

    assert.ok(successId > 0);
  } finally {
    db.close();
    cleanup(dir);
  }
});
