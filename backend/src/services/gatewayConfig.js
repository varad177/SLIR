const DEFAULT_GATEWAY_PORT = 4101;

export function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const normalizedPath = !pathname
    ? '/v1'
    : pathname.toLowerCase().endsWith('/v1')
      ? pathname
      : `${pathname}/v1`;

  return `${parsed.origin}${normalizedPath}`;
}

export function getPublicBaseUrl() {
  return normalizePublicBaseUrl(process.env.SLIR_PUBLIC_BASE_URL);
}

export function getGatewayPort() {
  const configured = Number(process.env.PORT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_GATEWAY_PORT;
}
