import React, { useState, useEffect, useCallback } from 'react';
import { RequestsResponse, ApplicationItem, UsageEventItem, FailoverTraceEntry } from '../types/analytics';
import { fetchRequests } from '../api/client';
import { copyText } from '../utils/clipboard';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import {
  ShieldCheckIcon,
  SearchIcon,
  CopyIcon,
  CheckIcon,
  CloseIcon,
  RotateCwIcon
} from './icons/Icons';

interface RequestLogsViewProps {
  applications?: ApplicationItem[];
  installedModels?: string[];
  initialAppId?: string | null;
  onClearDatabase?: () => void;
  onReplayInPlayground?: () => void;
}

const TIMEFRAME_MS: Record<'1h' | '24h' | '7d', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

const timeframeStart = (tf: '1h' | '24h' | '7d') =>
  new Date(Date.now() - TIMEFRAME_MS[tf]).toISOString();

const formatTimestampParts = (iso?: string) => {
  if (!iso) return { time: '--:--:--', date: '----/--/--' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    const parts = iso.split('T');
    return { time: parts[1]?.replace('Z', '').slice(0, 8) || iso, date: parts[0] || '' };
  }
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return {
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  };
};

const formatLatency = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)} ms`;
const formatBreakdown = (ms: number | null | undefined) => ms != null ? `${(ms / 1000).toFixed(2)}s` : 'n/a';
const statusLabel = (item: UsageEventItem) => item.http_status ? String(item.http_status) : (item.status === 'success' ? '200' : 'error');

const parseFailoverTrace = (value?: string | null): FailoverTraceEntry[] => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const FAILOVER_REASON_LABELS: Record<string, string> = {
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

const failoverReasonLabel = (value?: string | null) => FAILOVER_REASON_LABELS[value || ''] || value || 'Unknown';

export const RequestLogsView: React.FC<RequestLogsViewProps> = ({
  applications = [],
  installedModels = [],
  initialAppId = null,
  onReplayInPlayground
}) => {
  const [data, setData] = useState<RequestsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<string>(initialAppId || 'all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedStreaming, setSelectedStreaming] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTimeframe, setActiveTimeframe] = useState<'1h' | '24h' | '7d'>('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedItem, setSelectedItem] = useState<UsageEventItem | null>(null);
  const [copied, setCopied] = useState<'request' | 'json' | 'curl' | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (initialAppId) setSelectedApp(initialAppId);
  }, [initialAppId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const queryFilters = useCallback(() => ({
    appId: selectedApp !== 'all' ? selectedApp : undefined,
    model: selectedModel !== 'all' ? selectedModel : undefined,
    status: selectedStatus !== 'all' ? selectedStatus : undefined,
    streaming: selectedStreaming !== 'all' ? selectedStreaming : undefined,
    start: timeframeStart(activeTimeframe),
    search: debouncedSearch || undefined
  }), [selectedApp, selectedModel, selectedStatus, selectedStreaming, activeTimeframe, debouncedSearch]);

  const loadRequests = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetchRequests({ ...queryFilters(), page });
      setData(res);
      setSelectedItem((prev) => prev || res.items?.[0] || null);
    } catch (err) {
      console.error('Failed to load request logs:', err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [page, queryFilters]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => loadRequests(), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadRequests]);

  const resetPageAnd = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const allItems: UsageEventItem[] = [];
      let exportPage = 1;
      let totalPages = 1;
      do {
        const res = await fetchRequests({ ...queryFilters(), page: exportPage, limit: 200 });
        allItems.push(...res.items);
        totalPages = Math.max(1, res.pagination.totalPages);
        exportPage += 1;
      } while (exportPage <= totalPages && exportPage <= 50);

      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const headers = ['Timestamp', 'Request ID', 'Application', 'Provider', 'Routed model', 'Requested model', 'Failover used', 'Failover from', 'Failover reason', 'Failover attempts', 'Failover trace', 'HTTP status', 'Status', 'Stream', 'Latency ms', 'Prompt tokens', 'Completion tokens', 'Total tokens', 'Cost USD', 'Error'];
      const rows = allItems.map((item) => [
        item.timestamp,
        item.request_id,
        item.application_name || item.application_id || 'direct',
        item.provider,
        item.model,
        item.client_model || '',
        item.failover_used ? 'yes' : 'no',
        item.failover_from_model || '',
        failoverReasonLabel(item.failover_reason),
        item.failover_attempts ?? 0,
        item.failover_trace || '',
        item.http_status || (item.status === 'success' ? 200 : ''),
        item.status,
        item.is_streaming ? 'yes' : 'no',
        item.latency_ms,
        item.prompt_tokens ?? '',
        item.completion_tokens ?? '',
        item.total_tokens ?? '',
        item.estimated_cost ?? '',
        item.error_message || ''
      ]);
      const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `slir-requests-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export request logs:', err);
    } finally {
      setExporting(false);
    }
  };

  const copyInspectorText = async (kind: 'request' | 'json' | 'curl') => {
    if (!selectedItem) return;
    const text = kind === 'request'
      ? selectedItem.request_id
      : kind === 'curl'
        ? `curl ${getBrowserGatewayBaseUrl()}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $SLIR_APP_KEY" \\\n  -H "X-Request-ID: ${selectedItem.trace_id || selectedItem.request_id}" \\\n  -d '{"model":"${selectedItem.client_model || selectedItem.model}","messages":[{"role":"user","content":"Hello"}]}'`
        : JSON.stringify(selectedItem, null, 2);
    if (!text) return;
    if (await copyText(text)) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const items = data?.items || [];
  const current = selectedItem;
  const promptTokens = current?.prompt_tokens ?? 0;
  const completionTokens = current?.completion_tokens ?? 0;
  const totalTokens = current?.total_tokens ?? promptTokens + completionTokens;
  const promptPercent = totalTokens > 0 ? Math.round((promptTokens / totalTokens) * 100) : 0;
  const generationTps = current?.eval_duration_ms && current.completion_tokens
    ? Math.round((current.completion_tokens / (current.eval_duration_ms / 1000)) * 10) / 10
    : 0;

  return (
    <div className="mp-logs-page">
      <div className="mp-logs-header">
        <div>
          <div className="mp-eyebrow">Observability</div>
          <h1 className="mp-page-title">Request logs</h1>
          <p className="mp-page-subtitle">
            Operational telemetry only. Prompts and completions are never written to the database.
          </p>
        </div>
        <div className="mp-logs-header-meta font-mono">
          <ShieldCheckIcon size={14} />
          <span>{data?.pagination.total ?? 0} matching requests</span>
        </div>
      </div>

      <section className="mp-card mp-logs-toolbar">
        <div className="mp-toolbar-row">
          <div className="mp-search">
            <SearchIcon size={13} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search request id, model, or error"
              aria-label="Search request logs"
            />
          </div>

          <label className="mp-inline-field">
            <span>Application</span>
            <select className="mp-select mp-select-compact" value={selectedApp} onChange={(e) => resetPageAnd(setSelectedApp, e.target.value)}>
              <option value="all">All applications</option>
              {applications.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
            </select>
          </label>

          <label className="mp-inline-field">
            <span>Model</span>
            <select className="mp-select mp-select-compact" value={selectedModel} onChange={(e) => resetPageAnd(setSelectedModel, e.target.value)}>
              <option value="all">All models</option>
              {installedModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>

          <label className="mp-inline-field">
            <span>Status</span>
            <select className="mp-select mp-select-compact" value={selectedStatus} onChange={(e) => resetPageAnd(setSelectedStatus, e.target.value)}>
              <option value="all">Any status</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </label>

          <label className="mp-inline-field">
            <span>Stream</span>
            <select className="mp-select mp-select-compact" value={selectedStreaming} onChange={(e) => resetPageAnd(setSelectedStreaming, e.target.value)}>
              <option value="all">Any</option>
              <option value="true">Streaming</option>
              <option value="false">Buffered</option>
            </select>
          </label>
        </div>

        <div className="mp-toolbar-row mp-toolbar-row-secondary">
          <div className="mp-segmented font-mono">
            {(['1h', '24h', '7d'] as const).map((tf) => (
              <button
                key={tf}
                className={activeTimeframe === tf ? 'active' : ''}
                onClick={() => { setActiveTimeframe(tf); setPage(1); }}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="mp-toolbar-spacer" />

          <label className="mp-checkbox" title="Poll for new requests every 5 seconds">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span>{autoRefresh ? 'Live tail' : 'Auto refresh'}</span>
            {autoRefresh && <span className="mp-live-dot" aria-hidden="true" />}
          </label>

          <button className="mp-btn mp-btn-ghost" onClick={() => loadRequests(true)} disabled={loading}>
            <RotateCwIcon size={12} className={loading ? 'spin' : ''} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>

          <button className="mp-btn mp-btn-primary" onClick={handleExportCsv} disabled={exporting || items.length === 0}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </section>

      <div className={`mp-logs-grid ${current ? 'has-inspector' : ''}`}>
        <section className="mp-card mp-logs-table-card">
          <div className="mp-table-wrapper">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Application</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="mp-empty compact">
                        <strong>No requests match these filters</strong>
                        <span>Try widening the timeframe or clearing filters.</span>
                      </div>
                    </td>
                  </tr>
                ) : items.map((item) => {
                  const ok = item.status === 'success';
                  const parts = formatTimestampParts(item.timestamp);
                  return (
                    <tr
                      key={item.id}
                      className={current?.id === item.id ? 'selected' : ''}
                      onClick={() => setSelectedItem(item)}
                      tabIndex={0}
                      aria-selected={current?.id === item.id}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedItem(item);
                        }
                      }}
                    >
                      <td>
                        <div className="mp-table-primary font-mono">{parts.time}</div>
                        <div className="mp-table-secondary font-mono">{parts.date}</div>
                      </td>
                      <td>
                        <div className="mp-table-primary">{item.application_name || item.application_id || 'Direct client'}</div>
                        {item.client_model && item.client_model !== item.model && (
                          <div className="mp-table-secondary font-mono">requested {item.client_model}</div>
                        )}
                      </td>
                      <td>
                        <div className="mp-table-primary font-mono">
                          {item.model}
                          {item.failover_from_model && (
                            <span className={`mp-failover-badge ${item.failover_used ? 'used' : 'failed'}`}>
                              {item.failover_used ? 'Failover' : 'Failover failed'}
                            </span>
                          )}
                        </div>
                        <div className="mp-table-secondary font-mono">{item.provider}</div>
                        {item.failover_from_model && (
                          <div className="mp-table-secondary font-mono">from {item.failover_from_model}</div>
                        )}
                      </td>
                      <td>
                        <span className={`mp-badge ${ok ? 'success' : 'danger'}`}>
                          {ok ? 'Success' : 'Failure'} · {statusLabel(item)}
                        </span>
                      </td>
                      <td className="font-mono">
                        <div>{formatLatency(item.latency_ms)}</div>
                        <div className="mp-table-secondary" style={{ display: 'flex', gap: '10px', fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}>
                          <span title="Model load">L:{formatBreakdown(item.load_duration_ms)}</span>
                          <span title="Prompt eval">PE:{formatBreakdown(item.prompt_eval_duration_ms)}</span>
                          <span title="Generation">G:{formatBreakdown(item.eval_duration_ms)}</span>
                        </div>
                        {item.cache_status === 'cache_hit' && <div className="mp-table-secondary">cache hit</div>}
                        {item.is_streaming === 1 && <div className="mp-table-secondary">streamed</div>}
                      </td>
                      <td className="font-mono">{(item.total_tokens || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mp-table-pagination font-mono">
            <span>
              Page {data?.pagination.page || 1} of {data?.pagination.totalPages || 1}
              <span className="mp-muted"> · {data?.pagination.total ?? 0} total</span>
            </span>
            <div>
              <button className="mp-btn mp-btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <button className="mp-btn mp-btn-ghost" disabled={page >= (data?.pagination.totalPages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </section>

        {current && (
          <aside className="mp-card mp-inspector">
            <div className="mp-inspector-head">
              <div>
                <div className="mp-eyebrow">Request detail</div>
                <div className="mp-inspector-id font-mono" title={current.request_id}>
                  {current.request_id}
                </div>
              </div>
              <div className="mp-inspector-actions">
                <button className="mp-icon-btn" onClick={() => copyInspectorText('request')} title="Copy request ID">
                  {copied === 'request' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
                <button className="mp-icon-btn" onClick={() => copyInspectorText('curl')} title="Copy as cURL">
                  {copied === 'curl' ? <CheckIcon size={13} /> : <span className="font-mono" style={{ fontSize: '0.625rem' }}>cURL</span>}
                </button>
                <button className="mp-icon-btn" onClick={() => setSelectedItem(null)} title="Close detail" aria-label="Close detail">
                  <CloseIcon size={14} />
                </button>
              </div>
            </div>

            <div className={`mp-inspector-status ${current.status === 'success' ? 'ok' : 'error'}`}>
              <strong>{current.status === 'success' ? 'Request completed' : 'Request failed'}</strong>
              <span className="font-mono">HTTP {statusLabel(current)} · {formatLatency(current.latency_ms)}</span>
            </div>

            <div className="mp-detail-grid">
              <div><span>Application</span><strong>{current.application_name || current.application_id || 'Direct client'}</strong></div>
              <div><span>Trace ID</span><strong className="font-mono" title={current.trace_id || undefined}>{current.trace_id || '—'}</strong></div>
              <div><span>Provider</span><strong>{current.provider}</strong></div>
              <div><span>Routed model</span><strong className="font-mono">{current.model}</strong></div>
              <div><span>Requested model</span><strong className="font-mono">{current.client_model || 'active-model'}</strong></div>
              <div><span>Call type</span><strong className="font-mono">{current.call_type}</strong></div>
              <div><span>Streaming</span><strong>{current.is_streaming ? 'Yes' : 'No'}</strong></div>
              <div><span>Cache state</span><strong>{current.cache_status || 'unknown'}</strong></div>
              <div><span>Cost</span><strong className="font-mono">{current.estimated_cost != null ? `$${current.estimated_cost.toFixed(6)}` : 'Not priced'} <span className="mp-muted">({current.cost_status})</span></strong></div>
            </div>

            {(current.failover_from_model || (current.failover_attempts || 0) > 0 || current.failover_trace) && (
              <div className="mp-detail-section">
                <div className="mp-detail-section-head">
                  <span>Failover routing</span>
                  <span className="font-mono">{current.failover_attempts || 0} attempt(s)</span>
                </div>
                <div className="mp-detail-grid compact">
                  <div><span>Primary model</span><strong className="font-mono">{current.failover_from_model || '—'}</strong></div>
                  <div><span>Reason</span><strong>{failoverReasonLabel(current.failover_reason)}</strong></div>
                  <div><span>Served by</span><strong className="font-mono">{current.failover_used ? current.model : 'none'}</strong></div>
                  <div><span>Outcome</span><strong>{current.failover_used ? 'Fallback succeeded' : 'All attempts failed'}</strong></div>
                </div>
                {(() => {
                  const trace = parseFailoverTrace(current.failover_trace);
                  if (trace.length === 0) return null;
                  return (
                    <div className="mp-failover-trace-list">
                      {trace.map((entry, index) => (
                        <div className="mp-failover-trace-row" key={`${entry.model}-${index}`}>
                          <span className="font-mono">{entry.model}</span>
                          <span>{failoverReasonLabel(entry.outcome)}</span>
                          <span className="font-mono">
                            {entry.status ? `HTTP ${entry.status}` : '—'}
                            {entry.durationMs != null ? ` · ${Math.round(entry.durationMs)} ms` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

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
                <div><span>Total</span><strong className="font-mono">{formatLatency(current.latency_ms)}</strong></div>
                <div><span>Model load</span><strong className="font-mono">{current.load_duration_ms != null ? formatLatency(current.load_duration_ms) : 'n/a'}</strong></div>
                <div><span>Prompt eval</span><strong className="font-mono">{current.prompt_eval_duration_ms != null ? formatLatency(current.prompt_eval_duration_ms) : 'n/a'}</strong></div>
                <div><span>Generation</span><strong className="font-mono">{current.eval_duration_ms != null ? formatLatency(current.eval_duration_ms) : 'n/a'}</strong></div>
              </div>
              {generationTps > 0 && <div className="mp-detail-note font-mono">{generationTps} tokens/sec during generation</div>}
            </div>

            {current.status === 'failure' && (
              <div className="mp-error-panel">
                <span>Error</span>
                <strong>{current.error_type || 'Unknown error'}</strong>
                {current.error_message && <p className="font-mono">{current.error_message}</p>}
              </div>
            )}

            <div className="mp-inspector-footer">
              <button className="mp-btn mp-btn-secondary" onClick={() => copyInspectorText('json')}>
                {copied === 'json' ? 'Copied' : 'Copy telemetry JSON'}
              </button>
              {onReplayInPlayground && (
                <button className="mp-btn mp-btn-ghost" onClick={onReplayInPlayground}>
                  Open Playground
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
