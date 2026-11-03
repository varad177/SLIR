import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { pruneOldEvents } from '../src/db/retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function insertEvent(db, requestId, timestamp) {
  db.prepare(`
    INSERT INTO usage_events (
      request_id, provider, model, call_type, status, is_streaming,
      prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
      estimated_cost, cost_status, latency_ms, timestamp
    ) VALUES (?, 'ollama', 'ollama/qwen', 'chat.completion', 'success', 0,
      1, 1, 2, 0, 0, 'estimated', 10, ?)
  `).run(requestId, timestamp);
}

test('pruneOldEvents deletes only events older than the retention window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-retention-'));
  const file = path.join(dir, 'monitor.db');
  const db = new Database(file);

  try {
    initSchema(db, file);
    const old = new Date(Date.now() - 40 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - 2 * DAY_MS).toISOString();
    insertEvent(db, 'old-event', old);
    insertEvent(db, 'recent-event', recent);

    assert.equal(pruneOldEvents(db, 30), 1);
    const remaining = db.prepare('SELECT request_id FROM usage_events').all().map((r) => r.request_id);
    assert.deepEqual(remaining, ['recent-event']);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RETENTION_DAYS=0 keeps events forever', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-retention-'));
  const file = path.join(dir, 'monitor.db');
  const db = new Database(file);

  try {
    initSchema(db, file);
    insertEvent(db, 'old-event', new Date(Date.now() - 400 * DAY_MS).toISOString());

    assert.equal(pruneOldEvents(db, 0), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
