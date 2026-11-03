import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-schema-'));
  return { dir, file: path.join(dir, 'monitor.db') };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('fresh database initializes at schema version 1', () => {
  const { dir, file } = makeTempDb();
  const db = new Database(file);
  try {
    initSchema(db, file);
    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
    assert.equal(version, 1);

    const appColumns = db.prepare('PRAGMA table_info(applications)').all().map((c) => c.name);
    assert.ok(appColumns.includes('api_key'));
    assert.ok(appColumns.includes('default_model'));
    assert.ok(appColumns.includes('updated_at'));
  } finally {
    db.close();
    cleanup(dir);
  }
});

test('legacy database is migrated, backed up, and keeps its rows', () => {
  const { dir, file } = makeTempDb();
  const db = new Database(file);
  try {
    db.exec(`
      CREATE TABLE applications (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT);
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        trace_id TEXT,
        application_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        call_type TEXT NOT NULL,
        status TEXT NOT NULL,
        is_streaming INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        tokens_estimated INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL,
        cost_status TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        error_type TEXT,
        error_message TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT
      );
    `);
    db.prepare('INSERT INTO applications (id, name) VALUES (?, ?)').run('legacy', 'Legacy App');

    initSchema(db, file);

    const appColumns = db.prepare('PRAGMA table_info(applications)').all().map((c) => c.name);
    assert.ok(appColumns.includes('api_key'));
    assert.deepEqual(
      db.prepare('SELECT id, name FROM applications').get(),
      { id: 'legacy', name: 'Legacy App' }
    );

    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.equal(backups.length, 1);
    assert.ok(backups[0].endsWith('.db'));
  } finally {
    db.close();
    cleanup(dir);
  }
});

test('initSchema is idempotent and does not create a second backup', () => {
  const { dir, file } = makeTempDb();
  const db = new Database(file);
  try {
    initSchema(db, file);
    initSchema(db, file);

    const migrations = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
    assert.equal(migrations, 1);
    assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  } finally {
    db.close();
    cleanup(dir);
  }
});
