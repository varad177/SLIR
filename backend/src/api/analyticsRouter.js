import { Router } from 'express';
import { generateApiKey } from '../db/seed.js';
import { invalidatePricingCache } from '../db/pricingEngine.js';

export function createAnalyticsRouter(analyticsService, db) {
  const router = Router();

  /**
   * KPI Summary Cards
   */
  router.get('/summary', (req, res) => {
    try {
      const summary = analyticsService.getSummary(req.query);
      res.json(summary);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch summary:', err);
      res.status(500).json({ error: 'Failed to retrieve analytics summary' });
    }
  });

  /**
   * Time-series Chart Data (hourly, daily, monthly)
   */
  router.get('/timeseries', (req, res) => {
    try {
      const series = analyticsService.getTimeSeries(req.query);
      res.json(series);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch timeseries:', err);
      res.status(500).json({ error: 'Failed to retrieve timeseries data' });
    }
  });

  /**
   * Model Breakdown
   */
  router.get('/models', (req, res) => {
    try {
      const models = analyticsService.getModelBreakdown(req.query);
      res.json(models);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch models breakdown:', err);
      res.status(500).json({ error: 'Failed to retrieve model analytics' });
    }
  });

  /**
   * Provider Breakdown
   */
  router.get('/providers', (req, res) => {
    try {
      const providers = analyticsService.getProviderBreakdown(req.query);
      res.json(providers);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch provider breakdown:', err);
      res.status(500).json({ error: 'Failed to retrieve provider analytics' });
    }
  });

  /**
   * Request History Table with Pagination & Filters
   */
  router.get('/requests', (req, res) => {
    try {
      const result = analyticsService.getRequests(req.query);
      res.json(result);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch requests:', err);
      res.status(500).json({ error: 'Failed to retrieve request logs' });
    }
  });

  /**
   * Filter dropdown options (Distinct models, providers, applications)
   */
  router.get('/filters', (req, res) => {
    try {
      const filters = analyticsService.getFilterOptions();
      res.json(filters);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch filter options:', err);
      res.status(500).json({ error: 'Failed to retrieve filter options' });
    }
  });

  /**
   * Model Pricing Table (Versioned records inspection)
   */
  router.get('/pricing', (req, res) => {
    try {
      const pricing = db.prepare('SELECT * FROM model_pricing ORDER BY id DESC').all();
      res.json(pricing);
    } catch (err) {
      console.error('[ANALYTICS] Failed to fetch pricing:', err);
      res.status(500).json({ error: 'Failed to retrieve pricing records' });
    }
  });

  function validatePricingPayload(payload, existing = null) {
    const merged = {
      model_pattern: payload.model_pattern ?? existing?.model_pattern,
      provider: payload.provider ?? existing?.provider,
      input_cost_per_million: payload.input_cost_per_million !== undefined
        ? payload.input_cost_per_million
        : existing?.input_cost_per_million,
      output_cost_per_million: payload.output_cost_per_million !== undefined
        ? payload.output_cost_per_million
        : existing?.output_cost_per_million,
      effective_from: payload.effective_from ?? existing?.effective_from,
      effective_to: payload.effective_to !== undefined ? payload.effective_to : existing?.effective_to,
      currency: payload.currency ?? existing?.currency ?? 'USD'
    };

    const errors = [];
    if (!merged.model_pattern || !String(merged.model_pattern).trim()) errors.push('model_pattern is required');
    if (!merged.provider || !String(merged.provider).trim()) errors.push('provider is required');

    const input = Number(merged.input_cost_per_million);
    const output = Number(merged.output_cost_per_million);
    if (!Number.isFinite(input) || input < 0) errors.push('input_cost_per_million must be zero or greater');
    if (!Number.isFinite(output) || output < 0) errors.push('output_cost_per_million must be zero or greater');

    const effectiveFrom = merged.effective_from ? new Date(merged.effective_from) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) errors.push('effective_from must be a valid date');
    let effectiveTo = null;
    if (merged.effective_to) {
      effectiveTo = new Date(merged.effective_to);
      if (Number.isNaN(effectiveTo.getTime())) errors.push('effective_to must be a valid date');
    }

    if (errors.length > 0) return { error: errors.join('; ') };

    return {
      value: {
        model_pattern: String(merged.model_pattern).trim(),
        provider: String(merged.provider).trim().toLowerCase(),
        input_cost_per_million: input,
        output_cost_per_million: output,
        effective_from: effectiveFrom.toISOString(),
        effective_to: effectiveTo ? effectiveTo.toISOString() : null,
        currency: String(merged.currency || 'USD').toUpperCase()
      }
    };
  }

  /**
   * Create a new versioned pricing rule. Any overlapping open-ended rule for
   * the same provider/pattern is closed at the new rule's start date.
   */
  router.post('/pricing', (req, res) => {
    try {
      const validation = validatePricingPayload(req.body || {});
      if (validation.error) return res.status(400).json({ error: validation.error });
      const rule = validation.value;

      const create = db.transaction(() => {
        db.prepare(`
          UPDATE model_pricing
          SET effective_to = ?
          WHERE model_pattern = ? AND provider = ?
            AND effective_from < ?
            AND (effective_to IS NULL OR effective_to > ?)
        `).run(rule.effective_from, rule.model_pattern, rule.provider, rule.effective_from, rule.effective_from);

        const result = db.prepare(`
          INSERT INTO model_pricing (
            model_pattern, provider, input_cost_per_million, output_cost_per_million,
            effective_from, effective_to, currency
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          rule.model_pattern, rule.provider, rule.input_cost_per_million,
          rule.output_cost_per_million, rule.effective_from, rule.effective_to, rule.currency
        );

        return db.prepare('SELECT * FROM model_pricing WHERE id = ?').get(result.lastInsertRowid);
      });

      const created = create();
      invalidatePricingCache(db);
      res.status(201).json({ success: true, pricing: created });
    } catch (err) {
      console.error('[ANALYTICS] Failed to create pricing rule:', err);
      res.status(500).json({ error: 'Failed to create pricing rule' });
    }
  });

  router.patch('/pricing/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM model_pricing WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Pricing rule not found' });

      const validation = validatePricingPayload(req.body || {}, existing);
      if (validation.error) return res.status(400).json({ error: validation.error });
      const rule = validation.value;

      db.prepare(`
        UPDATE model_pricing SET
          model_pattern = ?, provider = ?, input_cost_per_million = ?,
          output_cost_per_million = ?, effective_from = ?, effective_to = ?, currency = ?
        WHERE id = ?
      `).run(
        rule.model_pattern, rule.provider, rule.input_cost_per_million,
        rule.output_cost_per_million, rule.effective_from, rule.effective_to,
        rule.currency, req.params.id
      );

      invalidatePricingCache(db);
      const updated = db.prepare('SELECT * FROM model_pricing WHERE id = ?').get(req.params.id);
      res.json({ success: true, pricing: updated });
    } catch (err) {
      console.error('[ANALYTICS] Failed to update pricing rule:', err);
      res.status(500).json({ error: 'Failed to update pricing rule' });
    }
  });

  router.delete('/pricing/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM model_pricing WHERE id = ?').run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Pricing rule not found' });
      invalidatePricingCache(db);
      res.json({ success: true, id: Number(req.params.id) });
    } catch (err) {
      console.error('[ANALYTICS] Failed to delete pricing rule:', err);
      res.status(500).json({ error: 'Failed to delete pricing rule' });
    }
  });

  /**
   * Reset / Clear Database Telemetry & Applications
   * Runs as a single transaction so a partial wipe is never observable.
   */
  router.post('/clear', (req, res) => {
    try {
      const { clearApps = true, reseedDefault = false } = req.body || {};

      const clearAll = db.transaction(() => {
        const countRes = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get();
        const count = countRes?.count || 0;

        // 1. Wipe all usage telemetry events
        db.prepare('DELETE FROM usage_events').run();

        // 2. Reset SQLite autoincrement sequence
        try {
          db.prepare("DELETE FROM sqlite_sequence WHERE name = 'usage_events'").run();
        } catch { /* table may not exist yet */ }

        // 3. Clear applications if requested
        let deletedAppsCount = 0;
        if (clearApps) {
          const appCountRes = db.prepare('SELECT COUNT(*) AS count FROM applications').get();
          deletedAppsCount = appCountRes?.count || 0;
          db.prepare('DELETE FROM applications').run();

          // Mark setup completed so server restarts never resurrect deleted applications
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_setup_completed', 'true')").run();

          if (reseedDefault) {
            db.prepare(`
              INSERT INTO applications (id, name, description, api_key, default_model)
              VALUES ('app_sensorbot', 'SensorReportBot (.NET Backend)', 'Industrial vibration and motor diagnostic bot', ?, 'active-model')
            `).run(generateApiKey('sensorbot'));
          }
        }

        return { count, deletedAppsCount };
      });

      const { count, deletedAppsCount } = clearAll();

      // VACUUM intentionally NOT run here: it needs exclusive access, blocks
      // concurrent writers and can fail while WAL writers are active.
      res.json({
        success: true,
        message: `Database reset successfully: ${count} requests cleared${clearApps ? `, ${deletedAppsCount} applications wiped` : ''}.`,
        deletedEvents: count,
        deletedApps: deletedAppsCount
      });
    } catch (err) {
      console.error('[ANALYTICS] Failed to clear database:', err);
      res.status(500).json({ error: 'Failed to clear database' });
    }
  });

  return router;
}

