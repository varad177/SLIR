import fs from 'fs';
import path from 'path';

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
    const urls = [
      this.ollamaUrl,
      'http://localhost:11434',
      'http://127.0.0.1:11434',
      'http://host.docker.internal:11434',
      'http://ollama:11434'
    ].filter(Boolean);

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
      const rows = db.prepare('SELECT id, model_id, display_name, provider, api_base, api_key, created_at FROM custom_models ORDER BY id DESC').all();
      return rows.map(r => ({
        id: r.id,
        modelId: r.model_id,
        displayName: r.display_name,
        provider: r.provider,
        apiBase: r.api_base,
        hasApiKey: Boolean(r.api_key && r.api_key.trim().length > 0),
        maskedApiKey: r.api_key ? (r.api_key.length > 8 ? `${r.api_key.slice(0, 4)}...${r.api_key.slice(-4)}` : '••••••••') : '',
        createdAt: r.created_at
      }));
    } catch {
      return [];
    }
  }

  /**
   * Adds or updates a user-configured cloud model (e.g. Groq, OpenAI, DeepSeek, vLLM)
   */
  addCustomModel(db, { modelId, displayName, provider = 'cloud', apiBase, apiKey = '' }) {
    if (!modelId || !apiBase) {
      throw new Error('Fields "modelId" and "apiBase" are required');
    }

    const cleanModelId = modelId.trim();
    const cleanDisplayName = (displayName || cleanModelId).trim();
    const cleanProvider = (provider || 'cloud').trim().toLowerCase();
    const cleanApiBase = apiBase.trim().replace(/\/+$/, ''); // Strip trailing slashes
    const cleanApiKey = (apiKey || '').trim();

    db.prepare(`
      INSERT INTO custom_models (model_id, display_name, provider, api_base, api_key, created_at)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(model_id) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        api_base = excluded.api_base,
        api_key = excluded.api_key
    `).run(cleanModelId, cleanDisplayName, cleanProvider, cleanApiBase, cleanApiKey);

    return {
      success: true,
      model: {
        modelId: cleanModelId,
        displayName: cleanDisplayName,
        provider: cleanProvider,
        apiBase: cleanApiBase,
        hasApiKey: Boolean(cleanApiKey)
      }
    };
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
        signal: AbortSignal.timeout(30000)
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
            signal: AbortSignal.timeout(30000)
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
    const ollamaHosts = [
      this.ollamaUrl,
      'http://localhost:11434',
      'http://127.0.0.1:11434',
      'http://host.docker.internal:11434',
      'http://ollama:11434'
    ].filter(Boolean);

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
          signal: AbortSignal.timeout(90000)
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
        signal: AbortSignal.timeout(30000)
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
    const ollamaHosts = [
      this.ollamaUrl,
      'http://localhost:11434',
      'http://127.0.0.1:11434',
      'http://host.docker.internal:11434',
      'http://ollama:11434'
    ].filter(Boolean);

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
          signal: AbortSignal.timeout(90000)
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
