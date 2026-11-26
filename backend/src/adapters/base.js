/**
 * Base adapter contract for translating between the gateway's OpenAI-style
 * surface and an upstream provider's native API format.
 */

/**
 * Joins an API base URL and an endpoint path without duplicating a `/v1`
 * segment when the user already included it in the base URL.
 */
export function joinEndpoint(apiBase, endpointPath) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  const path = String(endpointPath || '');
  if (!path) return base;
  if (base.endsWith('/v1') && path.startsWith('/v1/')) {
    return `${base}${path.slice(3)}`;
  }
  return `${base}${path}`;
}

export function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export class BaseAdapter {
  get format() {
    return 'openai';
  }

  get endpointHint() {
    return '/chat/completions';
  }

  getEndpointPath(_modelConfig = {}) {
    return '/chat/completions';
  }

  buildHeaders(apiKey, _modelConfig = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  buildRequestBody(openaiBody, modelConfig = {}) {
    return {
      ...openaiBody,
      model: modelConfig.model_id || openaiBody.model
    };
  }

  transformResponse(providerResponse, _modelConfig = {}, _requestBody = {}) {
    return providerResponse;
  }

  extractUsage(openaiResponse) {
    const usage = openaiResponse?.usage || {};
    return {
      promptTokens: finiteOrNull(usage.prompt_tokens),
      completionTokens: finiteOrNull(usage.completion_tokens),
      totalTokens: finiteOrNull(usage.total_tokens)
    };
  }

  cacheStatus(openaiResponse) {
    const cached = openaiResponse?.usage?.prompt_tokens_details?.cached_tokens;
    return typeof cached === 'number' ? (cached > 0 ? 'cache_hit' : 'standard') : 'unknown';
  }

  /**
   * Optional provider SSE -> OpenAI SSE conversion. Returning null means the
   * provider already emits OpenAI-style chunks and the stream can be piped
   * through untouched.
   */
  createStreamTransform(_modelConfig = {}, _requestBody = {}) {
    return null;
  }

  formatErrorMessage(bodyText) {
    return bodyText;
  }
}
