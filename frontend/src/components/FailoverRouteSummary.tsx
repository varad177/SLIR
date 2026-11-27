import React from 'react';
import { UsageEventItem } from '../types/analytics';
import { buildFailoverSummary, failoverReasonLabel } from '../utils/failover';

interface FailoverRouteSummaryProps {
  item: UsageEventItem;
  showProvider?: boolean;
}

const compactError = (msg?: string | null) => {
  if (!msg) return '';
  return msg.length > 76 ? `${msg.slice(0, 73)}...` : msg;
};

/**
 * Renders a table cell summarizing which model served a request—highlighting any
 * failed primary/fallback hops and the final responding model when failover ran.
 */
export const FailoverRouteSummary: React.FC<FailoverRouteSummaryProps> = ({
  item,
  showProvider = true
}) => {
  const summary = buildFailoverSummary(item);

  if (!summary.active) {
    return (
      <div className="mp-route-cell">
        <div className="mp-table-primary font-mono">{item.model}</div>
        {showProvider && <div className="mp-table-secondary font-mono">{item.provider}</div>}
        {item.status === 'failure' && item.error_message && (
          <div className="mp-table-error-snippet font-mono" title={item.error_message}>
            {compactError(item.error_message)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mp-route-cell">
      <div className="mp-route-cell-head font-mono">
        <span className={`mp-failover-badge ${summary.responderModel ? 'used' : 'failed'}`}>
          {summary.responderModel ? 'Failover' : 'Failover failed'}
        </span>
        {summary.responderModel ? (
          <strong className="mp-route-responder" title={`Response delivered by ${summary.responderModel}`}>
            {summary.responderModel}
          </strong>
        ) : (
          <span className="mp-failover-answered-tag err">No response</span>
        )}
      </div>

      <div className="mp-failover-flow font-mono">
        {summary.hops.map((hop, index) => {
          const detailParts = [
            hop.status ? `HTTP ${hop.status}` : null,
            !hop.ok ? failoverReasonLabel(hop.outcome) : null
          ].filter(Boolean);
          const detail = detailParts.join(' · ');
          const tip = [
            `${hop.role}: ${hop.model}`,
            hop.ok ? 'Served response' : `Failed (${detail || 'error'})`,
            hop.message || null
          ].filter(Boolean).join(' — ');

          return (
            <React.Fragment key={`${hop.role}-${hop.model}-${index}`}>
              {index > 0 && <span className="mp-hop-arrow" aria-hidden="true">→</span>}
              <span className={`mp-hop ${hop.ok ? 'ok' : 'err'}`} title={tip}>
                <span className="mp-hop-mark">{hop.ok ? '✓' : '✕'}</span>
                <span className="mp-hop-role">{hop.ok ? 'Served' : `${hop.role} failed`}:</span>
                <span className="mp-hop-model">{hop.model}</span>
                {!hop.ok && detail && <span className="mp-hop-meta">({detail})</span>}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Renders an explicit Failed -> Served visual banner inside detail drawers and cards
 * so users immediately see which model failed and which model answered.
 */
export const FailoverOutcomeBanner: React.FC<{ item: UsageEventItem }> = ({ item }) => {
  const summary = buildFailoverSummary(item);
  if (!summary.active) return null;

  const failedList = summary.failedHops.length > 0
    ? summary.failedHops.map((h) => `${h.model}${h.status ? ` (${h.status})` : ''}`).join(', ')
    : (item.failover_from_model || 'Primary model');

  return (
    <div className={`mp-failover-outcome-banner ${summary.responderModel ? 'ok' : 'err'}`}>
      <div className="mp-failover-outcome-slot err">
        <span>Failed {summary.failedHops.length > 1 ? `(${summary.failedHops.length})` : 'model'}</span>
        <strong className="font-mono" title={failedList}>{failedList}</strong>
        {summary.triggerReason && (
          <small>{failoverReasonLabel(summary.triggerReason)}</small>
        )}
      </div>
      <span className="mp-failover-outcome-arrow" aria-hidden="true">→</span>
      <div className={`mp-failover-outcome-slot ${summary.responderModel ? 'ok' : 'err'}`}>
        <span>{summary.responderModel ? 'Response from' : 'Final result'}</span>
        <strong className="font-mono" title={summary.responderModel || 'No upstream response'}>
          {summary.responderModel || 'All fallbacks failed'}
        </strong>
        <small>
          {summary.responderModel
            ? `Delivered on attempt #${summary.hops.findIndex((h) => h.ok) + 1 || (item.failover_attempts || 1) + 1}`
            : `Tried ${Math.max(summary.hops.length, (item.failover_attempts || 0) + 1)} model(s)`}
        </small>
      </div>
    </div>
  );
};
