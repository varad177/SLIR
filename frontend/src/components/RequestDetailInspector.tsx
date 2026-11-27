import React, { useState } from 'react';
import { UsageEventItem } from '../types/analytics';
import { copyText } from '../utils/clipboard';
import { failoverReasonLabel, hasFailoverActivity, parseFailoverTrace } from '../utils/failover';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import { formatLatency, requestStatusLabel } from '../utils/telemetryFormat';
import { CheckIcon, CopyIcon, CloseIcon } from './icons/Icons';
import { InfoTip } from './InfoTip';
import { FailoverTraceList } from './FailoverTraceList';
import { FailoverOutcomeBanner } from './FailoverRouteSummary';

interface RequestDetailInspectorProps {
  item: UsageEventItem;
  gatewayPort?: number;
  onClose: () => void;
  onOpenInLogs?: (requestId: string) => void;
  onReplayInPlayground?: () => void;
}

/**
 * Shared request inspection panel displaying status, model routing, failover hop trace,
 * token breakdown, latency stages, and upstream error details.
 */
export const RequestDetailInspector: React.FC<RequestDetailInspectorProps> = ({
  item,
  gatewayPort,
  onClose,
  onOpenInLogs,
  onReplayInPlayground
}) => {
  const [copied, setCopied] = useState<'request' | 'json' | 'curl' | null>(null);

  const promptTokens = item.prompt_tokens ?? 0;
  const completionTokens = item.completion_tokens ?? 0;
  const totalTokens = item.total_tokens ?? promptTokens + completionTokens;
  const promptPercent = totalTokens > 0 ? Math.round((promptTokens / totalTokens) * 100) : 0;
  const generationTps = item.eval_duration_ms && item.completion_tokens
    ? Math.round((item.completion_tokens / (item.eval_duration_ms / 1000)) * 10) / 10
    : 0;
  const failoverActive = hasFailoverActivity(item);
  const failoverTrace = parseFailoverTrace(item.failover_trace);

  const copyInspectorText = async (kind: 'request' | 'json' | 'curl') => {
    const text = kind === 'request'
      ? item.request_id
      : kind === 'curl'
        ? `curl ${getBrowserGatewayBaseUrl(gatewayPort)}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $SLIR_APP_KEY" \\\n  -H "X-Request-ID: ${item.trace_id || item.request_id}" \\\n  -d '{"model":"${item.client_model || item.model}","messages":[{"role":"user","content":"Hello"}]}'`
        : JSON.stringify(item, null, 2);
    if (!text) return;
    if (await copyText(text)) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <aside className="mp-card mp-inspector" aria-label="Request telemetry detail">
      <div className="mp-inspector-head">
        <div>
          <div className="mp-eyebrow">Request detail</div>
          <div className="mp-inspector-id font-mono" title={item.request_id}>
            {item.request_id}
          </div>
        </div>
        <div className="mp-inspector-actions">
          <button className="mp-icon-btn" onClick={() => copyInspectorText('request')} title="Copy request ID">
            {copied === 'request' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
          <button className="mp-icon-btn" onClick={() => copyInspectorText('curl')} title="Copy as cURL">
            {copied === 'curl' ? <CheckIcon size={13} /> : <span className="font-mono" style={{ fontSize: '0.625rem' }}>cURL</span>}
          </button>
          <button className="mp-icon-btn" onClick={onClose} title="Close detail" aria-label="Close detail">
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      <div className={`mp-inspector-status ${item.status === 'success' ? 'ok' : 'error'}`}>
        <strong>{item.status === 'success' ? 'Request completed' : 'Request failed'}</strong>
        <span className="font-mono">HTTP {requestStatusLabel(item)} · {formatLatency(item.latency_ms)}</span>
      </div>

      {failoverActive && (
        <div className="mp-detail-section mp-failover-detail-box">
          <div className="mp-detail-section-head">
            <span>Failover routing & attempt log</span>
            <span className="font-mono">{item.failover_attempts || 0} fallback attempt(s)</span>
          </div>
          <FailoverOutcomeBanner item={item} />
          <div className="mp-detail-grid compact">
            <div><span>Primary failed</span><strong className="font-mono">{item.failover_from_model || '—'}</strong></div>
            <div><span>Trigger reason</span><strong>{failoverReasonLabel(item.failover_reason)}</strong></div>
            <div><span>Response from</span><strong className="font-mono">{item.failover_used ? item.model : 'None (failed)'}</strong></div>
            <div><span>Outcome</span><strong>{item.failover_used ? 'Fallback succeeded' : 'All attempts failed'}</strong></div>
          </div>
          <FailoverTraceList
            trace={failoverTrace}
            emptyMessage="Per-attempt trace unavailable for this request."
          />
        </div>
      )}

      <div className="mp-detail-grid">
        <div><span>Application</span><strong>{item.application_name || item.application_id || 'Direct client'}</strong></div>
        <div><span>Trace ID</span><strong className="font-mono" title={item.trace_id || undefined}>{item.trace_id || '—'}</strong></div>
        <div><span>Provider</span><strong>{item.provider}</strong></div>
        <div>
          <span className="mp-label-with-tip">
            <span>Routed model</span>
            <InfoTip
              title="Routed Model"
              text="The actual local or cloud model that answered this request after resolving app pinning, Global Fallback, or Failover."
            />
          </span>
          <strong className="font-mono">{item.model}</strong>
        </div>
        <div>
          <span className="mp-label-with-tip">
            <span>Requested model</span>
            <InfoTip
              title="Requested Model"
              text="The original model string sent by the client SDK (recorded for telemetry while SLIR routes to the app's selected model)."
            />
          </span>
          <strong className="font-mono">{item.client_model || 'active-model'}</strong>
        </div>
        <div><span>Call type</span><strong className="font-mono">{item.call_type}</strong></div>
        <div><span>Streaming</span><strong>{item.is_streaming ? 'Yes' : 'No'}</strong></div>
        <div>
          <span className="mp-label-with-tip">
            <span>Cache state</span>
            <InfoTip
              title="Prompt Cache Status"
              text="cache_hit = reused cached KV prefix; standard = evaluated full prompt; cold_cache = slow initial evaluation; unknown = provider did not report cache data."
            />
          </span>
          <strong>{item.cache_status || 'unknown'}</strong>
        </div>
        <div>
          <span className="mp-label-with-tip">
            <span>Cost</span>
            <InfoTip
              title="Cost Calculation Status"
              text="confirmed_by_provider = reported directly by API; estimated = calculated from your Pricing Rules; unknown = missing token usage or matching rate."
            />
          </span>
          <strong className="font-mono">{item.estimated_cost != null ? `$${item.estimated_cost.toFixed(6)}` : 'Not priced'} <span className="mp-muted">({item.cost_status})</span></strong>
        </div>
      </div>

      <div className="mp-detail-section">
        <div className="mp-detail-section-head">
          <span>Token allocation</span>
          <span className="font-mono">{totalTokens.toLocaleString()} total</span>
        </div>
        <div className="mp-token-bar">
          <span className="prompt" style={{ width: `${promptPercent}%` }} />
          <span className="completion" style={{ width: `${100 - promptPercent}%` }} />
        </div>
        <div className="mp-detail-legend font-mono">
          <span><i className="prompt" /> Prompt {promptTokens.toLocaleString()}</span>
          <span><i className="completion" /> Completion {completionTokens.toLocaleString()}</span>
        </div>
      </div>

      <div className="mp-detail-section">
        <div className="mp-detail-section-head"><span>Latency breakdown</span></div>
        <div className="mp-detail-grid compact">
          <div><span>Total</span><strong className="font-mono">{formatLatency(item.latency_ms)}</strong></div>
          <div><span>Model load</span><strong className="font-mono">{item.load_duration_ms != null ? formatLatency(item.load_duration_ms) : 'n/a'}</strong></div>
          <div><span>Prompt eval</span><strong className="font-mono">{item.prompt_eval_duration_ms != null ? formatLatency(item.prompt_eval_duration_ms) : 'n/a'}</strong></div>
          <div><span>Generation</span><strong className="font-mono">{item.eval_duration_ms != null ? formatLatency(item.eval_duration_ms) : 'n/a'}</strong></div>
        </div>
        {generationTps > 0 && <div className="mp-detail-note font-mono">{generationTps} tokens/sec during generation</div>}
      </div>

      {item.status === 'failure' && (
        <div className="mp-error-panel">
          <span>Error</span>
          <strong>{item.error_type || 'Unknown error'}</strong>
          {item.error_message && <p className="font-mono">{item.error_message}</p>}
        </div>
      )}

      <div className="mp-inspector-footer">
        <button className="mp-btn mp-btn-secondary" onClick={() => copyInspectorText('json')}>
          {copied === 'json' ? 'Copied' : 'Copy telemetry JSON'}
        </button>
        {onOpenInLogs && (
          <button className="mp-btn mp-btn-ghost" onClick={() => onOpenInLogs(item.request_id)}>
            Open in Logs ↗
          </button>
        )}
        {onReplayInPlayground && (
          <button className="mp-btn mp-btn-ghost" onClick={onReplayInPlayground}>
            Open Playground
          </button>
        )}
      </div>
    </aside>
  );
};
