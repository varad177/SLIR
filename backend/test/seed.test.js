import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { seedDefaultData } from '../src/db/seed.js';

function withDatabase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-seed-'));
  const file = path.join(dir, 'monitor.db');
  const db = new Database(file);
  try {
    initSchema(db, file);
    fn(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('seedDefaultData preserves historical model names', () => {
  withDatabase((db) => {
    db.prepare(`
      INSERT INTO usage_events (
        request_id, provider, model, call_type, status, is_streaming,
        prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
        estimated_cost, cost_status, latency_ms, timestamp
      ) VALUES ('historical', 'ollama', 'active-model', 'chat.completion', 'success', 0,
        1, 1, 2, 0, 0, 'estimated', 10, '2024-01-01T00:00:00.000Z')
    `).run();

    seedDefaultData(db);

    const row = db.prepare('SELECT model, provider FROM usage_events WHERE request_id = ?').get('historical');
    assert.deepEqual(row, { model: 'active-model', provider: 'ollama' });
  });
});

test('seedDefaultData creates a starter application only on first setup', () => {
  withDatabase((db) => {
    seedDefaultData(db);
    const first = db.prepare('SELECT id, api_key, default_model FROM applications').all();
    assert.equal(first.length, 1);
    assert.equal(first[0].id, 'app_sensorbot');
    assert.match(first[0].api_key, /^mp_live_/);
    assert.equal(first[0].default_model, 'active-model');

    db.prepare('DELETE FROM applications').run();
    seedDefaultData(db);

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM applications').get().count, 0);
  });
});
