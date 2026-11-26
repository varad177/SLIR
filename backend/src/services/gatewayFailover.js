import {
  CLOUD_DEFAULT_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  getOllamaUrls,
  normalizeModelId
} from './ollamaEndpoints.js';
import { getAdapter, joinEndpoint } from '../adapters/index.js';

const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.FAILOVER_CIRCUIT_FAILURES) || 5;
const CIRCUIT_COOLDOWN_MS = Number(process.env.FAILOVER_CIRCUIT_COOLDOWN_MS) || 30000;
const CIRCUIT_BREAKER_ENABLED = process.env.FAILOVER_CIRCUIT_BREAKER !== 'false';
const circuitState = new Map();
let lastHealthyOllama = { url: null, at: 0 };
const OLLAMA_HOST_CACHE_TTL_MS = 15000;

export function clearCircuitBreakers() {
  circuitState.clear();
  lastHealthyOllama = { url: null, at: 0 };
}

function circuitKey(target) {
  return `${target.kind}:${target.model}`;
}

function isCircuitOpen(target, now = Date.now()) {
  if (!CIRCUIT_BREAKER_ENABLED) return false;
  const state = circuitState.get(circuitKey(target));
  return Boolean(state && state.openUntil > now);
}

function recordCircuitSuccess(target) {
  circuitState.delete(circuitKey(target));
}

function recordCircuitFailure(target, reason) {
  if (!CIRCUIT_BREAKER_ENABLED) return;
  if (!['network_error', 'timeout', 'upstream_5xx'].includes(reason)) return;
  const key = circuitKey(target);
  const current = circuitState.get(key);
  const failures = (current?.failures || 0) + 1;
  circuitState.set(key, {
    failures,
    openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0
  });
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function classifyStatus(status) {
  if (status === 429) return { reason: 'rate_limit', retryable: true };
  if (status === 408) return { reason: 'timeout', retryable: true };
  if (status >= 500) return { reason: 'upstream_5xx', retryable: true };
  return { reason: 'upstream_error', retryable: false };
}

function classifyThrown(err, context, durationMs = 0) {
  const causeMsg = err?.cause?.code && err?.cause?.message
    ? `${err.cause.code}: ${err.cause.message}`
    : (err?.cause?.message || err?.cause?.code || '');
  const baseMessage = err?.message || String(err);
  const message = causeMsg && !baseMessage.includes(causeMsg)
    ? `${baseMessage} (${causeMsg})`
    : baseMessage;
  const text = `${err?.name || ''} ${message}`;
  const isTimeout = /timeout|abort/i.test(text);
  return {
    ok: false,
    retryable: true,
    reason: isTimeout ? 'timeout' : 'network_error',
    status: isTimeout ? 504 : 502,
    message,
    durationMs,
    ...context
  };
}

function failureFromResponse(response, body, context, durationMs) {
  const classification = classifyStatus(response.status);
  return {
    ok: false,
    retryable: classification.retryable,
    reason: classification.reason,
    status: response.status,
    message: body || `Upstream returned ${response.status}`,
    durationMs,
    ...context
  };
}

function logFromUsage(data, cacheStatus) {
  const usage = data?.usage || {};
  return {
    promptTokens: finiteOrNull(usage.prompt_tokens),
    completionTokens: finiteOrNull(usage.completion_tokens),
    totalTokens: finiteOrNull(usage.total_tokens),
    cacheStatus
  };
}

function parseFallbackModels(value) {
  if (Array.isArray(value)) {
    return value.filter((model) => typeof model === 'string' && model.trim());
  }
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((model) => typeof model === 'string' && model.trim()) : [];
  } catch {
    return [];
  }
}

export function buildFailoverCandidates(db, primaryModel, appRow) {
  if (!db || !appRow || !Number(appRow.failover_enabled)) return [primaryModel];

  const primary = normalizeModelId(primaryModel);
  const candidates = [primaryModel];
  for (const fallback of parseFallbackModels(appRow.fallback_models)) {
    const normalized = normalizeModelId(fallback);
    if (!normalized || normalized === primary) continue;
    if (!candidates.some((candidate) => normalizeModelId(candidate) === normalized)) {
      candidates.push(normalized);
    }
  }
  return candidates;
}

