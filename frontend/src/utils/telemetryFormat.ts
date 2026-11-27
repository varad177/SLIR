import { UsageEventItem } from '../types/analytics';

/**
 * Splits an ISO timestamp into UTC time (`HH:MM:SS`) and date (`YYYY-MM-DD`) strings.
 */
export function formatTimestampParts(iso?: string): { time: string; date: string } {
  if (!iso) return { time: '--:--:--', date: '----/--/--' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    const parts = iso.split('T');
    return {
      time: parts[1]?.replace('Z', '').slice(0, 8) || iso,
      date: parts[0] || ''
    };
  }
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return {
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  };
}

/**
 * Formats milliseconds into `ms` or `s` for display.
 */
export function formatLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)} ms`;
}

/**
 * Formats an optional phase latency breakdown value in seconds or `n/a`.
 */
export function formatBreakdown(ms: number | null | undefined): string {
  return ms != null ? `${(ms / 1000).toFixed(2)}s` : 'n/a';
}

/**
 * Returns the display HTTP status code or fallback label for a request event.
 */
export function requestStatusLabel(item: Pick<UsageEventItem, 'http_status' | 'status'>): string {
  if (item.http_status) return String(item.http_status);
  return item.status === 'success' ? '200' : 'error';
}
