import { BaseAdapter } from './base.js';

/**
 * OpenAI Chat Completions format. Requests and responses pass through with the
 * upstream model identifier substituted; streaming usage is always requested.
 */
export class OpenAIAdapter extends BaseAdapter {
  get format() {
    return 'openai';
  }

  buildRequestBody(openaiBody, modelConfig = {}) {
    const body = super.buildRequestBody(openaiBody, modelConfig);
    delete body._anthropic_native;
    const configuredMax = Number(modelConfig.max_output_tokens);
    if (Number.isFinite(configuredMax) && configuredMax > 0 && Number.isFinite(Number(body.max_tokens))) {
      body.max_tokens = Math.min(Number(body.max_tokens), configuredMax);
    }
    if (body.stream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}
