import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
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
import { createBudgetsRouter } from './api/budgetsRouter.js';
import { evaluateBudgets, getBlockingBudget } from './services/budgetService.js';
import { getGatewayPort, getPublicBaseUrl } from './services/gatewayConfig.js';
import {
  buildFailoverCandidates,
  executeModelAttempt,
  eventModelForTarget,
  resolveModelTarget
} from './services/gatewayFailover.js';
import { logger } from './utils/logger.js';
import { safeJsonStringify, truncateText } from './utils/safeJson.js';
import { createRateLimiter } from './utils/rateLimit.js';
import { anthropicToOpenAI, formatAnthropicError } from './adapters/anthropicIngress.js';
import { createOpenAIToAnthropicStream, openAIToAnthropicResponse } from './adapters/anthropicEgress.js';

// The .env file lives at the ai-usage-monitor project root, one level above
// backend/, so an explicit path is required for `npm start` run from backend/.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../wwwroot');
dotenv.config({ path: process.env.DOTENV_PATH || path.join(projectRoot, '.env') });

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 4101;
const INGEST_API_KEY = process.env.INGEST_API_KEY || 'dev-secret-key';
const MAX_SSE_CAPTURE_BYTES = Math.max(
  64 * 1024,
  Number.parseInt(process.env.SSE_CAPTURE_MAX_BYTES || String(10 * 1024 * 1024), 10) || 10 * 1024 * 1024
);

