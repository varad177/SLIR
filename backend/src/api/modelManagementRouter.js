import { Router } from 'express';

/**
 * Router for On-Premise Ollama Model Management, Live Model Switching, and Benchmarking
 */
export function createModelManagementRouter(ollamaService, analyticsService, db) {
  const router = Router();

  /**
   * 1. Get all installed Ollama models + custom cloud models + current active model
   */
  router.get('/installed', async (req, res) => {
    try {
      const result = await ollamaService.getInstalledModels();
      const activeModel = ollamaService.getActiveModel(db);
      const customModels = ollamaService.getCustomModels(db);

      res.json({
        ...result,
        activeModel,
        customModels
      });
    } catch (err) {
      console.error('[MODEL-MGR] Error getting installed models:', err);
      res.status(500).json({ error: 'Failed to retrieve installed Ollama models' });
    }
  });

  /**
   * Custom Cloud Models Management
   */
  router.get('/custom', (req, res) => {
    try {
      const models = ollamaService.getCustomModels(db);
      res.json(models);
    } catch (err) {
      console.error('[MODEL-MGR] Error listing custom models:', err);
      res.status(500).json({ error: 'Failed to list custom models' });
    }
  });

  router.post('/custom', (req, res) => {
    try {
      const {
        modelId, displayName, provider, format, apiBase, apiKey, keepApiKey,
        contextWindow, maxOutputTokens, inputCostPerMillion,
        outputCostPerMillion, timeoutMs
      } = req.body;
      if (!modelId || !apiBase) {
        return res.status(400).json({ error: 'Fields "modelId" and "apiBase" are required' });
      }

      const result = ollamaService.addCustomModel(db, {
        modelId,
        displayName,
        provider,
        format,
        apiBase,
        apiKey,
        keepApiKey,
        contextWindow,
        maxOutputTokens,
        inputCostPerMillion,
        outputCostPerMillion,
        timeoutMs
      });

      res.json(result);
    } catch (err) {
      console.error('[MODEL-MGR] Error adding custom model:', err);
      res.status(400).json({ error: err.message || 'Failed to add custom model' });
    }
  });

  router.post('/custom/test', async (req, res) => {
    try {
      const { apiBase, apiKey, modelId, timeoutMs, format } = req.body;
      const result = await ollamaService.testModelConnection({
        apiBase, apiKey, modelId, timeoutMs, format
      });
      res.json(result);
    } catch (err) {
      console.error('[MODEL-MGR] Error testing model connection:', err);
      res.status(500).json({ ok: false, errorType: 'gateway', message: err.message });
    }
  });

  router.post('/custom/:modelId/test', async (req, res) => {
    try {
      const result = await ollamaService.testStoredCustomModel(db, req.params.modelId, req.body || {});
      res.json(result);
    } catch (err) {
      if (err?.statusCode === 404) {
        return res.status(404).json({ ok: false, errorType: 'not_found', message: 'Model not found' });
      }
      console.error('[MODEL-MGR] Error testing stored model:', err);
      res.status(500).json({ ok: false, errorType: 'gateway', message: err.message });
    }
  });

  router.patch('/custom/:modelId', (req, res) => {
    try {
      const result = ollamaService.updateCustomModel(db, req.params.modelId, req.body || {});
      res.json(result);
    } catch (err) {
      if (err?.statusCode === 404) {
        return res.status(404).json({ error: 'Model not found' });
      }
      console.error('[MODEL-MGR] Error updating custom model:', err);
      res.status(err?.statusCode || 500).json({ error: err.message || 'Failed to update custom model' });
    }
  });

  router.delete('/custom/:modelId', (req, res) => {
    try {
      const result = ollamaService.deleteCustomModel(db, req.params.modelId);
      res.json(result);
    } catch (err) {
      if (err?.statusCode === 404) {
        return res.status(404).json({ error: 'Model not found' });
      }
      console.error('[MODEL-MGR] Error deleting custom model:', err);
      res.status(500).json({ error: 'Failed to delete custom model' });
    }
  });

  /**
   * Recent per-model reliability used by the dashboard health indicators.
   */
  router.get('/health', (req, res) => {
    try {
      const hours = Math.min(168, Math.max(1, Number.parseInt(req.query.hours, 10) || 24));
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const rows = db.prepare(`
        SELECT
          model,
          COUNT(*) AS requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
          MAX(timestamp) AS last_seen
        FROM usage_events
        WHERE timestamp >= ?
        GROUP BY model
        ORDER BY requests DESC
      `).all(cutoff);

      const models = rows.map((row) => {
        const requests = Number(row.requests) || 0;
        const successes = Number(row.successes) || 0;
        const successRate = requests > 0 ? Math.round((successes / requests) * 1000) / 10 : null;
        return {
          model: row.model,
          requests,
          successes,
          failures: requests - successes,
          successRate,
          status: successRate === null ? 'unknown' : successRate >= 95 ? 'healthy' : successRate >= 80 ? 'degraded' : 'unhealthy',
          lastSeen: row.last_seen
        };
      });

      res.json({ windowHours: hours, generatedAt: new Date().toISOString(), models });
    } catch (err) {
      console.error('[MODEL-MGR] Error loading model health:', err);
      res.status(500).json({ error: 'Failed to load model health' });
    }
  });

  /**
   * 2. Get current active routing model
   */
  router.get('/active', (req, res) => {
    try {
      const activeModel = ollamaService.getActiveModel(db);
      res.json({ activeModel });
    } catch (err) {
      console.error('[MODEL-MGR] Error getting active model:', err);
      res.status(500).json({ error: 'Failed to retrieve active model' });
    }
  });

  /**
   * 3. Switch active model dynamically
   */
  router.post('/active', async (req, res) => {
    try {
      const { model } = req.body;
      if (!model || typeof model !== 'string' || !model.trim()) {
        return res.status(400).json({ error: 'Field "model" must be a non-empty string' });
      }

      const result = await ollamaService.setActiveModel(db, model);
      res.json(result);
    } catch (err) {
      console.error('[MODEL-MGR] Error switching active model:', err);
      res.status(500).json({ error: 'Failed to switch active model' });
    }
  });

  /**
   * 4. Model Benchmark Leaderboard
   * Evaluates historical throughput, latency (min/avg/max), tokens/sec, error rate
   */
  router.get('/benchmark', (req, res) => {
    try {
      const leaderboard = analyticsService.getModelBenchmark(req.query);
      res.json({
        count: leaderboard.length,
        models: leaderboard
      });
    } catch (err) {
      console.error('[MODEL-MGR] Error fetching model benchmark:', err);
      res.status(500).json({ error: 'Failed to retrieve model benchmark leaderboard' });
    }
  });

  /**
   * 5. Developer Runtime Configuration (Temperature & Context Window)
   */
  router.get('/dev-config', (req, res) => {
    try {
      const config = ollamaService.getDevConfig(db);
      res.json(config);
    } catch (err) {
      console.error('[MODEL-MGR] Error getting dev config:', err);
      res.status(500).json({ error: 'Failed to retrieve dev runtime config' });
    }
  });

  router.post('/dev-config', (req, res) => {
    try {
      const { temperature, num_ctx } = req.body;
      const updated = ollamaService.setDevConfig(db, { temperature, num_ctx });
      res.json(updated);
    } catch (err) {
      console.error('[MODEL-MGR] Error updating dev config:', err);
      res.status(500).json({ error: 'Failed to update dev runtime config' });
    }
  });

  /**
   * 6. Live Diagnostic Latency & Load Time Profiler
   * Measures load_duration, prompt_eval_duration, eval_duration, and total latency
   */
  router.post('/profile', async (req, res) => {
    try {
      const { model, prompt, temperature, num_ctx } = req.body;
      const targetModel = model || ollamaService.getActiveModel(db);
      const result = await ollamaService.runProfileTest(targetModel, prompt, { temperature, num_ctx }, db);
      res.json(result);
    } catch (err) {
      console.error('[MODEL-MGR] Error running latency profile:', err);
      res.status(500).json({ error: err.message || 'Failed to profile model latency' });
    }
  });

  /**
   * 7. Run Live Test Prompt Benchmark
   * Sends prompt to specified model and returns real-time latency, token usage, and response
   */
  router.post('/test-prompt', async (req, res) => {
    try {
      const { model, prompt, messages, applicationId, temperature, max_tokens, maxTokens, stream } = req.body;
      if (!model) {
        return res.status(400).json({ error: 'Field "model" is required' });
      }

      const result = await ollamaService.runTestPrompt(model, prompt, {
        messages,
        applicationId,
        temperature,
        maxTokens: max_tokens ?? maxTokens,
        stream
      }, db);
      res.json(result);
    } catch (err) {
      console.error('[MODEL-MGR] Error running test prompt:', err);
      res.status(500).json({ error: err.message || 'Failed to run test prompt benchmark' });
    }
  });

  router.post('/test-prompt/stream', async (req, res) => {
    const { model, prompt, messages, applicationId, temperature, max_tokens, maxTokens } = req.body || {};
    if (!model) {
      return res.status(400).json({ error: 'Field "model" is required' });
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    const writeEvent = (payload) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    try {
      const result = await ollamaService.runTestPrompt(model, prompt, {
        messages,
        applicationId,
        temperature,
        maxTokens: max_tokens ?? maxTokens,
        stream: true,
        onDelta: (delta) => writeEvent({ type: 'delta', content: delta })
      }, db);
      writeEvent({ type: 'done', result });
      res.end();
    } catch (err) {
      console.error('[MODEL-MGR] Error streaming test prompt:', err);
      writeEvent({ type: 'error', error: err.message || 'Failed to stream test prompt' });
      res.end();
    }
  });

  return router;
}

