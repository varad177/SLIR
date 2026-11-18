import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { AnalyticsService } from '../src/db/analyticsQueries.js';
import {
  clearBudgetCaches,
  evaluateBudgets,
  getBlockingBudget,
  getBudgetPeriod,
  getBudgetUsage
} from '../src/services/budgetService.js';

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-budgets-'));
  const file = path.join(dir, 'monitor.db');
  const db = new Database(file);
  initSchema(db, file);
  db.prepare("INSERT INTO applications (id, name, api_key) VALUES ('app_budget', 'Budget App', 'key_budget')").run();
  return { db, dir };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function insertEvent(db, overrides = {}) {
  const result = db.prepare(`
    INSERT INTO usage_events (
      request_id, application_id, provider, model, call_type, status,
      is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
      estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
      load_duration_ms, cache_status, http_status, timestamp
    ) VALUES (?, ?, ?, ?, 'chat.completion', ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 200, ?)
  `).run(
    overrides.request_id || `req-${Math.random().toString(36).slice(2, 12)}`,
    overrides.application_id ?? 'app_budget',
    overrides.provider || 'ollama',
    overrides.model || 'ollama/qwen2.5:3b',
    overrides.status || 'success',
    overrides.prompt_tokens ?? 100,
    overrides.completion_tokens ?? 50,
    overrides.total_tokens ?? 150,
    overrides.estimated_cost ?? 1,
    overrides.cost_status || 'estimated',
    overrides.latency_ms ?? 100,
    overrides.prompt_eval_duration_ms ?? null,
    overrides.eval_duration_ms ?? null,
    overrides.load_duration_ms ?? null,
    overrides.cache_status ?? 'standard',
    overrides.timestamp || new Date().toISOString()
  );
  return Number(result.lastInsertRowid);
}

