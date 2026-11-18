import { Router } from 'express';
import {
  enrichBudget,
  clearBudgetCaches
} from '../services/budgetService.js';
import {
  getAlertSettings,
  saveAlertSettings,
  sendTestAlert
} from '../services/alertService.js';

const SCOPES = new Set(['global', 'application', 'model']);
const PERIODS = new Set(['daily', 'monthly']);
const METRICS = new Set(['cost', 'tokens', 'requests']);
const ACTIONS = new Set(['notify', 'block']);

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateBudgetPayload(payload, existing = null) {
  const merged = {
    name: payload.name ?? existing?.name,
    scope_type: payload.scope_type ?? existing?.scope_type,
    application_id: payload.application_id !== undefined ? payload.application_id : existing?.application_id,
    model: payload.model !== undefined ? payload.model : existing?.model,
    period: payload.period ?? existing?.period,
    metric: payload.metric ?? existing?.metric,
    limit_value: payload.limit_value !== undefined ? payload.limit_value : existing?.limit_value,
    warn_percent: payload.warn_percent !== undefined ? payload.warn_percent : existing?.warn_percent,
    action: payload.action ?? existing?.action,
    enabled: payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : existing?.enabled
  };

  const errors = [];
  if (!merged.name || !String(merged.name).trim()) errors.push('name is required');
  if (!SCOPES.has(merged.scope_type)) errors.push('scope_type must be global, application or model');
  if (!PERIODS.has(merged.period)) errors.push('period must be daily or monthly');
  if (!METRICS.has(merged.metric)) errors.push('metric must be cost, tokens or requests');
  if (!ACTIONS.has(merged.action)) errors.push('action must be notify or block');

  const limit = asFiniteNumber(merged.limit_value);
  if (limit === null || limit <= 0) errors.push('limit_value must be a positive number');

  const warn = merged.warn_percent === undefined || merged.warn_percent === null
    ? 80
    : asFiniteNumber(merged.warn_percent);
  if (warn === null || warn < 1 || warn > 100) errors.push('warn_percent must be between 1 and 100');

  if (merged.scope_type === 'application' && !merged.application_id) {
    errors.push('application_id is required for application-scoped budgets');
  }
  if (merged.scope_type === 'model' && !merged.model) {
    errors.push('model is required for model-scoped budgets');
  }

  if (errors.length > 0) return { error: errors.join('; ') };

  return {
    value: {
      name: String(merged.name).trim(),
      scope_type: merged.scope_type,
      application_id: merged.scope_type === 'application' ? String(merged.application_id) : null,
      model: merged.scope_type === 'model' ? String(merged.model) : null,
      period: merged.period,
      metric: merged.metric,
      limit_value: limit,
      warn_percent: Math.round(warn),
      action: merged.action,
      enabled: merged.enabled === undefined ? 1 : (merged.enabled ? 1 : 0)
    }
  };
}

