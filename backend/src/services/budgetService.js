/**
 * Budget evaluation for cost, token and request limits.
 *
 * A budget is evaluated against the current UTC day or month. Alerts are
 * deduplicated per period via the unique key on `budget_alerts`, so a warning
 * or exceeded threshold fires at most once per budget per period.
 */

import { deliverAlert } from './alertService.js';

const METRIC_SQL = {
  cost: 'COALESCE(SUM(estimated_cost), 0)',
  tokens: 'COALESCE(SUM(total_tokens), 0)',
  requests: 'COUNT(*)'
};

const blockCache = new Map();
const BLOCK_CACHE_TTL_MS = 10 * 1000;
const NEGATIVE_CACHE_TTL_MS = 2 * 1000;

export function clearBudgetCaches() {
  blockCache.clear();
}

export function getBudgetPeriod(period, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  if (period === 'monthly') {
    const start = Date.UTC(year, month, 1);
    const end = Date.UTC(year, month + 1, 1);
    return {
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      startMs: start,
      endMs: end,
      startIso: new Date(start).toISOString(),
      endIso: new Date(end).toISOString()
    };
  }

  const start = Date.UTC(year, month, day);
  const end = start + 24 * 60 * 60 * 1000;
  return {
    key: new Date(start).toISOString().slice(0, 10),
    startMs: start,
    endMs: end,
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString()
  };
}

function scopeConditions(budget, params) {
  const conditions = [];
  if (budget.scope_type === 'application' && budget.application_id) {
    conditions.push('application_id = ?');
    params.push(budget.application_id);
  }
  if (budget.scope_type === 'model' && budget.model) {
    conditions.push('model = ?');
    params.push(budget.model);
  }
  return conditions;
}

export function getBudgetUsage(db, budget, now = new Date()) {
  const { startIso, endIso, key } = getBudgetPeriod(budget.period, now);
  const params = [startIso, endIso];
  const conditions = ['timestamp >= ?', 'timestamp < ?', ...scopeConditions(budget, params)];
  const metricSql = METRIC_SQL[budget.metric] || METRIC_SQL.cost;

  const row = db.prepare(`
    SELECT ${metricSql} AS value
    FROM usage_events
    WHERE ${conditions.join(' AND ')}
  `).get(...params);

  return {
    value: Number(row?.value) || 0,
    periodKey: key,
    periodStart: startIso,
    periodEnd: endIso
  };
}

export function describeBudgetScope(budget) {
  if (budget.scope_type === 'application') return `application ${budget.application_id}`;
  if (budget.scope_type === 'model') return `model ${budget.model}`;
  return 'all applications';
}

export function formatBudgetValue(metric, value) {
  if (!Number.isFinite(value)) return '0';
  if (metric === 'cost') return `$${value.toFixed(4)}`;
  return Math.round(value).toLocaleString('en-US');
}

function buildProjection(budget, usage, now) {
  const period = getBudgetPeriod(budget.period, now);
  const totalMs = period.endMs - period.startMs;
  const actualElapsedMs = Math.max(1, now.getTime() - period.startMs);
  const minimumElapsedMs = Math.max(60 * 1000, totalMs * 0.1);
  const elapsedMs = Math.max(actualElapsedMs, minimumElapsedMs);
  const ratio = totalMs / elapsedMs;
  const projected = usage.value * ratio;
  return {
    projectedValue: budget.metric === 'requests' ? Math.round(projected) : Math.round(projected * 10000) / 10000,
    projectedUsage: budget.metric === 'requests' ? Math.round(usage.value) : Math.round(usage.value * 10000) / 10000,
    percent: budget.limit_value > 0 ? Math.round((usage.value / budget.limit_value) * 1000) / 10 : 0,
    projectedPercent: budget.limit_value > 0 ? Math.round((projected / budget.limit_value) * 1000) / 10 : 0,
    projectionReliable: actualElapsedMs >= minimumElapsedMs
  };
}

