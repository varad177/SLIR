import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDatabase } from './db/connection.js';
import { initSchema } from './db/schema.js';
import { seedDefaultData } from './db/seed.js';
import { startRetentionJob } from './db/retention.js';
import { UsageRepository } from './db/repository.js';
import { AnalyticsService } from './db/analyticsQueries.js';
import { createAnalyticsRouter } from './api/analyticsRouter.js';
import { OllamaService } from './services/ollamaService.js';
import { createModelManagementRouter } from './api/modelManagementRouter.js';
import { createApplicationsRouter } from './api/applicationsRouter.js';

// The .env file lives at the ai-usage-monitor project root, one level above
// backend/, so an explicit path is required for `npm start` run from backend/.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: process.env.DOTENV_PATH || path.join(projectRoot, '.env') });

const app = express();
const PORT = process.env.PORT || 4101;
const INGEST_API_KEY = process.env.INGEST_API_KEY || 'dev-secret-key';

if (INGEST_API_KEY === 'dev-secret-key') {
  console.warn('[SECURITY] INGEST_API_KEY is the well-known default "dev-secret-key". Change it in .env before exposing this service.');
}

/**
 * Constant-time string comparison for bearer tokens.
 * @param {string} supplied
 * @param {string} expected
 * @returns {boolean}
 */