export function createBudgetsRouter(db) {
  const router = Router();

  router.get('/budgets', (req, res) => {
    try {
      const budgets = db.prepare(`
        SELECT b.*, COALESCE(a.name, b.application_id) AS application_name
        FROM budgets b
        LEFT JOIN applications a ON a.id = b.application_id
        ORDER BY b.enabled DESC, b.id DESC
      `).all();
      res.json({ success: true, budgets: budgets.map((budget) => enrichBudget(db, budget)) });
    } catch (err) {
      console.error('[BUDGETS] Failed to list budgets:', err);
      res.status(500).json({ error: 'Failed to retrieve budgets' });
    }
  });

  router.post('/budgets', (req, res) => {
    try {
      const validation = validateBudgetPayload(req.body || {});
      if (validation.error) return res.status(400).json({ error: validation.error });

      if (validation.value.scope_type === 'application') {
        const app = db.prepare('SELECT id FROM applications WHERE id = ?').get(validation.value.application_id);
        if (!app) return res.status(400).json({ error: 'Application not found' });
      }

      const budget = validation.value;
      const result = db.prepare(`
        INSERT INTO budgets (
          name, scope_type, application_id, model, period, metric,
          limit_value, warn_percent, action, enabled, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      `).run(
        budget.name, budget.scope_type, budget.application_id, budget.model,
        budget.period, budget.metric, budget.limit_value, budget.warn_percent,
        budget.action, budget.enabled
      );

      clearBudgetCaches();
      const created = db.prepare('SELECT * FROM budgets WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json({ success: true, budget: enrichBudget(db, created) });
    } catch (err) {
      console.error('[BUDGETS] Failed to create budget:', err);
      res.status(500).json({ error: 'Failed to create budget' });
    }
  });

  router.patch('/budgets/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Budget not found' });

      const validation = validateBudgetPayload(req.body || {}, existing);
      if (validation.error) return res.status(400).json({ error: validation.error });
      const budget = validation.value;

      db.prepare(`
        UPDATE budgets SET
          name = ?, scope_type = ?, application_id = ?, model = ?,
          period = ?, metric = ?, limit_value = ?, warn_percent = ?,
          action = ?, enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(
        budget.name, budget.scope_type, budget.application_id, budget.model,
        budget.period, budget.metric, budget.limit_value, budget.warn_percent,
        budget.action, budget.enabled, req.params.id
      );

      clearBudgetCaches();
      const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
      res.json({ success: true, budget: enrichBudget(db, updated) });
    } catch (err) {
      console.error('[BUDGETS] Failed to update budget:', err);
      res.status(500).json({ error: 'Failed to update budget' });
    }
  });

  router.delete('/budgets/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Budget not found' });
      clearBudgetCaches();
      res.json({ success: true, id: Number(req.params.id) });
    } catch (err) {
      console.error('[BUDGETS] Failed to delete budget:', err);
      res.status(500).json({ error: 'Failed to delete budget' });
    }
  });

  router.get('/alerts', (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const unacknowledgedOnly = req.query.unacknowledged === '1' || req.query.unacknowledged === 'true';
      const where = unacknowledgedOnly ? 'WHERE a.acknowledged = 0' : '';

      const items = db.prepare(`
        SELECT a.*, b.name AS budget_name, b.scope_type, b.application_id,
               b.model, b.metric, b.action
        FROM budget_alerts a
        JOIN budgets b ON b.id = a.budget_id
        ${where}
        ORDER BY a.id DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const total = db.prepare(`SELECT COUNT(*) AS count FROM budget_alerts a ${where}`).get().count;
      const unacknowledged = db.prepare('SELECT COUNT(*) AS count FROM budget_alerts WHERE acknowledged = 0').get().count;

      res.json({ success: true, items, total, unacknowledged, limit, offset });
    } catch (err) {
      console.error('[ALERTS] Failed to list alerts:', err);
      res.status(500).json({ error: 'Failed to retrieve alerts' });
    }
  });

  router.patch('/alerts/:id', (req, res) => {
    try {
      const acknowledged = req.body?.acknowledged === false ? 0 : 1;
      const result = db.prepare('UPDATE budget_alerts SET acknowledged = ? WHERE id = ?')
        .run(acknowledged, req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
      res.json({ success: true, id: Number(req.params.id), acknowledged: Boolean(acknowledged) });
    } catch (err) {
      console.error('[ALERTS] Failed to acknowledge alert:', err);
      res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
  });

  router.post('/alerts/ack-all', (req, res) => {
    try {
      const result = db.prepare('UPDATE budget_alerts SET acknowledged = 1 WHERE acknowledged = 0').run();
      res.json({ success: true, acknowledged: result.changes });
    } catch (err) {
      console.error('[ALERTS] Failed to acknowledge alerts:', err);
      res.status(500).json({ error: 'Failed to acknowledge alerts' });
    }
  });

  router.get('/alerts/settings', (req, res) => {
    res.json({ success: true, settings: getAlertSettings(db) });
  });

  router.put('/alerts/settings', (req, res) => {
    try {
      const { webhookUrl, webhookEnabled } = req.body || {};
      if (webhookUrl !== undefined && webhookUrl) {
        let parsed;
        try {
          parsed = new URL(String(webhookUrl));
        } catch {
          return res.status(400).json({ error: 'webhookUrl must be a valid URL' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'webhookUrl must use http or https' });
        }
      }
      const settings = saveAlertSettings(db, { webhookUrl, webhookEnabled });
      res.json({ success: true, settings });
    } catch (err) {
      console.error('[ALERTS] Failed to save alert settings:', err);
      res.status(500).json({ error: 'Failed to save alert settings' });
    }
  });

  router.post('/alerts/test', async (req, res) => {
    try {
      const result = await sendTestAlert(db);
      res.status(result.ok ? 200 : 400).json({ success: result.ok, message: result.message });
    } catch (err) {
      console.error('[ALERTS] Test webhook failed:', err);
      res.status(500).json({ error: 'Failed to send test alert' });
    }
  });

  return router;
}
