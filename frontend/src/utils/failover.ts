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

export interface FailoverHop {
  role: string;
  model: string;
  provider?: string;
  ok: boolean;
  outcome: string;
  status?: number | null;
  durationMs?: number;
  message?: string;
}

export interface FailoverSummary {
  active: boolean;
  hops: FailoverHop[];
  failedHops: FailoverHop[];
  responderHop: FailoverHop | null;
  responderModel: string | null;
  failedModels: string[];
  primaryModel: string;
  triggerReason: string | null;
  trace: FailoverTraceEntry[];
}

/**
 * Derives an ordered, human-readable failover hop chain and outcome summary
 * from a request event's trace or failover metadata.
 */
export function buildFailoverSummary(
  item: Pick<
    UsageEventItem,
    'model' | 'provider' | 'http_status' | 'error_message' | 'failover_used' | 'failover_from_model' | 'failover_reason' | 'failover_attempts' | 'failover_trace'
  >
): FailoverSummary {
  const active = hasFailoverActivity(item);
  const trace = parseFailoverTrace(item.failover_trace);

  if (!active) {
    return {
      active: false,
      hops: [],
      failedHops: [],
      responderHop: null,
      responderModel: null,
      failedModels: [],
      primaryModel: item.model,
      triggerReason: null,
      trace: []
    };
  }

  const hops: FailoverHop[] = [];
  if (trace.length > 0) {
    trace.forEach((entry, index) => {
      hops.push({
        role: index === 0 ? 'Primary' : `Fallback #${index}`,
        model: entry.model,
        provider: entry.provider,
        ok: isTraceSuccessOutcome(entry.outcome),
        outcome: entry.outcome,
        status: entry.status,
        durationMs: entry.durationMs,
        message: entry.message
      });
    });
    if (item.failover_used === 1 && !hops.some((hop) => hop.ok)) {
      hops.push({
        role: `Fallback #${hops.length}`,
        model: item.model,
        provider: item.provider,
        ok: true,
        outcome: 'success',
        status: item.http_status
      });
    }
  } else {
    hops.push({
      role: 'Primary',
      model: item.failover_from_model || 'Primary model',
      ok: false,
      outcome: item.failover_reason || 'upstream_error'
    });
    if (item.failover_used === 1) {
      hops.push({
        role: 'Fallback #1',
        model: item.model,
        provider: item.provider,
        ok: true,
        outcome: 'success',
        status: item.http_status
      });
    } else if (item.model && item.model !== item.failover_from_model) {
      hops.push({
        role: 'Fallback #1',
        model: item.model,
        provider: item.provider,
        ok: false,
        outcome: item.failover_reason || 'upstream_error',
        status: item.http_status,
        message: item.error_message || undefined
      });
    }
  }

  const failedHops = hops.filter((hop) => !hop.ok);
  const responderHop = hops.find((hop) => hop.ok) || null;
  const triggerReason = item.failover_reason || failedHops[0]?.outcome || null;

  return {
    active: true,
    hops,
    failedHops,
    responderHop,
    responderModel: responderHop?.model || (item.failover_used === 1 ? item.model : null),
    failedModels: failedHops.map((hop) => hop.model),
    primaryModel: hops[0]?.model || item.failover_from_model || item.model,
    triggerReason,
    trace
  };
}
