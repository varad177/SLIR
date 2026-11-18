import { Router } from 'express';
import crypto from 'crypto';

const MAX_FALLBACK_MODELS = 5;

function parseFallbackModels(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((model) => typeof model === 'string' && model.trim()) : [];
  } catch {
    return [];
  }
}

function validateFallbackModels(value) {
  if (!Array.isArray(value)) {
    return { error: 'fallbackModels must be an array of model IDs' };
  }

  const models = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return { error: 'fallbackModels must contain non-empty model IDs' };
    }
    const model = entry.trim().replace(/^ollama\//, '');
    if (model === 'active-model') {
      return { error: 'fallbackModels cannot contain the active-model alias' };
    }
    if (!models.includes(model)) models.push(model);
  }

  if (models.length > MAX_FALLBACK_MODELS) {
    return { error: `fallbackModels cannot contain more than ${MAX_FALLBACK_MODELS} models` };
  }

  return { models };
}

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
          COALESCE(a.failover_enabled, 0) AS failoverEnabled,
          COALESCE(a.fallback_models, '[]') AS fallbackModels,
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
          routingMode: app.defaultModel === 'active-model' ? 'global' : 'pinned',
          failoverEnabled: Boolean(app.failoverEnabled),
          fallbackModels: parseFallbackModels(app.fallbackModels),
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
      const {
        name,
        description,
        defaultModel = 'active-model',
        failoverEnabled = false,
        fallbackModels = []
      } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Application name is required' });
      }
      if (typeof failoverEnabled !== 'boolean') {
        return res.status(400).json({ error: 'failoverEnabled must be a boolean' });
      }
      const fallbackValidation = validateFallbackModels(fallbackModels);
      if (fallbackValidation.error) {
        return res.status(400).json({ error: fallbackValidation.error });
      }

      const cleanName = name.trim();
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16);
      const randSuffix = crypto.randomBytes(3).toString('hex');
      const id = `app_${slug}_${randSuffix}`;
      const apiKey = `mp_live_${crypto.randomBytes(16).toString('hex')}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO applications (
          id, name, description, api_key, default_model,
          failover_enabled, fallback_models, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanName,
        description ? description.trim() : null,
        apiKey,
        defaultModel.trim(),
        failoverEnabled ? 1 : 0,
        JSON.stringify(fallbackValidation.models),
        now,
        now
      );

      res.status(201).json({
        success: true,
        application: {
          id,
          name: cleanName,
          description: description ? description.trim() : '',
          apiKey,
          maskedApiKey: `${apiKey.slice(0, 10)}••••••••${apiKey.slice(-4)}`,
          defaultModel,
          failoverEnabled,
          fallbackModels: fallbackValidation.models,
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
   * 3. PATCH /api/applications/:id - Update application metadata and routing
   * Setting defaultModel to "active-model" makes the app follow the global
   * model; any concrete model id pins that application.
   */
  router.patch('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
      if (!existing) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const updates = [];
      const values = [];

      if (req.body.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
          return res.status(400).json({ error: 'Application name must be a non-empty string' });
        }
        updates.push('name = ?');
        values.push(req.body.name.trim());
      }

      if (req.body.description !== undefined) {
        if (req.body.description !== null && typeof req.body.description !== 'string') {
          return res.status(400).json({ error: 'Description must be a string or null' });
        }
        updates.push('description = ?');
        values.push(req.body.description ? req.body.description.trim() : null);
      }

      if (req.body.defaultModel !== undefined) {
        if (typeof req.body.defaultModel !== 'string') {
          return res.status(400).json({ error: 'defaultModel must be a string' });
        }
        updates.push('default_model = ?');
        values.push(req.body.defaultModel.trim() || 'active-model');
      }

      if (req.body.failoverEnabled !== undefined) {
        if (typeof req.body.failoverEnabled !== 'boolean') {
          return res.status(400).json({ error: 'failoverEnabled must be a boolean' });
        }
        updates.push('failover_enabled = ?');
        values.push(req.body.failoverEnabled ? 1 : 0);
      }

      if (req.body.fallbackModels !== undefined) {
        const fallbackValidation = validateFallbackModels(req.body.fallbackModels);
        if (fallbackValidation.error) {
          return res.status(400).json({ error: fallbackValidation.error });
        }
        updates.push('fallback_models = ?');
        values.push(JSON.stringify(fallbackValidation.models));
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No supported fields were provided' });
      }

      updates.push('updated_at = ?');
      values.push(new Date().toISOString(), id);
      db.prepare(`UPDATE applications SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const updated = db.prepare(`
        SELECT id, name, description, api_key AS apiKey,
               COALESCE(default_model, 'active-model') AS defaultModel,
               COALESCE(failover_enabled, 0) AS failoverEnabled,
               COALESCE(fallback_models, '[]') AS fallbackModels,
               created_at AS createdAt, updated_at AS updatedAt
        FROM applications WHERE id = ?
      `).get(id);

      const key = updated.apiKey || '';
      res.json({
        success: true,
        application: {
          ...updated,
          failoverEnabled: Boolean(updated.failoverEnabled),
          fallbackModels: parseFallbackModels(updated.fallbackModels),
          routingMode: updated.defaultModel === 'active-model' ? 'global' : 'pinned',
          maskedApiKey: key.length > 10 ? `${key.slice(0, 10)}••••••••${key.slice(-4)}` : '••••••••'
        }
      });
    } catch (err) {
      console.error('[APPS-API] Failed to update application:', err);
      res.status(500).json({ error: 'Failed to update application' });
    }
  });

  /**
   * 4. POST /api/applications/:id/regenerate-key - Rotate/regenerate an application's API key
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
   * 5. DELETE /api/applications/:id - Delete an application
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

