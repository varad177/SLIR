import { Router } from 'express';
import { generateApiKey } from '../db/seed.js';

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

