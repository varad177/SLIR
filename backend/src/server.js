import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
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
import { createBudgetsRouter } from './api/budgetsRouter.js';
import { evaluateBudgets, getBlockingBudget } from './services/budgetService.js';
import { getGatewayPort, getPublicBaseUrl } from './services/gatewayConfig.js';
import {
  buildFailoverCandidates,
  executeModelAttempt,
  eventModelForTarget,
  resolveModelTarget
} from './services/gatewayFailover.js';

// The .env file lives at the ai-usage-monitor project root, one level above
// backend/, so an explicit path is required for `npm start` run from backend/.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../wwwroot');
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
let budgetTimer = null;

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
        evaluateBudgets(db).catch(err => console.error('[BUDGETS] Evaluation failed:', err.message));
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
 */
app.post(['/v1/chat/completions', '/api/v1/chat/completions'], async (req, res) => {
  const reqStart = performance.now();
  let appId = null;
  let isDirectClient = false;
  let appRow = null;
  let failureInfo = null;

  const persistEvent = (fields) => {
    if (!isDirectClient || !repo) return;
    try {
      repo.saveEvent({
        traceId: null,
        applicationId: appId,
        callType: 'chat.completion',
        tokensEstimated: 0,
        clientModel: typeof req.body?.model === 'string' ? req.body.model : 'active-model',
        httpStatus: fields.status === 'failure' ? null : 200,
        timestamp: new Date().toISOString(),
        ...fields
      });
    } catch (e) {
      console.error('[GATEWAY] Error persisting direct event:', e.message);
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
      failoverTrace: JSON.stringify(trace)
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
            console.error('[GATEWAY] API key lookup failed:', e.message);
          }
        }
        if (!appRow) {
          return res.status(401).json({ error: { message: 'Unauthorized: unknown API key' } });
        }
        appId = appRow.id;
        isDirectClient = true;
      }
    }

    if (req.body.model !== undefined && req.body.model !== null && typeof req.body.model !== 'string') {
      return res.status(400).json({ error: { message: 'Invalid request: "model" must be a string' } });
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
      return res.status(429).json({
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
      return res.status(status).json({
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
      const latencyMs = Math.round((performance.now() - reqStart) * 10) / 10;
      let captured;
      try {
        captured = await pipeSseAndCapture(success.upstreamRes, res);
      } catch (err) {
        persistFailure({ errorType: 'stream_error', errorMessage: err.message, ...failover });
        throw err;
      }
      const finalChunk = extractSseUsage(captured) || {};
      const usage = finalChunk.usage || {};
      const cached = usage.prompt_tokens_details?.cached_tokens;
      persistEvent({
        requestId: finalChunk.id || `chatcmpl-${crypto.randomUUID()}`,
        provider: success.provider,
        model: success.eventModel,
        status: 'success',
        isStreaming: 1,
        promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
        completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
        totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
        latencyMs,
        promptEvalDurationMs: null,
        evalDurationMs: null,
        loadDurationMs: null,
        cacheStatus: typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown',
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
    return res.status(200).json(data);
  } catch (err) {
    console.error('[DYNAMIC-ROUTER] Routing error:', err);
    if (failureInfo) {
      persistFailure({ errorType: 'gateway_error', errorMessage: err.message, httpStatus: 500 });
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
app.get('/api/config', (req, res) => {
  res.json({
    publicBaseUrl: getPublicBaseUrl(),
    gatewayPort: getGatewayPort()
  });
});

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
    if (budgetTimer) clearInterval(budgetTimer);
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
