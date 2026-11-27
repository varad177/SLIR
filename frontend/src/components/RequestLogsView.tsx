import React, { useState, useEffect, useCallback } from 'react';
import { RequestsResponse, ApplicationItem, UsageEventItem } from '../types/analytics';
import { fetchRequests } from '../api/client';
import { failoverReasonLabel } from '../utils/failover';
import {
  formatTimestampParts,
  formatLatency,
  formatBreakdown,
  requestStatusLabel
} from '../utils/telemetryFormat';
import {
  ShieldCheckIcon,
  SearchIcon,
  RotateCwIcon
} from './icons/Icons';
import { InfoTip } from './InfoTip';
import { FailoverRouteSummary } from './FailoverRouteSummary';
import { RequestDetailInspector } from './RequestDetailInspector';

interface RequestLogsViewProps {
  applications?: ApplicationItem[];
  installedModels?: string[];
  initialAppId?: string | null;
  initialFailoverFilter?: 'all' | 'only' | 'used' | 'failed' | 'none';
  initialSearch?: string;
  initialFocusNonce?: number;
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

export const RequestLogsView: React.FC<RequestLogsViewProps> = ({
  applications = [],
  installedModels = [],
  initialAppId = null,
  initialFailoverFilter = 'all',
  initialSearch = '',
  initialFocusNonce = 0,
  onReplayInPlayground
}) => {
  const [data, setData] = useState<RequestsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<string>(initialAppId || 'all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedStreaming, setSelectedStreaming] = useState('all');
  const [selectedFailover, setSelectedFailover] = useState<string>(initialFailoverFilter || 'all');
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || '');
  const [activeTimeframe, setActiveTimeframe] = useState<'1h' | '24h' | '7d'>('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedItem, setSelectedItem] = useState<UsageEventItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setSelectedApp(initialAppId || 'all');
    setPage(1);
  }, [initialAppId]);

  useEffect(() => {
    if (!initialFocusNonce) return;
    setSelectedFailover(initialFailoverFilter || 'all');
    setSearchQuery(initialSearch || '');
    setDebouncedSearch(initialSearch || '');
    setPage(1);
  }, [initialFailoverFilter, initialSearch, initialFocusNonce]);

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
    failover: selectedFailover !== 'all' ? selectedFailover : undefined,
    start: timeframeStart(activeTimeframe),
    search: debouncedSearch || undefined
  }), [selectedApp, selectedModel, selectedStatus, selectedStreaming, selectedFailover, activeTimeframe, debouncedSearch]);

  const loadRequests = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetchRequests({ ...queryFilters(), page });
      setData(res);
      setSelectedItem((prev) => {
        const itemsList = res.items || [];
        if (prev && itemsList.some((item) => item.id === prev.id)) {
          return itemsList.find((item) => item.id === prev.id) || prev;
        }
        return itemsList[0] || null;
      });
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

  const items = data?.items || [];
  const current = selectedItem;

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
              placeholder="Search request id, model, error, or trace"
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
            <span>Routing</span>
            <select className="mp-select mp-select-compact" value={selectedFailover} onChange={(e) => resetPageAnd(setSelectedFailover, e.target.value)}>
              <option value="all">All routing</option>
              <option value="only">Failover triggered</option>
              <option value="used">Failover succeeded</option>
              <option value="failed">Failover failed</option>
              <option value="none">No failover</option>
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
                  <th>Model &amp; routing</th>
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
                      className={`mp-clickable-row ${current?.id === item.id ? 'selected' : ''}`}
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
                        <FailoverRouteSummary item={item} />
                      </td>
                      <td>
                        <span className={`mp-badge ${ok ? 'success' : 'danger'}`}>
                          {ok ? 'Success' : 'Failure'} · {requestStatusLabel(item)}
                        </span>
                      </td>
                      <td className="font-mono">
                        <div>{formatLatency(item.latency_ms)}</div>
                        <div className="mp-table-secondary" style={{ display: 'flex', gap: '10px', fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}>
                          <InfoTip title="L — Model Load Time" text="Time spent loading model weights into GPU/RAM. High on cold starts, ~0ms when already in memory.">
                            <span>L:{formatBreakdown(item.load_duration_ms)}</span>
                          </InfoTip>
                          <InfoTip title="PE — Prompt Eval Time" text="Time spent reading and processing your input prompt before the first output token (Time to First Token).">
                            <span>PE:{formatBreakdown(item.prompt_eval_duration_ms)}</span>
                          </InfoTip>
                          <InfoTip title="G — Generation Time" text="Time spent generating output tokens.">
                            <span>G:{formatBreakdown(item.eval_duration_ms)}</span>
                          </InfoTip>
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
          <RequestDetailInspector
            item={current}
            onClose={() => setSelectedItem(null)}
            onReplayInPlayground={onReplayInPlayground}
          />
        )}
      </div>
    </div>
  );
};