function safeTokenEqual(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extracts the bearer token from an Authorization header.
 * @returns {string|null}
 */
function bearerToken(req) {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/**
 * Pipes an upstream SSE response straight to the client while capturing the
 * bytes for post-hoc usage extraction. Nothing is buffered before headers are
 * sent, so time-to-first-token is preserved.
 * @param {Response} upstreamRes
 * @param {import('express').Response} res
 * @returns {Promise<string>} the full upstream body text
 */
async function pipeSseAndCapture(upstreamRes, res) {
  const chunks = [];
  const capture = new Transform({
    transform(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb(null, chunk);
    }
  });

  if (!res.headersSent) {
    res.status(200);
    res.set({
      'Content-Type': upstreamRes.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }

  try {
    await pipeline(Readable.fromWeb(upstreamRes.body), capture, res);
  } catch (err) {
    // A client that disconnects mid-stream is normal, not a server fault
    const premature = err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || /premature close/i.test(err?.message || '');
    if (!premature) console.error('[GATEWAY] SSE pipe error:', err.message);
    if (!res.headersSent) res.status(502);
    if (!res.writableEnded) res.end();
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Picks the last well-formed SSE data payload out of a captured stream ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
 * that chunk carries the final `usage` object from OpenAI-compatible APIs.
 * @param {string} text
 * @returns {Object|null}
 */
function extractSseUsage(text) {
  let last = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') last = parsed;
    } catch { /* partial/keepalive chunk */ }
  }
  return last;
}

// Middleware
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4100,http://localhost:3000,http://localhost:5173,http://localhost:4000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser / same-origin requests carry no Origin header
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: '10mb' }));

// Global DB & Service references
let db = null;
let repo = null;
let analyticsService = null;
let ollamaService = null;
let initPromise = null;
let retentionTimer = null;

/**
 * Admin guard for mutating/sensitive endpoints. Every route that creates,
 * mutates or destroys data must run through this.
 */
function requireAdmin(req, res, next) {
  const token = bearerToken(req);
  if (!safeTokenEqual(token || '', INGEST_API_KEY)) {
    return res.status(401).json({ error: { message: 'Unauthorized: admin bearer token required' } });
  }
  next();
}

export function initializeDatabase() {
  // Re-entrancy safe: concurrent callers share a single initialization so
  // routers are never mounted twice.
  if (!initPromise) {
    initPromise = (async () => {
      const dbPath = process.env.DATABASE_PATH || './data/monitor.db';
      db = await getDatabase(dbPath);
      initSchema(db, dbPath);
      seedDefaultData(db);
      retentionTimer = startRetentionJob(db, Number.parseInt(process.env.RETENTION_DAYS || '0', 10));
      repo = new UsageRepository(db);
      analyticsService = new AnalyticsService(db);
      ollamaService = new OllamaService();
      app.use('/api/analytics', createAnalyticsRouter(analyticsService, db));
      app.use('/api/models', createModelManagementRouter(ollamaService, analyticsService, db));
      app.use('/api/applications', createApplicationsRouter(db, analyticsService));
      registerFallbackHandlers();
    })().catch(err => {
      initPromise = null; // allow a retry on failure
      throw err;
    });
  }
  return initPromise.then(() => ({ db, repo, analyticsService, ollamaService }));
}

/**
 * Standard OpenAI Models List Endpoint (/v1/models)
 */
app.get(['/v1/models', '/api/v1/models'], async (req, res) => {
  try {
    const installed = ollamaService ? await ollamaService.getInstalledModels() : { models: [] };
    const custom = (ollamaService && db) ? ollamaService.getCustomModels(db) : [];
    const active = (ollamaService && db) ? ollamaService.getActiveModel(db) : 'qwen2.5:1.5b';

    const list = [
      { id: 'active-model', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'slir' },
      ...installed.models.map(m => ({ id: m.name, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'ollama' })),
      ...custom.map(c => ({ id: c.modelId, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: c.provider }))
    ];

    res.json({ object: 'list', data: list, activeModel: active });
  } catch (err) {
    res.json({ object: 'list', data: [{ id: 'active-model', object: 'model', owned_by: 'slir' }] });
  }
});

/**
 * Dynamic Active-Model Resolver:
 * Accepts OpenAI-compatible completions for 'active-model', dynamically looks up
 * current active model from SQLite, and forwards to local Ollama.
 */
app.post(['/v1/chat/completions', '/api/v1/chat/completions'], async (req, res) => {
  const reqStart = performance.now();
  let appId = null;
  let isDirectClient = false;
  let appRow = null;
  let failureInfo = null;

  /** Persists a gateway-served call when it was made with an app key. */
  const persistEvent = (fields) => {
    if (!isDirectClient || !repo) return;
    try {
      repo.saveEvent({
        traceId: null,
        applicationId: appId,
        callType: 'chat.completion',
        tokensEstimated: 0,
        timestamp: new Date().toISOString(),
        ...fields
      });
    } catch (e) {
      console.error('[GATEWAY] Error persisting direct event:', e.message);
    }
  };

  /** Persists a failed gateway call when it was made with an app key. */
  const persistFailure = (details = {}) => {
    persistEvent({
      requestId: `chatcmpl-${crypto.randomUUID()}`,
      provider: failureInfo?.provider || 'unknown',
      model: failureInfo?.model || 'unknown',
      status: 'failure',
      isStreaming: failureInfo?.isStreaming || 0,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      latencyMs: Math.round((performance.now() - reqStart) * 10) / 10,
      promptEvalDurationMs: null,
      evalDurationMs: null,
      loadDurationMs: null,
      cacheStatus: 'unknown',
      ...details
    });
  };

  try {
    // 0. Application Virtual API Key Authentication & Attribution
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token && token.startsWith('mp_live_')) {
        if (db) {
          try {
            appRow = db.prepare('SELECT id, name, default_model FROM applications WHERE api_key = ?').get(token);
          } catch (e) {
            console.error('[GATEWAY] API key lookup failed:', e.message);
          }
        }
        // An unknown mp_live_ key is a hard 401: silently recording it as an
        // unattributed "direct client" hides typos and leaked keys.
        if (!appRow) {
          return res.status(401).json({ error: { message: 'Unauthorized: unknown API key' } });
        }
        appId = appRow.id;
        isDirectClient = true;
      }
    }

    // Reject non-string model values (the gateway has forwarded arrays/objects
    // before, which then crashed downstream .replace()/toLowerCase calls).
    if (req.body.model !== undefined && req.body.model !== null && typeof req.body.model !== 'string') {
      return res.status(400).json({ error: { message: 'Invalid request: "model" must be a string' } });
    }

    const activeModel = (ollamaService && db) ? ollamaService.getActiveModel(db) : 'qwen2.5:3b';
    // An application can pin its own default model; otherwise fall back to the
    // globally active model for the "active-model" alias and missing models.
    const appDefaultModel = appRow?.default_model;
    const requestedModel = req.body.model;
    const usesActiveAlias = !requestedModel || requestedModel === 'active-model';
    const targetModel = usesActiveAlias
      ? (appDefaultModel && appDefaultModel !== 'active-model' ? appDefaultModel : activeModel)
      : requestedModel.replace(/^ollama\//, '');

    failureInfo = {
      provider: 'ollama',
      model: `ollama/${targetModel}`,
      isStreaming: req.body.stream ? 1 : 0
    };

    // 1. Check if targetModel is a user-configured Cloud Model (e.g. Groq, OpenAI, DeepSeek)
    let customModel = null;
    if (db) {
      try {
        customModel = db.prepare('SELECT * FROM custom_models WHERE LOWER(TRIM(model_id)) = LOWER(TRIM(?)) OR model_id = ?').get(targetModel, targetModel);
      } catch {}
    }

    if (customModel) {
      failureInfo = {
        provider: customModel.provider || 'cloud',
        model: customModel.model_id,
        isStreaming: req.body.stream ? 1 : 0
      };
      const cloudEndpoint = `${customModel.api_base}/chat/completions`;
      const cloudHeaders = { 'Content-Type': 'application/json' };
      if (customModel.api_key) {
        cloudHeaders['Authorization'] = `Bearer ${customModel.api_key}`;
      }

      let cloudPayload = {
        ...req.body,
        model: customModel.model_id
      };

      // OpenAI-compatible providers only emit the final usage chunk when asked.
      if (cloudPayload.stream && !cloudPayload.stream_options) {
        cloudPayload.stream_options = { include_usage: true };
      }

      let cloudRes = await fetch(cloudEndpoint, {
        method: 'POST',
        headers: cloudHeaders,
        body: JSON.stringify(cloudPayload),
        signal: AbortSignal.timeout(60000)
      });

      // Automatic Fallback 1: If cloud provider rejects json_schema (e.g. strict schema constraints on Groq/DeepSeek),
      // seamlessly retry using standard json_object mode so the caller never gets a 400 error.
      if (!cloudRes.ok && cloudRes.status === 400 && cloudPayload.response_format?.type === 'json_schema') {
        console.log(`[GATEWAY] Cloud provider [${customModel.provider}] rejected json_schema (400), retrying with json_object...`);
        cloudPayload = {
          ...cloudPayload,
          response_format: { type: 'json_object' }
        };
        cloudRes = await fetch(cloudEndpoint, {
          method: 'POST',
          headers: cloudHeaders,
          body: JSON.stringify(cloudPayload),
          signal: AbortSignal.timeout(60000)
        });
      }

      // Automatic Retry 2: If rate limit (429) hit and wait time is brief (<= 7s), back off and retry once
      if (!cloudRes.ok && cloudRes.status === 429) {
        const errorText = await cloudRes.text();
        const match = errorText.match(/try again in ([\d\.]+)s/i);
        const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 400 : 3500;
        if (waitMs <= 7000) {
          console.log(`[GATEWAY] Cloud provider [${customModel.provider}] hit 429 rate limit. Backing off ${waitMs}ms and retrying...`);
          await new Promise(r => setTimeout(r, waitMs));
          cloudRes = await fetch(cloudEndpoint, {
            method: 'POST',
            headers: cloudHeaders,
            body: JSON.stringify(cloudPayload),
            signal: AbortSignal.timeout(60000)
          });
        } else {
          persistFailure({
            errorType: 'upstream_rate_limit',
            errorMessage: errorText
          });
          return res.status(429).json({
            error: `Cloud provider [${customModel.provider}] rate limit exceeded: ${errorText}`
          });
        }
      }

      if (!cloudRes.ok) {
        const errorText = await cloudRes.text();
        persistFailure({
          errorType: `upstream_${cloudRes.status}`,
          errorMessage: errorText
        });
        return res.status(cloudRes.status).json({
          error: `Cloud provider [${customModel.provider}] error: ${errorText}`
        });
      }

      const latencyMs = Math.round((performance.now() - reqStart) * 10) / 10;

      // Streaming: pipe SSE untouched, then log from the final usage chunk
      if (req.body.stream && cloudRes.body) {
        let captured;
        try {
          captured = await pipeSseAndCapture(cloudRes, res);
        } catch (err) {
          persistFailure({ errorType: 'stream_error', errorMessage: err.message });
          throw err;
        }
        const finalChunk = extractSseUsage(captured) || {};
        const usage = finalChunk.usage || {};
        const cached = usage.prompt_tokens_details?.cached_tokens;
        persistEvent({
          requestId: finalChunk.id || `chatcmpl-${crypto.randomUUID()}`,
          provider: customModel.provider || 'cloud',
          model: customModel.model_id,
          status: 'success',
          isStreaming: 1,
          promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
          completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
          totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
          latencyMs,
          // Cloud providers do not report these; null means "not reported"
          promptEvalDurationMs: null,
          evalDurationMs: null,
          loadDurationMs: null,
          cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown'
        });
        return;
      }

      const data = await cloudRes.json();

      // Log direct client call to SQLite
      if (isDirectClient && repo) {
        try {
          const usage = data.usage || {};
          const cached = usage.prompt_tokens_details?.cached_tokens;
          repo.saveEvent({
            requestId: data.id || `chatcmpl-${crypto.randomUUID()}`,
            traceId: null,
            applicationId: appId,
            provider: customModel.provider || 'cloud',
            model: customModel.model_id,
            callType: 'chat.completion',
            status: 'success',
            isStreaming: 0,
            promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
            completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
            totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
            tokensEstimated: 0,
            latencyMs,
            promptEvalDurationMs: null,
            evalDurationMs: null,
            loadDurationMs: null,
            cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown',
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.error('[GATEWAY] Error persisting direct cloud event:', e.message);
        }
      }

      return res.status(200).json(data);
    }

    // 2. Otherwise route to local Ollama instance
    const ollamaUrls = [
      process.env.OLLAMA_URL,
      'http://localhost:11434',
      'http://127.0.0.1:11434',
      'http://host.docker.internal:11434',
      'http://ollama:11434'
    ].filter(Boolean);

    let lastErr = null;

    const devConfig = (ollamaService && db) ? ollamaService.getDevConfig(db) : { temperature: 0.7, num_ctx: 4096 };
    // For non-streaming requests, prefer Ollama's native /api/chat to capture nanosecond prompt caching timings
    if (!req.body.stream) {
      for (const url of ollamaUrls) {
        try {
          const chatRes = await fetch(`${url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: targetModel,
              messages: req.body.messages || [],
              stream: false,
              options: {
                temperature: req.body.temperature !== undefined ? Number(req.body.temperature) : devConfig.temperature,
                num_ctx: req.body.num_ctx !== undefined ? Number(req.body.num_ctx) : devConfig.num_ctx
              }
            }),
            signal: AbortSignal.timeout(90000)
          });

          if (chatRes.ok) {
            const data = await chatRes.json();
            const latencyMs = Math.round((performance.now() - reqStart) * 10) / 10;
            // Ollama reports nanoseconds; `null` when the field is absent
            const nsToMs = (value) => (Number.isFinite(value) && value > 0 ? Math.round((value / 1e6) * 10) / 10 : null);
            const promptEvalMs = nsToMs(data.prompt_eval_duration);
            const evalMs = nsToMs(data.eval_duration);
            const loadMs = nsToMs(data.load_duration);
            const cachedCount = Number.isFinite(data.prompt_eval_cached_count) ? data.prompt_eval_cached_count : null;
            const cacheStatus = cachedCount !== null
              ? (cachedCount > 0 ? 'cache_hit' : (promptEvalMs !== null && promptEvalMs > 3000 ? 'cold_cache' : 'standard'))
              : 'unknown';

            const openAiFormat = {
              id: `chatcmpl-${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2)}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: targetModel,
              choices: [
                {
                  index: 0,
                  message: data.message || { role: 'assistant', content: '' },
                  finish_reason: data.done_reason || 'stop'
                }
              ],
              usage: {
                prompt_tokens: data.prompt_eval_count || 0,
                completion_tokens: data.eval_count || 0,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                prompt_tokens_details: {
                  cached_tokens: data.prompt_eval_cached_count || 0
                }
              },
              timings: {
                load_duration: data.load_duration || 0,
                prompt_eval_duration: data.prompt_eval_duration || 0,
                eval_duration: data.eval_duration || 0,
                total_duration: data.total_duration || 0
              },
              load_duration: data.load_duration || 0,
              prompt_eval_duration: data.prompt_eval_duration || 0,
              eval_duration: data.eval_duration || 0
            };

            // Log direct client call to SQLite
            const nativePromptTokens = Number.isFinite(data.prompt_eval_count) ? data.prompt_eval_count : null;
            const nativeCompletionTokens = Number.isFinite(data.eval_count) ? data.eval_count : null;
            persistEvent({
              requestId: openAiFormat.id,
              provider: 'ollama',
              model: `ollama/${targetModel}`,
              status: 'success',
              isStreaming: 0,
              promptTokens: nativePromptTokens,
              completionTokens: nativeCompletionTokens,
              totalTokens: nativePromptTokens !== null && nativeCompletionTokens !== null
                ? nativePromptTokens + nativeCompletionTokens
                : null,
              latencyMs,
              promptEvalDurationMs: promptEvalMs,
              evalDurationMs: evalMs,
              loadDurationMs: loadMs,
              cacheStatus
            });

            return res.status(200).json(openAiFormat);
          } else if (chatRes.status !== 404) {
            // 404 = model missing locally, fall through to the OpenAI-compatible
            // endpoint (which reports the same). Any other status is worth noting.
            lastErr = new Error(`ollama /api/chat returned ${chatRes.status}`);
          }
        } catch (e) {
          lastErr = e;
        }
      }
    }

    // Streaming or fallback to standard /v1/chat/completions
    const payload = {
      ...req.body,
      model: targetModel
    };

    let upstreamRes = null;
    for (const url of ollamaUrls) {
      try {
        upstreamRes = await fetch(`${url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(90000)
        });
        if (upstreamRes.ok) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!upstreamRes || !upstreamRes.ok) {

      const upstreamStatus = upstreamRes ? upstreamRes.status : 502;
      const upstreamBody = upstreamRes ? await upstreamRes.text().catch(() => '') : '';
      console.error(`[GATEWAY] Upstream model ${targetModel} failed (${upstreamStatus}): ${upstreamBody.slice(0, 300)}`);
      persistFailure({
        errorType: `upstream_${upstreamStatus}`,
        errorMessage: upstreamBody || lastErr?.message || 'Upstream request failed'
      });
      return res.status(upstreamStatus).json({
        error: { message: `Failed to route to active model ${targetModel}`, code: upstreamStatus }
      });
    }

    // Streaming: forward the SSE stream as-is, then log from the final chunk
    if (req.body.stream && upstreamRes.body) {
      let captured;
      try {
        captured = await pipeSseAndCapture(upstreamRes, res);
      } catch (err) {
        persistFailure({ errorType: 'stream_error', errorMessage: err.message });
        throw err;
      }
      const finalChunk = extractSseUsage(captured) || {};
      const usage = finalChunk.usage || {};
      const cached = usage.prompt_tokens_details?.cached_tokens;
      persistEvent({
        requestId: finalChunk.id || `chatcmpl-${crypto.randomUUID()}`,
        provider: 'ollama',
        model: `ollama/${targetModel}`,
        status: 'success',
        isStreaming: 1,
        promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
        completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
        totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
        latencyMs: Math.round((performance.now() - reqStart) * 10) / 10,
        promptEvalDurationMs: null,
        evalDurationMs: null,
        loadDurationMs: null,
        cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown'
      });
      return;
    }

    const data = await upstreamRes.json();
    const usage = data.usage || {};
    const cached = usage.prompt_tokens_details?.cached_tokens;
    persistEvent({
      requestId: data.id || `chatcmpl-${crypto.randomUUID()}`,
      provider: 'ollama',
      model: `ollama/${targetModel}`,
      status: 'success',
      isStreaming: 0,
      promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
      completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
      totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
      latencyMs: Math.round((performance.now() - reqStart) * 10) / 10,
      promptEvalDurationMs: null,
      evalDurationMs: null,
      loadDurationMs: null,
      cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown'
    });
    res.status(200).json(data);
  } catch (err) {
    console.error('[DYNAMIC-ROUTER] Routing error:', err);
    if (failureInfo) {
      persistFailure({ errorType: 'gateway_error', errorMessage: err.message });
    }
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    res.status(500).json({ error: { message: 'Internal routing error' } });
  }
});

/**
 * Health Check Endpoint ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â reports unhealthy when the DB cannot be reached so
 * container orchestrators do not route traffic to a dead instance.
 */
app.get('/api/health', (req, res) => {
  const payload = {
    status: 'ok',
    dbType: db ? db.type : 'initializing',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };
  if (!db) {
    return res.status(503).json({ ...payload, status: 'starting', dbType: 'initializing' });
  }
  try {
    db.prepare('SELECT 1').get();
    res.json(payload);
  } catch (err) {
    console.error('[HEALTH] Database check failed:', err.message);
    res.status(503).json({ ...payload, status: 'error', dbType: db.type });
  }
});


/**
 * Quick DB Inspection Endpoint for testing persistence (admin only: it
 * returns raw rows including error messages).
 */
app.get('/api/ingest/status', requireAdmin, (req, res) => {
  try {
    const stats = repo.getQuickStats();
    const recent = db.prepare(`
      SELECT request_id, model, provider, status, is_streaming,
             prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
             estimated_cost, cost_status, latency_ms, error_type, timestamp
      FROM usage_events
      ORDER BY id DESC
      LIMIT 10
    `).all();

    res.json({
      ...stats,
      recentEvents: recent
    });
  } catch (err) {
    console.error('[INGEST-STATUS] Query failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Registers catch-all 404 + central error handlers.
 * MUST run after the routers are mounted: Express matches middleware in
 * registration order, so registering these first would shadow /api/analytics.
 */
function registerFallbackHandlers() {
  // Unknown API routes -> JSON 404 (instead of Express's HTML page)
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { message: `Not found: ${req.method} ${req.path}` } });
  });

  // Central error handler: malformed JSON becomes a 400, everything else a 500,
  // and no stack traces or raw messages ever reach the client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'Invalid JSON body' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { message: 'Request body too large' } });
    }
    console.error('[ERROR] Unhandled:', err);
    res.status(500).json({ error: { message: 'Internal server error' } });
  });
}

// Auto-start server only when executed directly (not when imported in test scripts)
const isMain = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));
if (isMain) {
  let server = null;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SERVER] ${signal} received, shutting down...`);
    if (retentionTimer) clearInterval(retentionTimer);
    const done = () => {
      try { if (db) db.close(); } catch { /* already closed */ }
      process.exit(0);
    };
    if (server) {
      server.close(done);
      setTimeout(() => process.exit(0), 5000).unref();
    } else {
      done();
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    shutdown('uncaughtException');
  });

  initializeDatabase().then(() => {
    server = app.listen(PORT, () => {
      console.log(`[SERVER] AI Usage Monitor Backend listening on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to initialize database on startup:', err);
    process.exit(1);
  });
}

export default app;