export function enrichBudget(db, budget, now = new Date()) {
  const usage = getBudgetUsage(db, budget, now);
  return {
    ...budget,
    enabled: Boolean(budget.enabled),
    usage: usage.value,
    periodKey: usage.periodKey,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    ...buildProjection(budget, usage, now)
  };
}

/**
 * Evaluates every enabled budget and persists/delivers newly crossed
 * thresholds. Safe to call repeatedly: deduplication happens in SQL.
 */
export async function evaluateBudgets(db, { now = new Date(), deliver = deliverAlert } = {}) {
  let budgets = [];
  try {
    budgets = db.prepare('SELECT * FROM budgets WHERE enabled = 1').all();
  } catch (err) {
    console.error('[BUDGETS] Could not load budgets:', err.message);
    return { evaluated: 0, created: 0 };
  }

  const createdAlerts = [];
  for (const budget of budgets) {
    try {
      if (!(budget.limit_value > 0)) continue;
      const usage = getBudgetUsage(db, budget, now);
      const percent = (usage.value / budget.limit_value) * 100;

      let threshold = null;
      if (percent >= 100) threshold = 'exceeded';
      else if (percent >= (budget.warn_percent || 80)) threshold = 'warning';
      if (!threshold) continue;

      const message = `"${budget.name}" ${threshold === 'exceeded' ? 'exceeded' : 'is approaching'} its ${budget.period} ${budget.metric} budget: `
        + `${formatBudgetValue(budget.metric, usage.value)} of ${formatBudgetValue(budget.metric, budget.limit_value)} `
        + `(${Math.round(percent * 10) / 10}%, ${describeBudgetScope(budget)}).`;

      const insert = db.prepare(`
        INSERT OR IGNORE INTO budget_alerts (
          budget_id, period_key, threshold, usage_value, limit_value, message
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(budget.id, usage.periodKey, threshold, usage.value, budget.limit_value, message);

      if (insert.changes > 0) {
        const alert = db.prepare('SELECT * FROM budget_alerts WHERE id = ?').get(insert.lastInsertRowid);
        createdAlerts.push(alert);
        await deliver(db, alert, budget);
      }
    } catch (err) {
      console.error(`[BUDGETS] Failed to evaluate budget ${budget.id}:`, err.message);
    }
  }

  return { evaluated: budgets.length, created: createdAlerts.length, alerts: createdAlerts };
}

/**
 * Returns an exceeded hard-block budget for a gateway request, if any.
 * Results are cached briefly because this runs on every attributed request.
 */
export function getBlockingBudget(db, applicationId, eventModel, now = new Date()) {
  if (!applicationId) return null;

  const cacheKey = `${applicationId}|${eventModel || ''}`;
  const cached = blockCache.get(cacheKey);
  if (cached) {
    const ttl = cached.budget ? BLOCK_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (now.getTime() - cached.at < ttl) return cached.budget;
    blockCache.delete(cacheKey);
  }

  let budgets = [];
  try {
    budgets = db.prepare("SELECT * FROM budgets WHERE enabled = 1 AND action = 'block'").all();
  } catch {
    return null;
  }

  let blocking = null;
  for (const budget of budgets) {
    const matchesScope =
      budget.scope_type === 'global' ||
      (budget.scope_type === 'application' && budget.application_id === applicationId) ||
      (budget.scope_type === 'model' && budget.model === eventModel);
    if (!matchesScope) continue;

    const usage = getBudgetUsage(db, budget, now);
    if (budget.limit_value > 0 && usage.value >= budget.limit_value) {
      blocking = {
        id: budget.id,
        name: budget.name,
        metric: budget.metric,
        period: budget.period,
        usage: usage.value,
        limit: budget.limit_value,
        percentage: Math.round((usage.value / budget.limit_value) * 1000) / 10
      };
      break;
    }
  }

  blockCache.set(cacheKey, { at: now.getTime(), budget: blocking });
  return blocking;
}
