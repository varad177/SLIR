export function safeJsonStringify(value, fallback = null) {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export function truncateText(value, maxLength = 500) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
