/**
 * SQLite Schema Initialization & Versioned Migrations
 */
import fs from 'fs';
import path from 'path';

const SCHEMA_VERSION = 1;
const BACKUPS_TO_KEEP = 5;

const BASE_SCHEMA = `
  -- 1. Applications Table
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  -- 2. Model Pricing Versioned Table
  CREATE TABLE IF NOT EXISTS model_pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_pattern TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_cost_per_million REAL NOT NULL,
    output_cost_per_million REAL NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  -- 3. Usage Events Table
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    trace_id TEXT,
    application_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    is_streaming INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    tokens_estimated INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL,
    cost_status TEXT NOT NULL CHECK(cost_status IN ('confirmed_by_provider', 'estimated', 'unknown')),
    latency_ms REAL NOT NULL,
    prompt_eval_duration_ms REAL DEFAULT 0.0,
    eval_duration_ms REAL DEFAULT 0.0,
    load_duration_ms REAL DEFAULT 0.0,
    cache_status TEXT DEFAULT 'n/a',
    error_type TEXT,
    error_message TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
  );

  -- Performance Indexes
  CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_events_provider ON usage_events(provider, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_events_status ON usage_events(status, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_events_app ON usage_events(application_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_events_app_cost ON usage_events(application_id, estimated_cost, total_tokens);
  CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern, effective_from);

  -- 4. Global Settings Table (Active Model, Gateway Configuration)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  -- 5. Custom & Cloud Models Table (User-Configured Cloud/API Endpoints)
  CREATE TABLE IF NOT EXISTS custom_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_base TEXT NOT NULL,
    api_key TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  -- 6. Applied schema migrations
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`;

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function columnExists(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (columnExists(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function getAppliedVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  return row?.version || 0;
}

function recordVersion(db, version) {
  db.prepare('INSERT OR REPLACE INTO schema_migrations (version) VALUES (?)').run(version);
}

function pruneBackups(dir) {
  const backups = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => ({ file, mtime: fs.statSync(path.join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { file } of backups.slice(BACKUPS_TO_KEEP)) {
    fs.unlinkSync(path.join(dir, file));
  }
}

function backupBeforeMigration(db, dbPath) {
  const resolved = path.resolve(dbPath);
  const backupDir = path.join(path.dirname(resolved), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(resolved, path.extname(resolved));
  const destination = path.join(backupDir, `${baseName}-${stamp}.db`);
  const escaped = destination.replace(/'/g, "''");

  // Fail closed: do not migrate a database we could not back up first.
  db.exec(`VACUUM INTO '${escaped}'`);
  console.log(`[SCHEMA] Pre-migration backup created at ${destination}`);
  pruneBackups(backupDir);
}

export function initSchema(db, dbPath = process.env.DATABASE_PATH || './data/monitor.db') {
  const isExistingDatabase = tableExists(db, 'applications');

  db.exec(BASE_SCHEMA);

  const currentVersion = getAppliedVersion(db);
  if (isExistingDatabase && currentVersion < SCHEMA_VERSION) {
    backupBeforeMigration(db, dbPath);
  }

  // Migration 1: columns added after the original schema.
  addColumn(db, 'usage_events', 'prompt_eval_duration_ms', 'REAL DEFAULT 0.0');
  addColumn(db, 'usage_events', 'eval_duration_ms', 'REAL DEFAULT 0.0');
  addColumn(db, 'usage_events', 'load_duration_ms', 'REAL DEFAULT 0.0');
  addColumn(db, 'usage_events', 'cache_status', "TEXT DEFAULT 'n/a'");
  addColumn(db, 'applications', 'api_key', 'TEXT');
  addColumn(db, 'applications', 'default_model', "TEXT DEFAULT 'active-model'");
  addColumn(db, 'applications', 'updated_at', 'TEXT');

  // A legacy database may contain duplicate API keys; that is a data problem,
  // not a reason to refuse to start.
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_api_key ON applications(api_key) WHERE api_key IS NOT NULL');
  } catch (err) {
    console.error('[SCHEMA] Could not create unique applications.api_key index (duplicate keys present?):', err.message);
  }

  recordVersion(db, SCHEMA_VERSION);
  console.log(`[SCHEMA] Database schema is at version ${SCHEMA_VERSION}.`);
}
