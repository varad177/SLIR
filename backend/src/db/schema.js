/**
 * SQLite Schema Initialization & Versioned Migrations
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'node:crypto';

const SCHEMA_VERSION = 4;
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
    http_status INTEGER,
    client_model TEXT,
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
    context_window INTEGER,
    max_output_tokens INTEGER,
    input_cost_per_million REAL,
    output_cost_per_million REAL,
    timeout_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  -- 6. Cost Budgets (global, per application, or per model)
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'application', 'model')),
    application_id TEXT,
    model TEXT,
    period TEXT NOT NULL CHECK(period IN ('daily', 'monthly')),
    metric TEXT NOT NULL CHECK(metric IN ('cost', 'tokens', 'requests')),
    limit_value REAL NOT NULL,
    warn_percent INTEGER NOT NULL DEFAULT 80,
    action TEXT NOT NULL DEFAULT 'notify' CHECK(action IN ('notify', 'block')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  -- 7. Budget threshold alerts (deduplicated per budget, period and threshold)
  CREATE TABLE IF NOT EXISTS budget_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_id INTEGER NOT NULL,
    period_key TEXT NOT NULL,
    threshold TEXT NOT NULL CHECK(threshold IN ('warning', 'exceeded')),
    usage_value REAL NOT NULL,
    limit_value REAL NOT NULL,
    message TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    delivery_status TEXT NOT NULL DEFAULT 'pending',
    delivery_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(budget_id, period_key, threshold),
    FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_budget_alerts_created ON budget_alerts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_budget_alerts_ack ON budget_alerts(acknowledged, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(enabled, scope_type);

  -- 8. Applied schema migrations
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
  // SQLite accepts forward slashes on every platform; this also avoids
  // Windows backslashes being interpreted as SQL escape sequences.
  const escaped = destination.replace(/\\/g, '/').replace(/'/g, "''");

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

  // Migration 2: real gateway status/requested model for logs, plus richer
  // custom-model metadata used by the model editor and add-model flow.
  addColumn(db, 'usage_events', 'http_status', 'INTEGER');
  addColumn(db, 'usage_events', 'client_model', 'TEXT');
  addColumn(db, 'custom_models', 'context_window', 'INTEGER');
  addColumn(db, 'custom_models', 'max_output_tokens', 'INTEGER');
  addColumn(db, 'custom_models', 'input_cost_per_million', 'REAL');
  addColumn(db, 'custom_models', 'output_cost_per_million', 'REAL');
  addColumn(db, 'custom_models', 'timeout_ms', 'INTEGER');

  // Migration 3: per-application automatic failover configuration and the
  // routing trace attached to the single resulting usage event.
  addColumn(db, 'applications', 'failover_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'applications', 'fallback_models', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'usage_events', 'failover_used', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'usage_events', 'failover_from_model', 'TEXT');
  addColumn(db, 'usage_events', 'failover_reason', 'TEXT');
  addColumn(db, 'usage_events', 'failover_attempts', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'usage_events', 'failover_trace', 'TEXT');

  // A legacy database may contain duplicate API keys, which makes API-key
  // lookup ambiguous. Keep the oldest application for each key and issue a
  // fresh key for later duplicates, then enforce uniqueness at the DB level.
  try {
    const duplicates = db.prepare(`
      SELECT api_key
      FROM applications
      WHERE api_key IS NOT NULL AND TRIM(api_key) != ''
      GROUP BY api_key
      HAVING COUNT(*) > 1
    `).all();

    const updateKey = db.prepare('UPDATE applications SET api_key = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const { api_key: duplicateKey } of duplicates) {
      const apps = db.prepare(
        'SELECT id FROM applications WHERE api_key = ? ORDER BY created_at ASC, id ASC'
      ).all(duplicateKey);
      for (const app of apps.slice(1)) {
        updateKey.run(`mp_live_${randomBytes(16).toString('hex')}`, now, app.id);
      }
      console.warn(`[SCHEMA] Repaired duplicate API key for ${apps.length - 1} application(s).`);
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_api_key ON applications(api_key) WHERE api_key IS NOT NULL');
  } catch (err) {
    console.error('[SCHEMA] Could not enforce unique applications.api_key index:', err.message);
  }

  recordVersion(db, SCHEMA_VERSION);
  console.log(`[SCHEMA] Database schema is at version ${SCHEMA_VERSION}.`);
}
