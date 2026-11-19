export const CLOUD_DEFAULT_TIMEOUT_MS = 60000;
export const LOCAL_TIMEOUT_MS = 90000;
export const CLOUD_CONNECTION_TEST_TIMEOUT_MS = 15000;

const DEFAULT_OLLAMA_URLS = [
  'http://localhost:11434',
  'http://127.0.0.1:11434',
  'http://host.docker.internal:11434',
  'http://ollama:11434'
];

export function normalizeModelId(model) {
  return String(model || '').trim().replace(/^ollama\//, '');
}

export function getOllamaUrls(preferredUrl) {
  const candidates = [
    preferredUrl,
    process.env.OLLAMA_URL,
    ...DEFAULT_OLLAMA_URLS
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

export function getPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
