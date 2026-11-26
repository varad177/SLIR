import {
  CLOUD_CONNECTION_TEST_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  getOllamaUrls
} from './ollamaEndpoints.js';
import { getAdapter, joinEndpoint, normalizeFormat } from '../adapters/index.js';
import { invalidatePricingCache } from '../db/pricingEngine.js';
import { UsageRepository } from '../db/repository.js';
import { executeModelAttempt } from './gatewayFailover.js';

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
        SELECT id, model_id, display_name, provider, format, api_base, api_key,
               context_window, max_output_tokens, input_cost_per_million,
               output_cost_per_million, timeout_ms, created_at
        FROM custom_models ORDER BY id DESC
      `).all();
      return rows.map(r => ({
        id: r.id,
        modelId: r.model_id,
        displayName: r.display_name,
        provider: r.provider,
        format: r.format || 'openai',
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
    modelId, displayName, provider = 'cloud', format = 'openai', apiBase, apiKey = '',
    contextWindow, maxOutputTokens, inputCostPerMillion, outputCostPerMillion,
    timeoutMs, keepApiKey = false
  }) {
    if (!modelId || !apiBase) {
      throw new Error('Fields "modelId" and "apiBase" are required');
    }

    const cleanModelId = modelId.trim();
    const cleanDisplayName = (displayName || cleanModelId).trim();
    const cleanProvider = (provider || 'cloud').trim().toLowerCase();
    const cleanFormat = normalizeFormat(format);
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
        model_id, display_name, provider, format, api_base, api_key,
        context_window, max_output_tokens, input_cost_per_million,
        output_cost_per_million, timeout_ms, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(model_id) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        format = excluded.format,
        api_base = excluded.api_base,
        api_key = excluded.api_key,
        context_window = excluded.context_window,
        max_output_tokens = excluded.max_output_tokens,
        input_cost_per_million = excluded.input_cost_per_million,
        output_cost_per_million = excluded.output_cost_per_million,
        timeout_ms = excluded.timeout_ms
    `).run(
      cleanModelId, cleanDisplayName, cleanProvider, cleanFormat, cleanApiBase, cleanApiKey,
      meta.contextWindow, meta.maxOutputTokens, meta.inputCostPerMillion,
      meta.outputCostPerMillion, meta.timeoutMs
    );

    invalidatePricingCache(db);

    return {
      success: true,
      model: {
        modelId: cleanModelId,
        displayName: cleanDisplayName,
        provider: cleanProvider,
        format: cleanFormat,
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
    const format = fields.format !== undefined
      ? normalizeFormat(fields.format)
      : (existing.format || 'openai');
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
        display_name = ?, provider = ?, format = ?, api_base = ?, api_key = ?,
        context_window = ?, max_output_tokens = ?, input_cost_per_million = ?,
        output_cost_per_million = ?, timeout_ms = ?
      WHERE model_id = ?
    `).run(
      displayName, provider, format, apiBase, apiKey,
      this._nullableInt(fields.contextWindow ?? existing.context_window),
      this._nullableInt(fields.maxOutputTokens ?? existing.max_output_tokens),
      this._nullableFloat(fields.inputCostPerMillion ?? existing.input_cost_per_million),
      this._nullableFloat(fields.outputCostPerMillion ?? existing.output_cost_per_million),
      this._nullableInt(fields.timeoutMs ?? existing.timeout_ms),
      modelId
    );

    invalidatePricingCache(db);

    return {
      success: true,
      model: this.getCustomModels(db).find((m) => m.modelId === modelId)
    };
  }

  /**
   * Sends a minimal chat request in the configured upstream API format to
   * verify endpoint, key, model id, and latency. Expected provider failures
   * are returned, not thrown, so the UI can show actionable diagnostics.
   */
  async testModelConnection({ apiBase, apiKey, modelId, timeoutMs = CLOUD_CONNECTION_TEST_TIMEOUT_MS, format = 'openai' }) {
    if (!apiBase || !modelId) {
      return { ok: false, errorType: 'validation', message: 'API base URL and model ID are required.' };
    }

    const base = String(apiBase).trim().replace(/\/+$/, '');
    const adapter = getAdapter(format);
    const modelConfig = { model_id: modelId, api_base: base };
    const endpoint = joinEndpoint(base, adapter.getEndpointPath(modelConfig));
    const timeout = Math.max(2000, Math.min(Number(timeoutMs) || CLOUD_CONNECTION_TEST_TIMEOUT_MS, 60000));
    const headers = adapter.buildHeaders(apiKey, modelConfig);
    const requestBody = {
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 8,
      temperature: 0
    };
    const payload = adapter.buildRequestBody(requestBody, modelConfig);
    const startedAt = performance.now();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
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
        const message = adapter.formatErrorMessage(body) || `Provider returned HTTP ${res.status}.`;
        return {
          ok: false,
          httpStatus: res.status,
          latencyMs,
          errorType,
          message: message.slice(0, 500)
        };
      }

      const data = await res.json().catch(() => ({}));
      const transformed = adapter.transformResponse(data, modelConfig, requestBody);
      const content = transformed.choices?.[0]?.message?.content || '';
      return {
        ok: true,
        httpStatus: res.status,
        latencyMs,
        modelId,
        format: adapter.format,
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
      format: overrides.format || row.format || 'openai',
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
    invalidatePricingCache(db);
    return { success: true, deleted: modelId };
  }

  _resolveApplicationId(db, applicationId) {
    if (!db || !applicationId || typeof applicationId !== 'string') return null;
    try {
      const row = db.prepare('SELECT id FROM applications WHERE id = ?').get(applicationId);
      return row ? row.id : null;
    } catch {
      return null;
    }
  }

  _persistInternalRun(db, fields) {
    if (!db) return { estimatedCost: null, costStatus: 'unknown' };
    try {
      const repo = new UsageRepository(db);
      const saved = repo.saveEvent({
        traceId: null,
        clientModel: fields.clientModel || fields.model,
        httpStatus: fields.status === 'failure' ? null : 200,
        tokensEstimated: 0,
        timestamp: new Date().toISOString(),
        ...fields,
        applicationId: this._resolveApplicationId(db, fields.applicationId)
      });
      return {
        estimatedCost: saved?.estimatedCost ?? null,
        costStatus: saved?.costStatus || 'unknown'
      };
    } catch (dbErr) {
      console.warn('[BENCHMARK] Failed to record internal event:', dbErr.message);
      return { estimatedCost: null, costStatus: 'unknown' };
    }
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
    const messages = Array.isArray(options.messages) && options.messages.length > 0
      ? options.messages
      : [{ role: 'user', content: prompt }];
    const onDelta = typeof options.onDelta === 'function' ? options.onDelta : null;
    const applicationId = this._resolveApplicationId(db, options.applicationId);

    const start = performance.now();

    if (customModel) {
      const reqBody = {
        model: customModel.model_id,
        messages,
        stream,
        ...(Number.isFinite(temperature) ? { temperature } : {}),
        ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {})
      };

      const result = await executeModelAttempt(db, customModel.model_id, reqBody, {
        allowRateLimitRetry: true
      });
      if (!result.ok) {
        throw new Error(`Cloud provider [${customModel.provider}] returned HTTP ${result.status || 502}: ${result.message}`);
      }

      let content = '';
      let usage = {};
      if (result.mode === 'stream' && result.upstreamRes?.body) {
        const reader = result.upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              const deltaText = chunk.choices?.[0]?.delta?.content || '';
              if (deltaText) {
                content += deltaText;
                if (onDelta) onDelta(deltaText);
              }
              if (chunk.usage) usage = chunk.usage;
            } catch {}
          }
        }
      } else {
        const transformed = result.responseBody || {};
        content = transformed.choices?.[0]?.message?.content || '';
        usage = transformed.usage || {};
      }

      const duration = Math.round((performance.now() - start) * 10) / 10;
      const cached = usage.prompt_tokens_details?.cached_tokens;
      const cacheStatus = typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown';
      const promptTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
      const completionTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
      const totalTokens = Number.isFinite(usage.total_tokens)
        ? usage.total_tokens
        : (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);

      const costInfo = this._persistInternalRun(db, {
        requestId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        applicationId,
        provider: customModel.provider || 'cloud',
        model: customModel.model_id,
        clientModel: modelName || resolvedModel,
        callType: 'playground.benchmark',
        status: 'success',
        isStreaming: stream ? 1 : 0,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs: duration,
        promptEvalDurationMs: null,
        evalDurationMs: null,
        loadDurationMs: null,
        cacheStatus
      });

      return {
        success: true,
        model: resolvedModel,
        latencyMs: duration,
        promptEvalMs: null,
        evalMs: null,
        loadMs: null,
        cacheStatus,
        content,
        estimatedCost: costInfo.estimatedCost ?? undefined,
        usage: {
          promptTokens: promptTokens || 0,
          completionTokens: completionTokens || 0,
          totalTokens: totalTokens || 0
        },
        tokensPerSec: (completionTokens || 0) && duration > 0
          ? Math.round(((completionTokens || 0) / (duration / 1000)) * 10) / 10
          : 0
      };
    }

    // Direct local Ollama endpoints (uses native /api/chat to capture nanosecond cache & load timings even when streaming)
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
            messages,
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
                const deltaText = chunk.message?.content || '';
                if (deltaText) {
                  content += deltaText;
                  if (onDelta) onDelta(deltaText);
                }
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

          const costInfo = this._persistInternalRun(db, {
            requestId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            applicationId,
            provider: 'ollama',
            model: `ollama/${resolvedModel}`,
            clientModel: modelName || resolvedModel,
            callType: 'playground.benchmark',
            status: 'success',
            isStreaming: stream ? 1 : 0,
            promptTokens,
            completionTokens,
            totalTokens,
            latencyMs: duration,
            promptEvalDurationMs: promptEvalMs,
            evalDurationMs: evalMs,
            loadDurationMs: loadMs,
            cacheStatus
          });

          return {
            success: true,
            model: resolvedModel,
            latencyMs: duration,
            promptEvalMs,
            evalMs,
            loadMs,
            cacheStatus,
            content,
            estimatedCost: costInfo.estimatedCost ?? undefined,
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
      const adapter = getAdapter(customModel.format);
      const url = joinEndpoint(customModel.api_base, adapter.getEndpointPath(customModel));
      const headers = adapter.buildHeaders(customModel.api_key, customModel);

      const requestBody = {
        model: customModel.model_id,
        messages: [{ role: 'user', content: prompt }],
        temperature
      };
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(adapter.buildRequestBody(requestBody, customModel)),
        signal: AbortSignal.timeout(Math.max(5000, customModel.timeout_ms || 30000))
      });

      const duration = Math.round((performance.now() - start) * 10) / 10;
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cloud model request failed (${res.status}): ${adapter.formatErrorMessage(errText)}`);
      }
      const data = await res.json();
      const transformed = adapter.transformResponse(data, customModel, requestBody);
      const content = transformed.choices?.[0]?.message?.content || '';
      const promptTokens = transformed.usage?.prompt_tokens || 0;
      const completionTokens = transformed.usage?.completion_tokens || 0;
      const tokensPerSec = completionTokens && duration > 0 ? Math.round((completionTokens / (duration / 1000)) * 10) / 10 : 0;

      return {
        success: true,
        model: resolvedModel,
        isCloud: true,
        format: adapter.format,
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

          this._persistInternalRun(db, {
            requestId: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            applicationId: null,
            provider: 'ollama',
            model: `ollama/${resolvedModel}`,
            clientModel: modelName || resolvedModel,
            callType: 'latency.profile',
            status: 'success',
            isStreaming: 0,
            promptTokens,
            completionTokens,
            totalTokens,
            latencyMs: duration,
            promptEvalDurationMs: promptEvalMs,
            evalDurationMs: evalMs,
            loadDurationMs: loadMs,
            cacheStatus: loadMs > 800 ? 'cold_load' : 'resident'
          });

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
