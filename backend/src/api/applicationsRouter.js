import { Router } from 'express';
import crypto from 'crypto';

/**
 * Applications & Virtual API Keys Management Router
 */
export function createApplicationsRouter(db, analyticsService) {
  const router = Router();

  /**
   * 1. GET /api/applications - List all applications with usage stats
   */
  router.get('/', (req, res) => {
    try {
      const apps = db.prepare(`
        SELECT 
          a.id,
          a.name,
          a.description,
          a.api_key AS apiKey,
          COALESCE(a.default_model, 'active-model') AS defaultModel,
          a.created_at AS createdAt,
          COUNT(u.id) AS totalRequests,
          COALESCE(SUM(CASE WHEN u.status = 'failure' THEN 1 ELSE 0 END), 0) AS failedRequests,
          COALESCE(SUM(u.total_tokens), 0) AS totalTokens,
          COALESCE(SUM(u.estimated_cost), 0.0) AS totalCost,
          MAX(u.timestamp) AS lastActive
        FROM applications a
        LEFT JOIN usage_events u ON u.application_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at DESC
      `).all();

      const enriched = apps.map(app => {
        const key = app.apiKey || '';
        const masked = key.length > 10 ? `${key.slice(0, 10)}••••••••${key.slice(-4)}` : '••••••••';
        return {
          id: app.id,
          name: app.name,
          description: app.description || '',
          apiKey: key,
          maskedApiKey: masked,
          defaultModel: app.defaultModel,
          baseUrl: 'http://localhost:4101/v1',
          gatewayUrl: 'http://localhost:4101/v1',
          createdAt: app.createdAt,
          totalRequests: app.totalRequests,
          failedRequests: app.failedRequests,
          totalTokens: app.totalTokens,
          totalCost: Math.round(app.totalCost * 1e4) / 1e4,
          lastActive: app.lastActive
        };
      });

      res.json({
        success: true,
        count: enriched.length,
        applications: enriched
      });
    } catch (err) {
      console.error('[APPS-API] Failed to retrieve applications:', err);
      res.status(500).json({ error: 'Failed to retrieve applications' });
    }
  });

  /**
   * 2. POST /api/applications - Register a new application with an instant API key and Base URL
   */
  router.post('/', (req, res) => {
    try {
      const { name, description, defaultModel = 'active-model' } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Application name is required' });
      }

      const cleanName = name.trim();
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16);
      const randSuffix = crypto.randomBytes(3).toString('hex');
      const id = `app_${slug}_${randSuffix}`;
      const apiKey = `mp_live_${crypto.randomBytes(16).toString('hex')}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO applications (id, name, description, api_key, default_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, cleanName, description ? description.trim() : null, apiKey, defaultModel.trim(), now, now);

      res.status(201).json({
        success: true,
        application: {
          id,
          name: cleanName,
          description: description ? description.trim() : '',
          apiKey,
          maskedApiKey: `${apiKey.slice(0, 10)}••••••••${apiKey.slice(-4)}`,
          defaultModel,
          baseUrl: 'http://localhost:4101/v1',
          gatewayUrl: 'http://localhost:4101/v1',
          createdAt: now,
          totalRequests: 0,
          totalTokens: 0,
          totalCost: 0,
          lastActive: null
        }
      });
    } catch (err) {
      console.error('[APPS-API] Failed to create application:', err);
      res.status(500).json({ error: 'Failed to register application' });
    }
  });

  /**
   * 3. POST /api/applications/:id/regenerate-key - Rotate/regenerate an application's API key
   */
  router.post('/:id/regenerate-key', (req, res) => {
    try {
      const { id } = req.params;
      const newKey = `mp_live_${crypto.randomBytes(16).toString('hex')}`;
      const now = new Date().toISOString();

      const result = db.prepare(`
        UPDATE applications
        SET api_key = ?, updated_at = ?
        WHERE id = ?
      `).run(newKey, now, id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      res.json({
        success: true,
        id,
        apiKey: newKey,
        maskedApiKey: `${newKey.slice(0, 10)}••••••••${newKey.slice(-4)}`
      });
    } catch (err) {
      console.error('[APPS-API] Failed to regenerate key:', err);
      res.status(500).json({ error: 'Failed to regenerate API key' });
    }
  });

  /**
   * 4. DELETE /api/applications/:id - Delete an application
   */
  router.delete('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const result = db.prepare('DELETE FROM applications WHERE id = ?').run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      res.json({ success: true, id });
    } catch (err) {
      console.error('[APPS-API] Failed to delete application:', err);
      res.status(500).json({ error: 'Failed to delete application' });
    }
  });

  return router;
}