export function resolveModelTarget(db, model) {
  const normalized = normalizeModelId(model);
  let customModel = null;
  if (db && normalized) {
    try {
      customModel = db.prepare(
        'SELECT * FROM custom_models WHERE LOWER(TRIM(model_id)) = LOWER(TRIM(?)) OR model_id = ?'
      ).get(normalized, normalized);
    } catch {
      customModel = null;
    }
  }

  return customModel
    ? {
        kind: 'cloud',
        model: customModel.model_id,
        provider: customModel.provider || 'cloud',
        customModel
      }
    : {
        kind: 'local',
        model: normalized,
        provider: 'ollama',
        customModel: null
      };
}

export function eventModelForTarget(target) {
  return target.kind === 'cloud' ? target.model : `ollama/${target.model}`;
}

async function executeCloudAttempt(target, reqBody, options) {
  const startedAt = performance.now();
  const customModel = target.customModel;
  const adapter = getAdapter(customModel.format);
  const context = {
    provider: target.provider,
    model: target.model
  };
  const cloudEndpoint = joinEndpoint(customModel.api_base, adapter.getEndpointPath(customModel));
  const cloudHeaders = adapter.buildHeaders(customModel.api_key, customModel);

  let cloudPayload = adapter.buildRequestBody(reqBody, customModel);

  const timeoutMs = Number(customModel.timeout_ms) > 0
    ? Number(customModel.timeout_ms)
    : CLOUD_DEFAULT_TIMEOUT_MS;

  let cloudRes;
  try {
    cloudRes = await fetch(cloudEndpoint, {
      method: 'POST',
      headers: cloudHeaders,
      body: JSON.stringify(cloudPayload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    return classifyThrown(err, context, performance.now() - startedAt);
  }

  if (!cloudRes.ok && cloudRes.status === 400 && cloudPayload.response_format?.type === 'json_schema') {
    let errorText = '';
    try {
      errorText = await cloudRes.text();
    } catch {
      errorText = '';
    }
    console.log(`[GATEWAY] Cloud provider [${target.provider}] rejected json_schema (400), retrying with json_object...`);
    cloudPayload = {
      ...cloudPayload,
      response_format: { type: 'json_object' }
    };
    try {
      cloudRes = await fetch(cloudEndpoint, {
        method: 'POST',
        headers: cloudHeaders,
        body: JSON.stringify(cloudPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      return classifyThrown(err, context, performance.now() - startedAt);
    }
  }

  if (!cloudRes.ok && cloudRes.status === 429 && options.allowRateLimitRetry) {
    let errorText = '';
    try {
      errorText = await cloudRes.text();
    } catch {
      errorText = '';
    }
    const match = errorText.match(/try again in ([\d\.]+)s/i);
    const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 400 : 3500;
    if (waitMs <= 7000) {
      console.log(`[GATEWAY] Cloud provider [${target.provider}] hit 429 rate limit. Backing off ${waitMs}ms and retrying...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        cloudRes = await fetch(cloudEndpoint, {
          method: 'POST',
          headers: cloudHeaders,
          body: JSON.stringify(cloudPayload),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        return classifyThrown(err, context, performance.now() - startedAt);
      }
    } else {
      return failureFromResponse(cloudRes, adapter.formatErrorMessage(errorText), context, performance.now() - startedAt);
    }
  }

  if (!cloudRes.ok) {
    let errorText = '';
    try {
      errorText = await cloudRes.text();
    } catch {
      errorText = '';
    }
    return failureFromResponse(
      cloudRes,
      adapter.formatErrorMessage(errorText),
      context,
      performance.now() - startedAt
    );
  }

  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (reqBody.stream && cloudRes.body) {
    const streamTransform = adapter.createStreamTransform(customModel, reqBody);
    const upstreamRes = streamTransform
      ? new Response(cloudRes.body.pipeThrough(streamTransform), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        })
      : cloudRes;
    return {
      ok: true,
      mode: 'stream',
      provider: target.provider,
      model: target.model,
      upstreamRes,
      durationMs,
      eventModel: target.model
    };
  }

  let data;
  try {
    data = await cloudRes.json();
  } catch (err) {
    return {
      ok: false,
      retryable: false,
      reason: 'invalid_response',
      status: 502,
      message: err?.message || 'Upstream returned invalid JSON',
      provider: target.provider,
      model: target.model,
      durationMs: performance.now() - startedAt
    };
  }

  const transformed = adapter.transformResponse(data, customModel, reqBody);

  return {
    ok: true,
    mode: 'json',
    provider: target.provider,
    model: target.model,
    eventModel: target.model,
    responseBody: transformed,
    log: {
      ...adapter.extractUsage(transformed),
      cacheStatus: adapter.cacheStatus(transformed)
    },
    durationMs
  };
}

function orderedOllamaUrls() {
  const urls = getOllamaUrls();
  if (lastHealthyOllama.url && Date.now() - lastHealthyOllama.at < OLLAMA_HOST_CACHE_TTL_MS && urls.includes(lastHealthyOllama.url)) {
    return [lastHealthyOllama.url, ...urls.filter((u) => u !== lastHealthyOllama.url)];
  }
  return urls;
}

function shouldUseNativeOllamaChat(reqBody) {
  if (reqBody.stream) return false;
  if (reqBody.tools || reqBody.tool_choice || reqBody.functions || reqBody.function_call) return false;
  const messages = Array.isArray(reqBody.messages) ? reqBody.messages : [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.role === 'developer' || msg.role === 'tool' || msg.role === 'function') return false;
    if (Array.isArray(msg.content) || Array.isArray(msg.tool_calls)) return false;
    if (msg.content === null || msg.content === undefined) return false;
  }
  return true;
}

function mapOllamaFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') return undefined;
  if (responseFormat.type === 'json_object') return 'json';
  if (responseFormat.type === 'json_schema' && responseFormat.json_schema?.schema) {
    return responseFormat.json_schema.schema;
  }
  return undefined;
}

function normalizeOllamaMessage(message) {
  if (!message || typeof message !== 'object') {
    return { role: 'assistant', content: '' };
  }
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
    return message;
  }
  return {
    ...message,
    tool_calls: message.tool_calls.map((call, idx) => ({
      id: call.id || `call_${idx}`,
      type: call.type || 'function',
      function: {
        name: call.function?.name || '',
        arguments: typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {})
      }
    }))
  };
}

function buildNativeResponse(target, data) {
  const id = `chatcmpl-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const promptTokens = finiteOrNull(data.prompt_eval_count);
  const completionTokens = finiteOrNull(data.eval_count);
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: target.model,
    choices: [
      {
        index: 0,
        message: normalizeOllamaMessage(data.message),
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
    eval_duration: data.eval_duration || 0,
    log: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens !== null && completionTokens !== null
        ? promptTokens + completionTokens
        : null
    }
  };
}

async function executeLocalAttempt(target, reqBody, options) {
  const startedAt = performance.now();
  const ollamaUrls = orderedOllamaUrls();
  const context = {
    provider: 'ollama',
    model: `ollama/${target.model}`
  };
  let lastFailure = null;
  const deadUrls = new Set();

  const devConfig = options.devConfig || { temperature: 0.7, num_ctx: 4096 };
  if (shouldUseNativeOllamaChat(reqBody)) {
    const ollamaOptions = {
      temperature: reqBody.temperature !== undefined ? Number(reqBody.temperature) : devConfig.temperature,
      num_ctx: reqBody.num_ctx !== undefined ? Number(reqBody.num_ctx) : devConfig.num_ctx
    };
    const maxTokens = Number(reqBody.max_tokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) ollamaOptions.num_predict = maxTokens;
    if (reqBody.top_p !== undefined && Number.isFinite(Number(reqBody.top_p))) ollamaOptions.top_p = Number(reqBody.top_p);
    if (reqBody.stop !== undefined && reqBody.stop !== null) {
      ollamaOptions.stop = Array.isArray(reqBody.stop) ? reqBody.stop : [reqBody.stop];
    }
    if (reqBody.seed !== undefined && Number.isFinite(Number(reqBody.seed))) ollamaOptions.seed = Number(reqBody.seed);
    const format = mapOllamaFormat(reqBody.response_format);

    for (const url of ollamaUrls) {
      try {
        const chatRes = await fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: target.model,
            messages: reqBody.messages || [],
            stream: false,
            ...(format !== undefined ? { format } : {}),
            options: ollamaOptions
          }),
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
        });

        if (chatRes.ok) {
          lastHealthyOllama = { url, at: Date.now() };
          const data = await chatRes.json();
          const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
          const nsToMs = (value) => (Number.isFinite(value) && value > 0 ? Math.round((value / 1e6) * 10) / 10 : null);
          const promptEvalMs = nsToMs(data.prompt_eval_duration);
          const evalMs = nsToMs(data.eval_duration);
          const loadMs = nsToMs(data.load_duration);
          const cachedCount = Number.isFinite(data.prompt_eval_cached_count) ? data.prompt_eval_cached_count : null;
          const cacheStatus = cachedCount !== null
            ? (cachedCount > 0 ? 'cache_hit' : (promptEvalMs !== null && promptEvalMs > 3000 ? 'cold_cache' : 'standard'))
            : 'unknown';
          const native = buildNativeResponse(target, data);

          return {
            ok: true,
            mode: 'native',
            provider: 'ollama',
            model: `ollama/${target.model}`,
            eventModel: `ollama/${target.model}`,
            responseBody: native,
            log: {
              ...native.log,
              promptEvalDurationMs: promptEvalMs,
              evalDurationMs: evalMs,
              loadDurationMs: loadMs,
              cacheStatus
            },
            durationMs
          };
        }

        let body = '';
        try {
          body = await chatRes.text();
        } catch {
          body = '';
        }
        lastFailure = failureFromResponse(chatRes, body, context, performance.now() - startedAt);
        if (chatRes.status !== 404) {
          lastFailure.message = lastFailure.message || `ollama /api/chat returned ${chatRes.status}`;
        }
      } catch (err) {
        deadUrls.add(url);
        if (lastHealthyOllama.url === url) lastHealthyOllama = { url: null, at: 0 };
        lastFailure = classifyThrown(err, context, performance.now() - startedAt);
      }
    }
  }

  const { _anthropic_native: _nativeEnvelope, ...localBody } = reqBody;
  const payload = {
    ...localBody,
    model: target.model
  };
  if (payload.stream && !payload.stream_options) {
    payload.stream_options = { include_usage: true };
  }

  for (const url of ollamaUrls) {
    if (deadUrls.has(url)) continue;
    let upstreamRes;
    try {
      upstreamRes = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
      });
    } catch (err) {
      if (lastHealthyOllama.url === url) lastHealthyOllama = { url: null, at: 0 };
      lastFailure = classifyThrown(err, context, performance.now() - startedAt);
      continue;
    }

    if (!upstreamRes.ok) {
      let body = '';
      try {
        body = await upstreamRes.text();
      } catch {
        body = '';
      }
      lastFailure = failureFromResponse(upstreamRes, body, context, performance.now() - startedAt);
      continue;
    }

    lastHealthyOllama = { url, at: Date.now() };

    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    if (reqBody.stream && upstreamRes.body) {
      return {
        ok: true,
        mode: 'stream',
        provider: 'ollama',
        model: `ollama/${target.model}`,
        eventModel: `ollama/${target.model}`,
        upstreamRes,
        durationMs
      };
    }

    let data;
    try {
      data = await upstreamRes.json();
    } catch (err) {
      return {
        ok: false,
        retryable: false,
        reason: 'invalid_response',
        status: 502,
        message: err?.message || 'Upstream returned invalid JSON',
        ...context,
        durationMs: performance.now() - startedAt
      };
    }

    const usage = data.usage || {};
    const cached = usage.prompt_tokens_details?.cached_tokens;
    return {
      ok: true,
      mode: 'json',
      provider: 'ollama',
      model: `ollama/${target.model}`,
      eventModel: `ollama/${target.model}`,
      responseBody: data,
      log: logFromUsage(
        data,
        typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown'
      ),
      durationMs
    };
  }

  return lastFailure || {
    ok: false,
    retryable: true,
    reason: 'network_error',
    status: 502,
    message: 'No Ollama endpoint responded',
    ...context,
    durationMs: performance.now() - startedAt
  };
}

export async function executeModelAttempt(db, model, reqBody, options = {}) {
  const target = resolveModelTarget(db, model);

  if (isCircuitOpen(target)) {
    return {
      ok: false,
      retryable: true,
      reason: 'circuit_open',
      status: 503,
      message: `Circuit breaker is open for ${target.kind} model ${target.model}`,
      durationMs: 0,
      target
    };
  }

  const result = target.kind === 'cloud'
    ? await executeCloudAttempt(target, reqBody, options)
    : await executeLocalAttempt(target, reqBody, options);

  if (result.ok) {
    recordCircuitSuccess(target);
  } else {
    recordCircuitFailure(target, result.reason);
  }

  return {
    ...result,
    target
  };
}
