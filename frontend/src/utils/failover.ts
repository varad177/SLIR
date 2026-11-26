import { FailoverTraceEntry, UsageEventItem } from '../types/analytics';

export const FAILOVER_REASON_LABELS: Record<string, string> = {
  rate_limit: 'Rate limit',
  timeout: 'Timeout',
  network_error: 'Network error',
  upstream_5xx: 'Provider 5xx',
  upstream_error: 'Provider error',
  invalid_response: 'Invalid response',
  budget_exceeded: 'Budget blocked',
  circuit_open: 'Circuit open',
  success: 'Success',
  stream_started: 'Stream started'
};

/**
 * Formats a gateway failover outcome or reason code for display.
 */
export function failoverReasonLabel(value?: string | null): string {
  if (!value) return 'Unknown';
  return FAILOVER_REASON_LABELS[value] || value;
}

/**
 * Safely parses a serialized JSON `failover_trace` column into trace entries.
 */
export function parseFailoverTrace(value?: string | null): FailoverTraceEntry[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Returns true if the trace attempt succeeded or initiated an SSE stream.
 */
export function isTraceSuccessOutcome(outcome?: string | null): boolean {
  return outcome === 'success' || outcome === 'stream_started';
}

/**
 * Returns true if the request event involves any failover attempt or trace.
 */
export function hasFailoverActivity(
  item: Pick<UsageEventItem, 'failover_used' | 'failover_from_model' | 'failover_attempts' | 'failover_trace'>
): boolean {
  return Boolean(
    item.failover_used === 1 ||
    item.failover_from_model ||
    (item.failover_attempts || 0) > 0 ||
    item.failover_trace
  );
}
