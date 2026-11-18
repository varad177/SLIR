const CLOUD_DEFAULT_TIMEOUT_MS = 60000;
const LOCAL_TIMEOUT_MS = 90000;

function normalizeModelId(model) {
  return String(model || '').trim().replace(/^ollama\//, '');
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

function classifyThrown(err, context) {
  const text = `${err?.name || ''} ${err?.message || ''}`;
  const isTimeout = /timeout|abort/i.test(text);
  return {
    ok: false,
    retryable: true,
    reason: isTimeout ? 'timeout' : 'network_error',
    status: isTimeout ? 504 : 502,
    message: err?.message || String(err),
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

function cloudCacheStatus(data) {
  const cached = data?.usage?.prompt_tokens_details?.cached_tokens;
  return typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown';
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

function getOllamaUrls() {
  return [
    process.env.OLLAMA_URL,
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://host.docker.internal:11434',
    'http://ollama:11434'
  ].filter(Boolean);
}

async function executeCloudAttempt(target, reqBody, options) {
  const startedAt = performance.now();
  const customModel = target.customModel;
  const context = {
    provider: target.provider,
    model: target.model
  };
  const cloudEndpoint = `${customModel.api_base}/chat/completions`;
  const cloudHeaders = { 'Content-Type': 'application/json' };
  if (customModel.api_key) {
    cloudHeaders.Authorization = `Bearer ${customModel.api_key}`;
  }

  let cloudPayload = {
    ...reqBody,
    model: customModel.model_id
  };
  if (cloudPayload.stream && !cloudPayload.stream_options) {
    cloudPayload.stream_options = { include_usage: true };
  }

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
    return classifyThrown(err, context);
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
      return classifyThrown(err, context);
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
        return classifyThrown(err, context);
      }
    } else {
      return failureFromResponse(cloudRes, errorText, context, performance.now() - startedAt);
    }
  }

  if (!cloudRes.ok) {
    let errorText = '';
    try {
      errorText = await cloudRes.text();
    } catch {
      errorText = '';
    }
    return failureFromResponse(cloudRes, errorText, context, performance.now() - startedAt);
  }

  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (reqBody.stream && cloudRes.body) {
    return {
      ok: true,
      mode: 'stream',
      provider: target.provider,
      model: target.model,
      upstreamRes: cloudRes,
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

  return {
    ok: true,
    mode: 'json',
    provider: target.provider,
    model: target.model,
    eventModel: target.model,
    responseBody: data,
    log: logFromUsage(data, cloudCacheStatus(data)),
    durationMs
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
  const ollamaUrls = getOllamaUrls();
  const context = {
    provider: 'ollama',
    model: `ollama/${target.model}`
  };
  let lastFailure = null;

  const devConfig = options.devConfig || { temperature: 0.7, num_ctx: 4096 };
  if (!reqBody.stream) {
    for (const url of ollamaUrls) {
      try {
        const chatRes = await fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: target.model,
            messages: reqBody.messages || [],
            stream: false,
            options: {
              temperature: reqBody.temperature !== undefined ? Number(reqBody.temperature) : devConfig.temperature,
              num_ctx: reqBody.num_ctx !== undefined ? Number(reqBody.num_ctx) : devConfig.num_ctx
            }
          }),
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
        });

        if (chatRes.ok) {
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
        lastFailure = classifyThrown(err, context);
      }
    }
  }

  const payload = {
    ...reqBody,
    model: target.model
  };

  for (const url of ollamaUrls) {
    let upstreamRes;
    try {
      upstreamRes = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
      });
    } catch (err) {
      lastFailure = classifyThrown(err, context);
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
  const result = target.kind === 'cloud'
    ? await executeCloudAttempt(target, reqBody, options)
    : await executeLocalAttempt(target, reqBody, options);

  return {
    ...result,
    target
  };
}
