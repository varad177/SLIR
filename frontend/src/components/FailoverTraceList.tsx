import React from 'react';
import { FailoverTraceEntry } from '../types/analytics';
import { failoverReasonLabel, isTraceSuccessOutcome } from '../utils/failover';

interface FailoverTraceListProps {
  trace: FailoverTraceEntry[];
  emptyMessage?: string;
}

const outcomeBadgeClass = (outcome?: string | null): 'ok' | 'warn' | 'err' => {
  if (isTraceSuccessOutcome(outcome)) return 'ok';
  if (outcome === 'budget_exceeded' || outcome === 'circuit_open' || outcome === 'rate_limit') {
    return 'warn';
  }
  return 'err';
};

/**
 * Renders an ordered step-by-step trace of failover attempts from `usage_events.failover_trace`,
 * explicitly marking Primary vs Fallback roles and whether each model failed or responded.
 */
export const FailoverTraceList: React.FC<FailoverTraceListProps> = ({ trace, emptyMessage }) => {
  if (trace.length === 0) {
    return emptyMessage ? (
      <div className="mp-failover-trace-empty">{emptyMessage}</div>
    ) : null;
  }

  return (
    <div className="mp-failover-trace-list">
      {trace.map((entry, index) => {
        const ok = isTraceSuccessOutcome(entry.outcome);
        const tone = outcomeBadgeClass(entry.outcome);
        const roleLabel = index === 0 ? 'Primary' : `Fallback #${index}`;

        return (
          <div className={`mp-failover-trace-entry ${tone}`} key={`${entry.model}-${index}`}>
            <div className="mp-failover-trace-head">
              <span className="mp-failover-trace-model font-mono" title={entry.model}>
                <span className={`mp-failover-trace-step ${tone}`}>{index + 1}</span>
                <span className={`mp-failover-trace-role ${index === 0 ? 'primary' : 'fallback'}`}>
                  {roleLabel}
                </span>
                <span>{entry.model}</span>
                {entry.provider && (
                  <span className="mp-failover-trace-provider">{entry.provider}</span>
                )}
              </span>
              <span className="mp-failover-trace-metrics font-mono">
                <span className={`mp-failover-trace-verdict ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Responded' : '✕ Failed'}
                </span>
                <span className={`mp-failover-trace-outcome ${tone}`}>
                  {failoverReasonLabel(entry.outcome)}
                </span>
                <span>{entry.status ? `HTTP ${entry.status}` : '—'}</span>
                {entry.durationMs != null && (
                  <span>{Math.round(entry.durationMs)} ms</span>
                )}
              </span>
            </div>
            {entry.message && (
              <div className="mp-failover-trace-message font-mono">{entry.message}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