function insertBudget(db, overrides = {}) {
  const budget = {
    name: 'Daily cloud spend',
    scope_type: 'global',
    application_id: null,
    model: null,
    period: 'daily',
    metric: 'cost',
    limit_value: 10,
    warn_percent: 80,
    action: 'notify',
    enabled: 1,
    ...overrides
  };
  const result = db.prepare(`
    INSERT INTO budgets (
      name, scope_type, application_id, model, period, metric,
      limit_value, warn_percent, action, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    budget.name, budget.scope_type, budget.application_id, budget.model,
    budget.period, budget.metric, budget.limit_value, budget.warn_percent,
    budget.action, budget.enabled
  );
  return Number(result.lastInsertRowid);
}

test('getBudgetPeriod returns UTC day and month windows', () => {
  const now = new Date('2026-11-18T13:45:00.000Z');
  const daily = getBudgetPeriod('daily', now);
  assert.equal(daily.key, '2026-11-18');
  assert.equal(daily.startIso, '2026-11-18T00:00:00.000Z');
  assert.equal(daily.endIso, '2026-11-19T00:00:00.000Z');

  const monthly = getBudgetPeriod('monthly', now);
  assert.equal(monthly.key, '2026-11');
  assert.equal(monthly.startIso, '2026-11-01T00:00:00.000Z');
  assert.equal(monthly.endIso, '2026-12-01T00:00:00.000Z');
});

test('evaluateBudgets fires warning then exceeded once per period', async () => {
  const { db, dir } = makeDb();
  try {
    const budgetId = insertBudget(db);
    const delivered = [];
    const deliver = async (_db, alert) => { delivered.push(alert); };

    insertEvent(db, { estimated_cost: 8.5 });
    let result = await evaluateBudgets(db, { deliver });
    assert.equal(result.created, 1);
    assert.equal(delivered[0].threshold, 'warning');

    result = await evaluateBudgets(db, { deliver });
    assert.equal(result.created, 0, 'warning must not fire twice in the same period');

    insertEvent(db, { estimated_cost: 2 });
    result = await evaluateBudgets(db, { deliver });
    assert.equal(result.created, 1);
    assert.equal(delivered[1].threshold, 'exceeded');
    assert.equal(delivered[1].budget_id, budgetId);

    const alerts = db.prepare('SELECT * FROM budget_alerts ORDER BY id').all();
    assert.equal(alerts.length, 2);
    assert.deepEqual(alerts.map(a => a.threshold), ['warning', 'exceeded']);
  } finally {
    db.close();
    cleanup(dir);
  }
});

test('budget scopes only count matching application and model traffic', async () => {
  const { db, dir } = makeDb();
  try {
    db.prepare("INSERT INTO applications (id, name, api_key) VALUES ('app_other', 'Other App', 'key_other')").run();
    insertEvent(db, { application_id: 'app_budget', model: 'ollama/llama3:8b', estimated_cost: 6 });
    insertEvent(db, { application_id: 'app_other', model: 'ollama/qwen2.5:3b', estimated_cost: 100 });

    const appBudget = insertBudget(db, {
      name: 'App spend',
      scope_type: 'application',
      application_id: 'app_budget',
      limit_value: 10
    });
    const modelBudget = insertBudget(db, {
      name: 'Model tokens',
      scope_type: 'model',
      model: 'ollama/qwen2.5:3b',
      metric: 'tokens',
      limit_value: 1000
    });

    const appUsage = getBudgetUsage(db, db.prepare('SELECT * FROM budgets WHERE id = ?').get(appBudget));
    assert.equal(appUsage.value, 6);

    const modelUsage = getBudgetUsage(db, db.prepare('SELECT * FROM budgets WHERE id = ?').get(modelBudget));
    assert.equal(modelUsage.value, 150);

    const delivered = [];
    await evaluateBudgets(db, { deliver: async (_db, alert) => delivered.push(alert) });
    assert.equal(delivered.length, 0);
  } finally {
    db.close();
    cleanup(dir);
  }
});

test('getBlockingBudget only returns exceeded block-action budgets and caches results', async () => {
  const { db, dir } = makeDb();
  try {
    clearBudgetCaches();
    insertBudget(db, {
      name: 'Hard cap',
      limit_value: 5,
      action: 'block'
    });
    insertBudget(db, {
      name: 'Soft cap',
      limit_value: 5,
      action: 'notify'
    });
    insertEvent(db, { estimated_cost: 6 });

    const blocking = getBlockingBudget(db, 'app_budget', 'ollama/qwen2.5:3b');
    assert.ok(blocking);
    assert.equal(blocking.name, 'Hard cap');
    assert.equal(blocking.percentage, 120);

    // Cached: clearing the budget should not be observed until cache invalidation.
    db.prepare('DELETE FROM budgets').run();
    const cached = getBlockingBudget(db, 'app_budget', 'ollama/qwen2.5:3b');
    assert.ok(cached);

    clearBudgetCaches();
    assert.equal(getBlockingBudget(db, 'app_budget', 'ollama/qwen2.5:3b'), null);
  } finally {
    clearBudgetCaches();
    db.close();
    cleanup(dir);
  }
});

test('analytics summary exposes latency percentiles, cache hit rate and cost projection', () => {
  const { db, dir } = makeDb();
  try {
    const analytics = new AnalyticsService(db);
    for (let i = 1; i <= 10; i += 1) {
      insertEvent(db, {
        request_id: `pct-${i}`,
        latency_ms: i * 10,
        cache_status: i <= 3 ? 'cache_hit' : i <= 5 ? 'standard' : 'n/a',
        estimated_cost: 1
      });
    }

    const summary = analytics.getSummary({});
    assert.equal(summary.totalRequests, 10);
    assert.equal(summary.latencyP50Ms, 50);
    assert.equal(summary.latencyP95Ms, 100);
    assert.equal(summary.cacheHitRate, 60);
    assert.equal(summary.cacheHitRequests, 3);
    assert.ok(summary.burnRatePerDay > 0);
    assert.ok(summary.projected30dCost > 0);

    const [model] = analytics.getModelBreakdown({});
    assert.equal(model.p95LatencyMs, 100);
    assert.equal(model.cacheHitRate, 60);

    const series = analytics.getTimeSeries({ interval: 'day' });
    assert.equal(series.length, 1);
    assert.equal(series[0].cacheHits, 3);
    assert.equal(series[0].cacheHitRate, 60);
  } finally {
    db.close();
    cleanup(dir);
  }
});
