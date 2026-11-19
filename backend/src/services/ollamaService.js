import {
  CLOUD_CONNECTION_TEST_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  getOllamaUrls
} from './ollamaEndpoints.js';

/**
 * Service for managing local Ollama models and dynamic model switching
 */
export class OllamaService {
  constructor(options = {}) {
    this.ollamaUrl = options.ollamaUrl || process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
  }

  /**
   * Helper to format bytes to human-readable size
   */
  _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Fetches all models currently downloaded in the local Ollama instance
   */
  async getInstalledModels() {
    const urls = getOllamaUrls(this.ollamaUrl);

    let lastError = null;
    for (const baseUrl of urls) {
      try {
        const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          const models = (data.models || []).map((m) => ({
            name: m.name,
            model: m.model,
            size: this._formatBytes(m.size),
            rawSizeBytes: m.size,
            parameterSize: (m.details && m.details.parameter_size) || 'Unknown',
            quantization: (m.details && m.details.quantization_level) || 'Unknown',
            family: (m.details && m.details.family) || 'Unknown',
            modifiedAt: m.modified_at
          }));
          return { success: true, models, host: baseUrl };
        }
      } catch (err) {
        lastError = err;
      }
    }

    console.warn('[OLLAMA] Failed to reach Ollama at known endpoints:', lastError?.message);
    return {
      success: false,
      models: [],
      warning: 'Could not connect to the Ollama API. Start Ollama and refresh to see installed models.'
    };
  }

  /**
   * Reads active model from SQLite settings
   */
  getActiveModel(db) {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_model');
      return row ? row.value : 'qwen2.5:3b';
    } catch {
      return 'qwen2.5:3b';
    }
  }

  /**
   * Sets active model in SQLite and reconfigures the active-model alias
   */
  async setActiveModel(db, modelName) {
    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Valid modelName is required');
    }

    const cleanModel = modelName.trim();

    // 1. Persist to SQLite
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES ('active_model', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    `).run(cleanModel);

    return {
      success: true,
      activeModel: cleanModel,
      message: `Active model successfully set to ${cleanModel}. All requests to 'active-model' will route here.`
    };
  }

  /**
   * Reads developer runtime configuration (temperature and context window size)
   */
  getDevConfig(db) {
    if (!db) return { temperature: 0.7, num_ctx: 4096 };
    try {
      const tempRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('dev_temperature');
      const ctxRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('dev_num_ctx');
      return {
        temperature: tempRow ? parseFloat(tempRow.value) : 0.7,
        num_ctx: ctxRow ? parseInt(ctxRow.value, 10) : 4096
      };
    } catch {
      return { temperature: 0.7, num_ctx: 4096 };
    }
  }

  /**
   * Sets developer runtime configuration in SQLite settings
   */
  setDevConfig(db, config = {}) {
    if (!db) return { temperature: 0.7, num_ctx: 4096 };
    const { temperature, num_ctx } = config;
    if (temperature !== undefined && temperature !== null && !isNaN(temperature)) {
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('dev_temperature', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      `).run(String(temperature));
    }
    if (num_ctx !== undefined && num_ctx !== null && !isNaN(num_ctx)) {
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('dev_num_ctx', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      `).run(String(num_ctx));
    }
    return this.getDevConfig(db);
  }

  /**
   * Retrieves all user-added custom/cloud models from SQLite
   */
  getCustomModels(db) {
    try {
      const rows = db.prepare(`
        SELECT id, model_id, display_name, provider, api_base, api_key,
               context_window, max_output_tokens, input_cost_per_million,
               output_cost_per_million, timeout_ms, created_at
        FROM custom_models ORDER BY id DESC
      `).all();
      return rows.map(r => ({
        id: r.id,
        modelId: r.model_id,
        displayName: r.display_name,
        provider: r.provider,
        apiBase: r.api_base,
        hasApiKey: Boolean(r.api_key && r.api_key.trim().length > 0),
        maskedApiKey: r.api_key ? (r.api_key.length > 8 ? `${r.api_key.slice(0, 4)}...${r.api_key.slice(-4)}` : '••••••••') : '',
        contextWindow: r.context_window,
        maxOutputTokens: r.max_output_tokens,
        inputCostPerMillion: r.input_cost_per_million,
        outputCostPerMillion: r.output_cost_per_million,
        timeoutMs: r.timeout_ms,
        createdAt: r.created_at
      }));
    } catch {
      return [];
    }
  }

  _nullableInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  _nullableFloat(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Adds or updates a user-configured cloud model (e.g. Groq, OpenAI, DeepSeek, vLLM)
   */
  addCustomModel(db, {
    modelId, displayName, provider = 'cloud', apiBase, apiKey = '',
    contextWindow, maxOutputTokens, inputCostPerMillion, outputCostPerMillion,
    timeoutMs, keepApiKey = false
  }) {
    if (!modelId || !apiBase) {
      throw new Error('Fields "modelId" and "apiBase" are required');
    }

    const cleanModelId = modelId.trim();
    const cleanDisplayName = (displayName || cleanModelId).trim();
    const cleanProvider = (provider || 'cloud').trim().toLowerCase();
    const cleanApiBase = apiBase.trim().replace(/\/+$/, '');
    const existing = db.prepare('SELECT api_key FROM custom_models WHERE model_id = ?').get(cleanModelId);
    const preserveKey = keepApiKey === true || apiKey === undefined || apiKey === null;
    const cleanApiKey = preserveKey
      ? (existing?.api_key || '')
      : String(apiKey).trim();
    const meta = {
      contextWindow: this._nullableInt(contextWindow),
      maxOutputTokens: this._nullableInt(maxOutputTokens),
      inputCostPerMillion: this._nullableFloat(inputCostPerMillion),
      outputCostPerMillion: this._nullableFloat(outputCostPerMillion),
      timeoutMs: this._nullableInt(timeoutMs)
    };

    db.prepare(`
      INSERT INTO custom_models (
        model_id, display_name, provider, api_base, api_key,
        context_window, max_output_tokens, input_cost_per_million,
        output_cost_per_million, timeout_ms, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(model_id) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        api_base = excluded.api_base,
        api_key = excluded.api_key,
        context_window = excluded.context_window,
        max_output_tokens = excluded.max_output_tokens,
        input_cost_per_million = excluded.input_cost_per_million,
        output_cost_per_million = excluded.output_cost_per_million,
        timeout_ms = excluded.timeout_ms
    `).run(
      cleanModelId, cleanDisplayName, cleanProvider, cleanApiBase, cleanApiKey,
      meta.contextWindow, meta.maxOutputTokens, meta.inputCostPerMillion,
      meta.outputCostPerMillion, meta.timeoutMs
    );

    return {
      success: true,
      model: {
        modelId: cleanModelId,
        displayName: cleanDisplayName,
        provider: cleanProvider,
        apiBase: cleanApiBase,
        hasApiKey: Boolean(cleanApiKey),
        ...meta
      }
    };
  }

  /**
   * Updates an existing custom model. Omitting apiKey preserves the stored key.
   */
  updateCustomModel(db, modelId, fields = {}) {
    const existing = db.prepare('SELECT * FROM custom_models WHERE model_id = ?').get(modelId);
    if (!existing) {
      const err = new Error('Model not found');
      err.statusCode = 404;
      throw err;
    }

    const displayName = fields.displayName !== undefined
      ? String(fields.displayName).trim() || existing.display_name
      : existing.display_name;
    const provider = fields.provider !== undefined
      ? String(fields.provider).trim().toLowerCase() || existing.provider
      : existing.provider;
    const apiBase = fields.apiBase !== undefined
      ? String(fields.apiBase).trim().replace(/\/+$/, '')
      : existing.api_base;
    if (!apiBase) {
      const err = new Error('apiBase must be a non-empty URL');
      err.statusCode = 400;
      throw err;
    }

    const apiKey = fields.keepApiKey === true || fields.apiKey === undefined || fields.apiKey === null
      ? (existing.api_key || '')
      : String(fields.apiKey).trim();

    db.prepare(`
      UPDATE custom_models SET
        display_name = ?, provider = ?, api_base = ?, api_key = ?,
        context_window = ?, max_output_tokens = ?, input_cost_per_million = ?,
        output_cost_per_million = ?, timeout_ms = ?
      WHERE model_id = ?
    `).run(
      displayName, provider, apiBase, apiKey,
      this._nullableInt(fields.contextWindow ?? existing.context_window),
      this._nullableInt(fields.maxOutputTokens ?? existing.max_output_tokens),
      this._nullableFloat(fields.inputCostPerMillion ?? existing.input_cost_per_million),
      this._nullableFloat(fields.outputCostPerMillion ?? existing.output_cost_per_million),
      this._nullableInt(fields.timeoutMs ?? existing.timeout_ms),
      modelId
    );

    return {
      success: true,
      model: this.getCustomModels(db).find((m) => m.modelId === modelId)
    };
  }

  /**
   * Sends a minimal OpenAI-compatible chat request to verify endpoint, key,
   * model id, and latency. Expected provider failures are returned, not thrown,
   * so the UI can show actionable diagnostics.
   */
  async testModelConnection({ apiBase, apiKey, modelId, timeoutMs = CLOUD_CONNECTION_TEST_TIMEOUT_MS }) {
    if (!apiBase || !modelId) {
      return { ok: false, errorType: 'validation', message: 'API base URL and model ID are required.' };
    }

    const base = String(apiBase).trim().replace(/\/+$/, '');
    const timeout = Math.max(2000, Math.min(Number(timeoutMs) || CLOUD_CONNECTION_TEST_TIMEOUT_MS, 60000));
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const startedAt = performance.now();

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          max_tokens: 8,
          temperature: 0
        }),
        signal: AbortSignal.timeout(timeout)
      });
      const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let errorType = 'upstream_error';
        if (res.status === 401 || res.status === 403) errorType = 'auth';
        else if (res.status === 404) errorType = 'not_found';
        else if (res.status === 429) errorType = 'rate_limit';
        else if (res.status >= 400 && res.status < 500) errorType = 'invalid_request';
        return {
          ok: false,
          httpStatus: res.status,
          latencyMs,
          errorType,
          message: body.slice(0, 500) || `Provider returned HTTP ${res.status}.`
        };
      }

      const data = await res.json().catch(() => ({}));
      const content = data.choices?.[0]?.message?.content || '';
      return {
        ok: true,
        httpStatus: res.status,
        latencyMs,
        modelId,
        message: 'Connection verified.',
        sample: String(content).slice(0, 120)
      };
    } catch (err) {
      const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return {
        ok: false,
        latencyMs,
        errorType: timedOut ? 'timeout' : 'network',
        message: timedOut
          ? `No response within ${Math.round(timeout / 1000)}s.`
          : (err?.cause?.message || err?.message || 'Could not reach the API endpoint.')
      };
    }
  }

  async testStoredCustomModel(db, modelId, overrides = {}) {
    const row = db.prepare('SELECT * FROM custom_models WHERE model_id = ?').get(modelId);
    if (!row) {
      const err = new Error('Model not found');
      err.statusCode = 404;
      throw err;
    }
    return this.testModelConnection({
      apiBase: overrides.apiBase || row.api_base,
      apiKey: overrides.apiKey !== undefined ? overrides.apiKey : row.api_key,
      modelId: overrides.modelId || row.model_id,
      timeoutMs: overrides.timeoutMs || row.timeout_ms || 15000
    });
  }

  /**
   * Deletes a custom cloud model
   */
  deleteCustomModel(db, modelId) {
    const result = db.prepare('DELETE FROM custom_models WHERE model_id = ?').run(modelId);
    if (result.changes === 0) {
      const err = new Error('Model not found');
      err.statusCode = 404;
      throw err;
    }
    return { success: true, deleted: modelId };
  }

  /**
   * Executes a live benchmarking test prompt against a specified model
   */
  async runTestPrompt(modelName, prompt = 'Explain quantum computing in 2 concise sentences.', options = {}, db = null) {
    let resolvedModel = modelName;
    if ((modelName === 'active-model' || !modelName) && db) {
      resolvedModel = this.getActiveModel(db);
    }

    let customModel = null;
    if (db) {
      try {
        customModel = db.prepare('SELECT * FROM custom_models WHERE LOWER(TRIM(model_id)) = LOWER(TRIM(?)) OR model_id = ?').get(resolvedModel, resolvedModel);
      } catch {}
    }

    const temperature = options.temperature !== undefined && options.temperature !== null
      ? Number(options.temperature)
      : undefined;
    const maxTokens = options.maxTokens !== undefined && options.maxTokens !== null
      ? Number(options.maxTokens)
      : undefined;
    const stream = Boolean(options.stream);

    const start = performance.now();

    if (customModel) {
      // Direct call to custom cloud model
      const cloudTimeoutMs = Math.max(5000, customModel.timeout_ms || 30000);
      const url = `${customModel.api_base}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (customModel.api_key) {
        headers['Authorization'] = `Bearer ${customModel.api_key}`;
      }

      const buildBody = () => JSON.stringify({
        model: customModel.model_id,
        messages: [{ role: 'user', content: prompt }],
        ...(Number.isFinite(temperature) ? { temperature } : {}),
        ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {})
      });

      let res = await fetch(url, {
        method: 'POST',
        headers,
        body: buildBody(),
        signal: AbortSignal.timeout(cloudTimeoutMs)
      });

      if (!res.ok && res.status === 429) {
        const errText = await res.text();
        const match = errText.match(/try again in ([\d\.]+)s/i);
        const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 400 : 3500;
        if (waitMs <= 7000) {
          await new Promise(r => setTimeout(r, waitMs));
          res = await fetch(url, {
            method: 'POST',
            headers,
            body: buildBody(),
            signal: AbortSignal.timeout(cloudTimeoutMs)
          });
        } else {
          throw new Error(`Cloud provider [${customModel.provider}] rate limit exceeded: ${errText}`);
        }
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cloud provider [${customModel.provider}] returned HTTP ${res.status}: ${errText}`);
      }

      let content = '';
      let usage = {};
      if (stream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              content += chunk.choices?.[0]?.delta?.content || '';
              if (chunk.usage) usage = chunk.usage;
            } catch {}
          }
        }
      } else {
        const data = await res.json();
        content = data.choices?.[0]?.message?.content || '';
        usage = data.usage || {};
      }
      const duration = Math.round((performance.now() - start) * 10) / 10;
      const cached = usage.prompt_tokens_details?.cached_tokens;
      const cacheStatus = typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown';

      // Persist benchmark run to SQLite if db available
      if (db) {
        try {
          const reqId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          db.prepare(`
            INSERT INTO usage_events (
              request_id, trace_id, application_id, provider, model, call_type, status,
              is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
              estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
              load_duration_ms, cache_status, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          `).run(
            reqId, null, 'playground-benchmark', customModel.provider || 'cloud', customModel.model_id,
            'chat.completion', 'success', stream ? 1 : 0, usage.prompt_tokens || 0, usage.completion_tokens || 0,
            usage.total_tokens || 0, 0, 0, 'confirmed_by_provider', duration, null, null, null,
            cacheStatus
          );
        } catch (dbErr) {
          console.warn('[BENCHMARK] Failed to record test event:', dbErr.message);
        }
      }

      return {
        success: true,
        model: resolvedModel,
        latencyMs: duration,
        promptEvalMs: null,
        evalMs: null,
        loadMs: null,
        cacheStatus,
        content,
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        },
        tokensPerSec: usage.completion_tokens && duration > 0
          ? Math.round((usage.completion_tokens / (duration / 1000)) * 10) / 10
          : 0
      };
    }

    // Direct local Ollama endpoints (tries native /api/chat first to capture nanosecond cache & load timings)
    const ollamaHosts = getOllamaUrls(this.ollamaUrl);

    let lastError = null;

    const ollamaOptions = {};
    if (Number.isFinite(temperature)) ollamaOptions.temperature = temperature;
    if (Number.isFinite(maxTokens) && maxTokens > 0) ollamaOptions.num_predict = maxTokens;

    for (const host of ollamaHosts) {
      try {
        const res = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: resolvedModel,
            messages: [{ role: 'user', content: prompt }],
            stream,
            ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {})
          }),
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
        });

        if (res.ok) {
          let data;
          let content = '';
          if (stream && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const consume = (line) => {
              const trimmed = line.trim();
              if (!trimmed) return;
              try {
                const chunk = JSON.parse(trimmed);
                content += chunk.message?.content || '';
                if (chunk.done) data = chunk;
              } catch {}
            };
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              lines.forEach(consume);
            }
            if (buffer) consume(buffer);
            data = data || {};
          } else {
            data = await res.json();
            content = data.message?.content || '';
          }
          const duration = Math.round((performance.now() - start) * 10) / 10;
          const promptTokens = data.prompt_eval_count || 0;
          const completionTokens = data.eval_count || 0;
          const totalTokens = promptTokens + completionTokens;

          const nsToMs = (val) => (typeof val === 'number' && val > 0 ? Math.round((val / 1e6) * 10) / 10 : null);
          const promptEvalMs = nsToMs(data.prompt_eval_duration);
          const evalMs = nsToMs(data.eval_duration);
          const loadMs = nsToMs(data.load_duration);

          const cachedCount = data.prompt_eval_cached_count;
          const cacheStatus = typeof cachedCount === 'number' && cachedCount > 0
            ? 'cache_hit'
            : (promptEvalMs && promptEvalMs > 3000 ? 'cold_cache' : 'standard');

          const denomMs = evalMs !== null && evalMs > 0 ? evalMs : duration;
          const trueTokensPerSec = completionTokens && denomMs > 0
            ? Math.round((completionTokens / (denomMs / 1000)) * 10) / 10
            : 0;

          if (db) {
            try {
              const reqId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              db.prepare(`
                INSERT INTO usage_events (
                  request_id, trace_id, application_id, provider, model, call_type, status,
                  is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
                  estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
                  load_duration_ms, cache_status, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
              `).run(
                reqId, null, null, 'ollama', resolvedModel,
                'chat.completion', 'success', stream ? 1 : 0, promptTokens, completionTokens,
                totalTokens, 0, 0, 'confirmed_by_provider', duration, promptEvalMs, evalMs,
                loadMs, cacheStatus
              );
            } catch (dbErr) {
              console.warn('[BENCHMARK] Failed to record test event:', dbErr.message);
            }
          }

          return {
            success: true,
            model: resolvedModel,
            latencyMs: duration,
            promptEvalMs,
            evalMs,
            loadMs,
            cacheStatus,
            content,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens
            },
            tokensPerSec: trueTokensPerSec
          };
        }

        lastError = new Error(`HTTP ${res.status} from ${host}/api/chat`);
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Failed to benchmark prompt with model ${modelName}: ${lastError?.message || 'no reachable inference endpoint'}`);
  }

  /**
   * Diagnostic profiling test runner: evaluates load_duration, prompt_eval_duration,
   * eval_duration, and total latency with given temperature and context window (num_ctx).
   */
  async runProfileTest(modelName, prompt = 'Sensor vibration diagnostic check: summarize status in 1 sentence.', options = {}, db = null) {
    let resolvedModel = modelName;
    if ((modelName === 'active-model' || !modelName) && db) {
      resolvedModel = this.getActiveModel(db);
    }

    const devCfg = this.getDevConfig(db);
    const temperature = options.temperature !== undefined && options.temperature !== null ? Number(options.temperature) : devCfg.temperature;
    const num_ctx = options.num_ctx !== undefined && options.num_ctx !== null ? Number(options.num_ctx) : devCfg.num_ctx;

    const start = performance.now();

    // Check if cloud model
    let customModel = null;
    if (db) {
      try {
        customModel = db.prepare('SELECT * FROM custom_models WHERE LOWER(TRIM(model_id)) = LOWER(TRIM(?)) OR model_id = ?').get(resolvedModel, resolvedModel);
      } catch {}
    }

    if (customModel) {
      const url = `${customModel.api_base}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (customModel.api_key) headers['Authorization'] = `Bearer ${customModel.api_key}`;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: customModel.model_id,
          messages: [{ role: 'user', content: prompt }],
          temperature
        }),
        signal: AbortSignal.timeout(Math.max(5000, customModel.timeout_ms || 30000))
      });

      const duration = Math.round((performance.now() - start) * 10) / 10;
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cloud model request failed (${res.status}): ${errText}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const tokensPerSec = completionTokens && duration > 0 ? Math.round((completionTokens / (duration / 1000)) * 10) / 10 : 0;

      return {
        success: true,
        model: resolvedModel,
        isCloud: true,
        latencyMs: duration,
        loadMs: 0,
        promptEvalMs: null,
        evalMs: duration,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        tokensPerSec,
        content,
        options: { temperature, num_ctx }
      };
    }

    // Local Ollama endpoints
    const ollamaHosts = getOllamaUrls(this.ollamaUrl);

    let lastError = null;

    for (const host of ollamaHosts) {
      try {
        const reqPayload = {
          model: resolvedModel,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          options: {
            temperature,
            num_ctx
          }
        };

        const res = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
        });

        if (res.ok) {
          const duration = Math.round((performance.now() - start) * 10) / 10;
          const data = await res.json();
          const content = data.message?.content || '';
          const promptTokens = data.prompt_eval_count || 0;
          const completionTokens = data.eval_count || 0;
          const totalTokens = promptTokens + completionTokens;

          const nsToMs = (val) => (typeof val === 'number' && val > 0 ? Math.round((val / 1e6) * 10) / 10 : 0);
          const promptEvalMs = nsToMs(data.prompt_eval_duration);
          const evalMs = nsToMs(data.eval_duration);
          const loadMs = nsToMs(data.load_duration);

          const denomMs = evalMs > 0 ? evalMs : duration;
          const tokensPerSec = completionTokens && denomMs > 0
            ? Math.round((completionTokens / (denomMs / 1000)) * 10) / 10
            : 0;

          if (db) {
            try {
              const reqId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              db.prepare(`
                INSERT INTO usage_events (
                  request_id, trace_id, application_id, provider, model, call_type, status,
                  is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
                  estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
                  load_duration_ms, cache_status, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
              `).run(
                reqId, null, null, 'ollama', resolvedModel,
                'chat.completion', 'success', 0, promptTokens, completionTokens,
                totalTokens, 0, 0, 'confirmed_by_provider', duration, promptEvalMs, evalMs,
                loadMs, loadMs > 800 ? 'cold_load' : 'resident'
              );
            } catch (dbErr) {
              console.warn('[PROFILER] Failed to record profile event:', dbErr.message);
            }
          }

          return {
            success: true,
            model: resolvedModel,
            isCloud: false,
            latencyMs: duration,
            loadMs,
            promptEvalMs,
            evalMs,
            promptTokens,
            completionTokens,
            totalTokens,
            tokensPerSec,
            content,
            options: { temperature, num_ctx }
          };
        }

        lastError = new Error(`HTTP ${res.status} from ${host}/api/chat`);
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Failed to profile latency for model ${modelName}: ${lastError?.message || 'no reachable Ollama host'}`);
  }
}
