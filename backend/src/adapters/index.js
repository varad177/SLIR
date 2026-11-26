import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

const ADAPTERS = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter()
};

export const SUPPORTED_FORMATS = Object.keys(ADAPTERS);

/**
 * Unknown or missing formats fall back to the OpenAI-compatible behavior so
 * pre-existing models keep working unchanged.
 */
export function normalizeFormat(format) {
  const value = String(format || '').trim().toLowerCase();
  return SUPPORTED_FORMATS.includes(value) ? value : 'openai';
}

export function getAdapter(format) {
  return ADAPTERS[normalizeFormat(format)];
}

export { BaseAdapter, joinEndpoint, finiteOrNull } from './base.js';