if (INGEST_API_KEY === 'dev-secret-key') {
  logger.warn('[SECURITY] INGEST_API_KEY is the well-known default "dev-secret-key". Change it in .env before exposing this service.');
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
 * Pipes an upstream SSE response straight to the client while capturing a
 * bounded amount of bytes for post-hoc usage extraction. Nothing is buffered
 * before headers are sent, so time-to-first-token is preserved and long
 * streams cannot exhaust server memory.
 *
 * When `clientTransform` is provided (e.g. converting OpenAI SSE to the
 * Anthropic event format), capture happens on the original upstream bytes so
 * usage extraction still sees OpenAI-shaped chunks.
 *
 * @param {Response} upstreamRes
 * @param {import('express').Response} res
 * @param {TransformStream|null} clientTransform
 * @returns {Promise<{text: string, truncated: boolean, error: string|null, clientDisconnected: boolean}>}
 */
async function pipeSseAndCapture(upstreamRes, res, clientTransform = null) {
  const chunks = [];
  let capturedBytes = 0;
  let truncated = false;
  let streamError = null;
  let clientDisconnected = false;

  const capture = new TransformStream({
    transform(chunk, controller) {
      const buffer = Buffer.from(chunk);
      const remaining = MAX_SSE_CAPTURE_BYTES - capturedBytes;
      if (remaining > 0) {
        const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
        chunks.push(slice);
        capturedBytes += slice.length;
      }
      if (buffer.length > remaining) truncated = true;
      controller.enqueue(chunk);
    }
  });

  let body = upstreamRes.body.pipeThrough(capture);
  if (clientTransform) body = body.pipeThrough(clientTransform);

  if (!res.headersSent) {
    res.status(200);
    res.set({
      'Content-Type': clientTransform ? 'text/event-stream' : (upstreamRes.headers.get('content-type') || 'text/event-stream'),
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }

  try {
    await pipeline(Readable.fromWeb(body), res);
  } catch (err) {
    streamError = err?.message || 'SSE pipe error';
    // A client that disconnects mid-stream is normal, not a server fault
    clientDisconnected = err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || /premature close/i.test(streamError);
    if (!clientDisconnected) logger.error('SSE pipe error', { message: streamError });
    if (!res.headersSent) res.status(502);
    if (!res.writableEnded) res.end();
  }

  return {
    text: Buffer.concat(chunks).toString('utf8'),
    truncated,
    error: streamError,
    clientDisconnected
  };
}

/**
 * Picks the last well-formed SSE data payload out of a captured stream.
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
  },
  exposedHeaders: ['X-Request-ID']
}));
app.use(express.json({ limit: '10mb' }));

// Sensitive endpoints are rate limited per client IP. This is intentionally
// lenient for a self-hosted dashboard but prevents accidental or hostile loops.
app.use('/api/analytics/clear', createRateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'clear' }));
app.use('/api/ingest/status', createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'ingest-status' }));
app.use('/api/alerts/test', createRateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'alert-test' }));
app.use('/api/models/custom/test', createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'model-test' }));
app.use('/api/models/profile', createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'profile' }));
app.use('/api/models/test-prompt', createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'test-prompt' }));

// Global DB & Service references
let db = null;
let repo = null;
let analyticsService = null;
let ollamaService = null;
let initPromise = null;
let retentionTimer = null;
let budgetTimer = null;
let budgetEvalPending = false;
let budgetEvalTimer = null;

function scheduleBudgetEvaluation() {
  if (!db || budgetEvalTimer) return;
  budgetEvalTimer = setTimeout(() => {
    budgetEvalTimer = null;
    if (budgetEvalPending || !db || db.raw?.open === false || db.raw?.isOpen === false) return;
    budgetEvalPending = true;
    evaluateBudgets(db)
      .catch((err) => logger.error('[BUDGETS] Evaluation failed', { error: err.message }))
      .finally(() => {
        budgetEvalPending = false;
      });
  }, 1000);
  budgetEvalTimer.unref?.();
}

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
      app.use('/api', createBudgetsRouter(db));

      // Periodically evaluate budget thresholds and dispatch notifications.
      budgetTimer = setInterval(() => {
        evaluateBudgets(db).catch(err => logger.error('[BUDGETS] Evaluation failed', { error: err.message }));
      }, 30 * 1000);
      budgetTimer.unref?.();
      if (existsSync(webRoot)) {
        app.use(express.static(webRoot));
        app.get('*', (req, res, next) => {
          if (req.path === '/api' || req.path.startsWith('/api/') ||
              req.path === '/v1' || req.path.startsWith('/v1/')) {
            return next();
          }
          if (!req.accepts('html')) return next();
          res.sendFile(path.join(webRoot, 'index.html'));
        });
      }
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
 *
 * `egress` optionally adapts the response for a non-OpenAI ingress (the native
 * Anthropic /v1/messages endpoint). It provides:
 *   - callType: telemetry call type
 *   - formatResponse(data): OpenAI JSON -> client JSON
 *   - createStreamTransform(): OpenAI SSE -> client SSE TransformStream
 *   - formatError(status, payload): OpenAI error -> client error payload
 */
async function handleChatCompletions(req, res, egress = null) {
  const reqStart = performance.now();
  const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()
    ? req.headers['x-request-id'].trim().slice(0, 128)
    : `req_${crypto.randomUUID()}`;
  res.setHeader('X-Request-ID', requestId);
  let appId = null;
  let isDirectClient = false;
  let appRow = null;
  let failureInfo = null;

  const sendError = (status, payload) => {
    if (egress) return res.status(status).json(egress.formatError(status, payload));
    return res.status(status).json(payload);
  };

  const persistEvent = (fields) => {
    if (!isDirectClient || !repo) return;
    try {
      const savedEvent = repo.saveEvent({
        traceId: requestId,
        applicationId: appId,
        callType: egress?.callType || 'chat.completion',
        tokensEstimated: 0,
        clientModel: typeof req.body?.model === 'string' ? req.body.model : 'active-model',
        httpStatus: fields.status === 'failure' ? null : 200,
        timestamp: new Date().toISOString(),
        ...fields
      });
      if (savedEvent?.inserted) {
        scheduleBudgetEvaluation();
      }
    } catch (e) {
      logger.error('Error persisting direct event', { requestId, message: e.message });
    }
  };

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

  const failoverMetadata = (trace, primaryModel, reason, attempts, used, active) => {
    if (!active) {
      return {
        failoverUsed: 0,
        failoverFromModel: null,
        failoverReason: null,
        failoverAttempts: 0,
        failoverTrace: null
      };
    }
    return {
      failoverUsed: used ? 1 : 0,
      failoverFromModel: primaryModel,
      failoverReason: reason,
      failoverAttempts: attempts,
      failoverTrace: safeJsonStringify(trace, '[]')
    };
  };

  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token && token.startsWith('mp_live_')) {
        if (db) {
          try {
            appRow = db.prepare(
              'SELECT id, name, default_model, failover_enabled, fallback_models FROM applications WHERE api_key = ?'
            ).get(token);
          } catch (e) {
            logger.error('[GATEWAY] API key lookup failed', { error: e.message });
          }
        }
        if (!appRow) {
          return sendError(401, { error: { message: 'Unauthorized: unknown API key' } });
        }
        appId = appRow.id;
        isDirectClient = true;
      }
    }
    res.setHeader('X-SLIR-Telemetry', isDirectClient ? 'recorded' : 'skipped');

    if (req.body.model !== undefined && req.body.model !== null && typeof req.body.model !== 'string') {
      return sendError(400, { error: { message: 'Invalid request: "model" must be a string' } });
    }

    const activeModel = (ollamaService && db) ? ollamaService.getActiveModel(db) : 'qwen2.5:3b';
    const appDefaultModel = appRow?.default_model;
    const requestedModel = req.body.model;
    const usesActiveAlias = !requestedModel || requestedModel === 'active-model';
    const targetModel = usesActiveAlias
      ? (appDefaultModel && appDefaultModel !== 'active-model' ? appDefaultModel : activeModel)
      : requestedModel.replace(/^ollama\//, '');

    const primaryTarget = resolveModelTarget(db, targetModel);
    const primaryEventModel = eventModelForTarget(primaryTarget);
    failureInfo = {
      provider: primaryTarget.provider,
      model: primaryEventModel,
      isStreaming: req.body.stream ? 1 : 0
    };

    const blockingBudget = (db && appId) ? getBlockingBudget(db, appId, primaryEventModel) : null;
    if (blockingBudget) {
      const message = `Budget "${blockingBudget.name}" exceeded: `
        + `${Math.round(blockingBudget.usage * 100) / 100} of ${blockingBudget.limit} ${blockingBudget.metric} used this ${blockingBudget.period} (${blockingBudget.percentage}%).`;
      persistFailure({
        errorType: 'budget_exceeded',
        errorMessage: message,
        httpStatus: 429
      });
      return sendError(429, {
        error: {
          message,
          type: 'budget_exceeded',
          code: 'budget_exceeded',
          budget: blockingBudget
        }
      });
    }

    const candidates = isDirectClient
      ? buildFailoverCandidates(db, targetModel, appRow)
      : [targetModel];
    const allowRateLimitRetry = candidates.length === 1;
    const devConfig = (ollamaService && db) ? ollamaService.getDevConfig(db) : { temperature: 0.7, num_ctx: 4096 };
    const trace = [];
    let fallbackAttempts = 0;
    let firstFailureReason = null;
    let lastFailure = null;
    let success = null;
    let usedFallback = false;

    for (let index = 0; index < candidates.length; index += 1) {
      const model = candidates[index];
      const target = resolveModelTarget(db, model);
      const eventModel = eventModelForTarget(target);

      if (index > 0) {
        const candidateBudget = (db && appId) ? getBlockingBudget(db, appId, eventModel) : null;
        if (candidateBudget) {
          trace.push({
            model: eventModel,
            provider: target.provider,
            outcome: 'budget_exceeded',
            status: 429,
            durationMs: 0,
            message: `Budget "${candidateBudget.name}" exceeded`
          });
          continue;
        }
        fallbackAttempts += 1;
      }

      failureInfo = {
        provider: target.provider,
        model: eventModel,
        isStreaming: req.body.stream ? 1 : 0
      };

      const result = await executeModelAttempt(db, model, req.body, {
        allowRateLimitRetry,
        devConfig
      });
      const durationMs = Math.round((Number(result.durationMs) || 0) * 10) / 10;

      if (result.ok) {
        success = { ...result, target, eventModel, durationMs };
        trace.push({
          model: eventModel,
          provider: target.provider,
          outcome: result.mode === 'stream' ? 'stream_started' : 'success',
          status: 200,
          durationMs
        });
        usedFallback = index > 0;
        break;
      }

      lastFailure = result;
      trace.push({
        model: eventModel,
        provider: target.provider,
        outcome: result.reason,
        status: result.status,
        durationMs,
        message: String(result.message || '').slice(0, 500)
      });
      if (index === 0) firstFailureReason = result.reason;
      if (!result.retryable) break;
    }

    const failoverActive = usedFallback
      || fallbackAttempts > 0
      || trace.some((entry) => entry.outcome === 'budget_exceeded');

    if (!success) {
      const status = lastFailure?.status || 502;
      const reason = lastFailure?.reason;
      const errorType = reason === 'rate_limit'
        ? 'upstream_rate_limit'
        : reason === 'timeout'
          ? 'upstream_timeout'
          : reason === 'network_error'
            ? 'upstream_network'
            : `upstream_${status}`;
      const message = lastFailure?.message || 'Upstream request failed';
      persistFailure({
        errorType,
        errorMessage: message,
        httpStatus: status,
        ...failoverMetadata(
          trace,
          primaryEventModel,
          firstFailureReason,
          fallbackAttempts,
          false,
          failoverActive
        )
      });
      return sendError(status, {
        error: {
          message: `Failed to route to model ${failureInfo?.model || primaryEventModel}: ${message}`,
          code: status,
          type: errorType
        }
      });
    }

    const failover = failoverMetadata(
      trace,
      primaryEventModel,
      firstFailureReason,
      fallbackAttempts,
      usedFallback,
      failoverActive
    );

    if (success.mode === 'stream') {
      const clientTransform = egress ? egress.createStreamTransform() : null;
      const captureResult = await pipeSseAndCapture(success.upstreamRes, res, clientTransform);
      const latencyMs = Math.round((performance.now() - reqStart) * 10) / 10;
      const finalChunk = extractSseUsage(captureResult.text) || {};
      const usage = finalChunk.usage || {};
      const cached = usage.prompt_tokens_details?.cached_tokens;
      const usageFields = {
        promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
        completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
        totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
        promptEvalDurationMs: null,
        evalDurationMs: null,
        loadDurationMs: null,
        cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown'
      };

      if (captureResult.error) {
        persistFailure({
          errorType: captureResult.clientDisconnected ? 'client_disconnect' : 'stream_error',
          errorMessage: truncateText(captureResult.error),
          httpStatus: captureResult.clientDisconnected ? 499 : 502,
          ...usageFields,
          ...failover
        });
        return;
      }

      persistEvent({
        requestId: finalChunk.id || `chatcmpl-${crypto.randomUUID()}`,
        provider: success.provider,
        model: success.eventModel,
        status: 'success',
        isStreaming: 1,
        latencyMs,
        ...usageFields,
        ...failover
      });
      return;
    }

    const data = success.responseBody;
    persistEvent({
      requestId: data?.id || `chatcmpl-${crypto.randomUUID()}`,
      provider: success.provider,
      model: success.eventModel,
      status: 'success',
      isStreaming: 0,
      httpStatus: 200,
      promptTokens: success.log?.promptTokens ?? null,
      completionTokens: success.log?.completionTokens ?? null,
      totalTokens: success.log?.totalTokens ?? null,
      latencyMs: Math.round((performance.now() - reqStart) * 10) / 10,
      promptEvalDurationMs: success.log?.promptEvalDurationMs ?? null,
      evalDurationMs: success.log?.evalDurationMs ?? null,
      loadDurationMs: success.log?.loadDurationMs ?? null,
      cacheStatus: success.log?.cacheStatus || 'unknown',
      ...failover
    });
    return res.status(200).json(egress ? egress.formatResponse(data) : data);
  } catch (err) {
    logger.error('Dynamic routing error', { requestId, message: err.message, stack: err.stack });
    if (failureInfo) {
      persistFailure({ errorType: 'gateway_error', errorMessage: truncateText(err.message), httpStatus: 500 });
    }
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    return sendError(500, { error: { message: 'Internal routing error', requestId } });
  }
}

/**
 * OpenAI-compatible ingress (standard Chat Completions).
 */
app.post(['/v1/chat/completions', '/api/v1/chat/completions'], (req, res) => (
  handleChatCompletions(req, res)
));

/**
 * Native Anthropic Messages API ingress. Accepts requests from the official
 * Anthropic SDKs, converts them to the internal OpenAI shape, runs the same
 * routing/failover/budget pipeline, then converts the response (JSON or SSE)
 * back to the Anthropic format.
 */
app.post(['/v1/messages', '/api/v1/messages'], (req, res) => {
  if (!req.headers.authorization
    && typeof req.headers['x-api-key'] === 'string'
    && req.headers['x-api-key'].trim()) {
    req.headers.authorization = `Bearer ${req.headers['x-api-key'].trim()}`;
  }

  const clientModel = typeof req.body?.model === 'string' && req.body.model
    ? req.body.model
    : 'active-model';

  let openaiBody;
  try {
    openaiBody = anthropicToOpenAI(req.body);
  } catch (err) {
    return res.status(400).json(formatAnthropicError(400, { error: { message: err.message } }));
  }

  req.body = openaiBody;
  return handleChatCompletions(req, res, {
    callType: 'anthropic.messages',
    formatResponse: (data) => openAIToAnthropicResponse(data, { model: clientModel }),
    createStreamTransform: () => createOpenAIToAnthropicStream({ model: clientModel }),
    formatError: formatAnthropicError
  });
});

/**
 * Public runtime configuration consumed by the browser UI.
 * container orchestrators do not route traffic to a dead instance.
 */
app.get('/api/config', (req, res) => {
  res.json({
    publicBaseUrl: getPublicBaseUrl(),
    gatewayPort: getGatewayPort()
  });
});

let ollamaHealthCache = { at: 0, value: null };

async function getOllamaHealth() {
  if (!ollamaService) return { status: 'initializing' };
  const now = Date.now();
  if (ollamaHealthCache.value && now - ollamaHealthCache.at < 30 * 1000) {
    return ollamaHealthCache.value;
  }
  try {
    const result = await ollamaService.getInstalledModels();
    const value = {
      status: result.success ? 'ok' : 'unavailable',
      host: result.host || null,
      modelCount: result.models?.length || 0,
      warning: result.warning || null
    };
    ollamaHealthCache = { at: now, value };
    return value;
  } catch (err) {
    const value = { status: 'error', message: err.message };
    ollamaHealthCache = { at: now, value };
    return value;
  }
}

app.get('/api/metrics', (req, res) => {
  if (!db) {
    res.status(503).type('text/plain').send('# SLIR database is still initializing\n');
    return;
  }
  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN failover_used = 1 THEN 1 ELSE 0 END) AS failovers,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(estimated_cost), 0) AS cost,
        COALESCE(AVG(latency_ms), 0) AS avg_latency
      FROM usage_events
    `).get();
    const byModel = db.prepare(`
      SELECT model, COUNT(*) AS requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
        COALESCE(AVG(latency_ms), 0) AS avg_latency
      FROM usage_events
      GROUP BY model
    `).all();
    const unacknowledged = db.prepare('SELECT COUNT(*) AS count FROM budget_alerts WHERE acknowledged = 0').get();
    const lines = [
      '# HELP slir_requests_total Total gateway requests persisted',
      '# TYPE slir_requests_total counter',
      `slir_requests_total ${Number(totals.requests) || 0}`,
      '# TYPE slir_requests_success_total counter',
      `slir_requests_success_total ${Number(totals.successes) || 0}`,
      '# TYPE slir_failovers_total counter',
      `slir_failovers_total ${Number(totals.failovers) || 0}`,
      '# TYPE slir_tokens_total counter',
      `slir_tokens_total ${Number(totals.tokens) || 0}`,
      '# TYPE slir_cost_usd_total counter',
      `slir_cost_usd_total ${Number(totals.cost) || 0}`,
      '# TYPE slir_latency_ms_avg gauge',
      `slir_latency_ms_avg ${Math.round(Number(totals.avg_latency) || 0)}`,
      '# TYPE slir_budget_alerts_unacknowledged gauge',
      `slir_budget_alerts_unacknowledged ${Number(unacknowledged?.count) || 0}`,
      '# TYPE slir_uptime_seconds gauge',
      `slir_uptime_seconds ${Math.floor(process.uptime())}`
    ];
    for (const row of byModel) {
      const model = String(row.model || 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const requests = Number(row.requests) || 0;
      const successes = Number(row.successes) || 0;
      lines.push(
        `slir_model_requests_total{model="${model}"} ${requests}`,
        `slir_model_success_total{model="${model}"} ${successes}`,
        `slir_model_latency_ms_avg{model="${model}"} ${Math.round(Number(row.avg_latency) || 0)}`
      );
    }
    res.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  } catch (err) {
    logger.error('Failed to build Prometheus metrics', { error: err.message });
    res.status(500).type('text/plain').send('# metrics unavailable\n');
  }
});

/**
 * Health check endpoint reports unhealthy when the DB cannot be reached so
 * container orchestrators do not route traffic to a dead instance.
 */
app.get('/api/health', async (req, res) => {
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
    const deep = req.query.deep === '1' || req.query.deep === 'true';
    if (deep) {
      payload.dependencies = { ollama: await getOllamaHealth() };
      if (payload.dependencies.ollama.status !== 'ok') payload.status = 'degraded';
    }
    res.json(payload);
  } catch (err) {
    logger.error('Database health check failed', { message: err.message });
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
    logger.error('[INGEST-STATUS] Query failed', { error: err.message });
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
    logger.error('Unhandled request error', { error: err?.stack || err?.message || String(err) });
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
    logger.info(`[SERVER] ${signal} received, shutting down...`);
    if (retentionTimer) clearInterval(retentionTimer);
    if (budgetTimer) clearInterval(budgetTimer);
    if (budgetEvalTimer) clearTimeout(budgetEvalTimer);
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
    logger.error('[FATAL] Unhandled promise rejection', { error: reason?.stack || String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('[FATAL] Uncaught exception', { error: err?.stack || err?.message || String(err) });
    shutdown('uncaughtException');
  });

  initializeDatabase().then(() => {
    server = app.listen(PORT, () => {
      logger.info(`[SERVER] AI Usage Monitor Backend listening on port ${PORT}`);
    });
  }).catch(err => {
    logger.error('Failed to initialize database on startup', { error: err?.stack || err?.message || String(err) });
    process.exit(1);
  });
}

export default app;
