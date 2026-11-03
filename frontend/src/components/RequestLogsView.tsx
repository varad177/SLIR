import React, { useState, useEffect } from 'react';
import { RequestsResponse, ApplicationItem, UsageEventItem } from '../types/analytics';
import { fetchRequests } from '../api/client';
import {
  ShieldCheckIcon,
  SearchIcon,
  CopyIcon,
  CheckIcon,
  CloseIcon,
  ZapIcon
} from './icons/Icons';

interface RequestLogsViewProps {
  applications?: ApplicationItem[];
  installedModels?: string[];
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
  if (!iso) {
    return { time: '--:--:--.---', date: '----/--/-- UTC' };
  }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      const parts = iso.split('T');
      return {
        time: parts[1] ? parts[1].replace('Z', '').slice(0, 12) : iso,
        date: parts[0] ? `${parts[0]} UTC` : 'UTC'
      };
    }
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} UTC`;
    return { time, date };
  } catch {
    return { time: iso, date: 'UTC' };
  }
};

export const RequestLogsView: React.FC<RequestLogsViewProps> = ({
  applications = [],
  installedModels = [],
  onClearDatabase,
  onReplayInPlayground
}) => {
  const [data, setData] = useState<RequestsResponse | null>(null);
  const [page, setPage] = useState<number>(1);
  const [selectedApp, setSelectedApp] = useState<string>('all');
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [activeTimeframe, setActiveTimeframe] = useState<'1h' | '24h' | '7d'>('24h');
  const [isStreamOn, setIsStreamOn] = useState<boolean>(true);
  const [autoRefresh5s, setAutoRefresh5s] = useState<boolean>(true);
  const [selectedItem, setSelectedItem] = useState<UsageEventItem | null>(null);
  const [copiedDigest, setCopiedDigest] = useState<boolean>(false);
  const [copiedReqId, setCopiedReqId] = useState<boolean>(false);

  const loadRequests = async () => {
    try {
      const res = await fetchRequests({
        page,
        appId: selectedApp !== 'all' ? selectedApp : undefined,
        model: selectedModel !== 'all' ? selectedModel : undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        start: timeframeStart(activeTimeframe),
        search: debouncedSearch || undefined
      });
      setData(res);
      if (res.items && res.items.length > 0 && !selectedItem) {
        setSelectedItem(res.items[0]);
      }
    } catch (err: any) {
      console.error('Failed to load request logs:', err);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadRequests();
  }, [page, selectedApp, selectedModel, selectedStatus, activeTimeframe, debouncedSearch]);

  useEffect(() => {
    if (!autoRefresh5s) return;
    const interval = setInterval(() => {
      loadRequests();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh5s, page, selectedApp, selectedModel, selectedStatus, activeTimeframe, debouncedSearch]);

  const handleExportCsv = () => {
    const items = data?.items || [];
    if (items.length === 0) return;
    const headers = ['Timestamp', 'Request_ID', 'App', 'Model', 'Status', 'Latency_ms', 'Tokens_Total'];
    const rows = items.map(r => [
      r.timestamp,
      r.request_id,
      r.application_id || 'direct',
      r.model,
      r.status,
      r.latency_ms,
      r.total_tokens || 0
    ]);
    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flight_frames_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyReqId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedReqId(true);
    setTimeout(() => setCopiedReqId(false), 2000);
  };

  const handleCopyDigest = (digest: string) => {
    navigator.clipboard.writeText(digest);
    setCopiedDigest(true);
    setTimeout(() => setCopiedDigest(false), 2000);
  };

  const items = data?.items || [];
  const currentItem = selectedItem || (items.length > 0 ? items[0] : null);

  // Active item stats
  const activePromptTokens = currentItem?.prompt_tokens ?? 0;
  const activeCompTokens = currentItem?.completion_tokens ?? 0;
  const activeTotalTokens = currentItem?.total_tokens ?? (activePromptTokens + activeCompTokens);
  const promptPercent = activeTotalTokens > 0 ? Math.round((activePromptTokens / activeTotalTokens) * 100) : 50;

  const ephemeralHash = currentItem?.request_id
    ? `e3b0c442${currentItem.request_id.slice(-8)}afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
    : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. Zero-Retention Header Banner */}
      <div
        style={{
          background: 'rgba(16, 185, 129, 0.05)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '8px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ color: '#10b981' }}>
            <ShieldCheckIcon size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', letterSpacing: '0.04em' }}>
                ZERO RETENTION ENFORCED
              </span>
              <span style={{ color: '#475569' }}>|</span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                Raw prompts and model responses are never stored on disk. Only operational telemetry (latency, token usage, and status) is recorded.
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.6875rem' }} className="font-mono">
          <span style={{ color: '#10b981' }}>
            ● Privacy Compliant
          </span>
        </div>
      </div>

      {/* 2. Filter Bar */}
      <div
        className="mp-card"
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#0c0e14',
              border: '1px solid #1e2433',
              borderRadius: '6px',
              padding: '4px 8px'
            }}
          >
            <span style={{ color: '#64748b' }}>
              <SearchIcon size={13} />
            </span>
            <input
              type="text"
              placeholder="req_01j7b9x"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="font-mono"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                fontSize: '0.75rem',
                outline: 'none',
                width: '120px'
              }}
            />
            <span
              style={{
                fontSize: '0.625rem',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#64748b',
                padding: '0 4px',
                borderRadius: '3px'
              }}
            >
              ⌘K
            </span>
          </div>

          {/* App Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>APP:</span>
            <select
              value={selectedApp}
              onChange={(e) => {
                setSelectedApp(e.target.value);
                setPage(1);
              }}
              className="mp-select font-mono"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
            >
              <option value="all">All Apps</option>
              {applications.map(app => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </select>
          </div>

          {/* Model Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>MODEL:</span>
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setPage(1);
              }}
              className="mp-select font-mono"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
            >
              <option value="all">All Models</option>
              {installedModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>STATUS:</span>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="mp-select font-mono"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
            >
              <option value="all">All Status</option>
              <option value="success">200 OK</option>
              <option value="failure">Errors</option>
            </select>
          </div>

          {/* Timeframe Selectors */}
          <div style={{ display: 'flex', gap: '3px', marginLeft: '6px' }} className="font-mono">
            {(['1h', '24h', '7d'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => {
                  setActiveTimeframe(tf);
                  setPage(1);
                }}
                style={{
                  background: activeTimeframe === tf ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  border: '1px solid',
                  borderColor: activeTimeframe === tf ? '#2b3345' : 'transparent',
                  color: activeTimeframe === tf ? '#f8fafc' : '#64748b',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                  cursor: 'pointer'
                }}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} className="font-mono">
          {/* Stream On Toggle */}
          <button
            onClick={() => setIsStreamOn(!isStreamOn)}
            style={{
              background: isStreamOn ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${isStreamOn ? 'rgba(16, 185, 129, 0.35)' : '#1e2433'}`,
              color: isStreamOn ? '#10b981' : '#64748b',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isStreamOn ? '#10b981' : '#64748b' }} />
            STREAM {isStreamOn ? 'ON' : 'OFF'}
          </button>

          {/* Auto-Refresh 5s toggle */}
          <button
            onClick={() => setAutoRefresh5s(!autoRefresh5s)}
            style={{
              background: autoRefresh5s ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: '1px solid #1e2433',
              color: autoRefresh5s ? '#e2e8f0' : '#64748b',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '0.6875rem',
              cursor: 'pointer'
            }}
          >
            5s
          </button>

          {/* CSV Export */}
          <button
            onClick={handleExportCsv}
            style={{
              background: '#f97316',
              color: '#0c0e14',
              border: 'none',
              borderRadius: '5px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* 3. Split-Screen Layout: Table (Left) + Diagnostic Inspector (Right) */}
      <div className="mp-split-logs">
        {/* Left Column: Recent Requests Table */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>
                SHOWING {items.length} RECENT REQUESTS
              </span>
              <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#10b981' }}>
                ● SQLite Real-time
              </span>
            </div>

            <div className="mp-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="mp-table font-mono" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th>TIME (UTC)</th>
                    <th>REQUEST ID</th>
                    <th>APP</th>
                    <th>MODEL</th>
                    <th>STATUS</th>
                    <th>LATENCY</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                        No requests recorded yet.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => {
                      const isSelected = currentItem?.id === item.id;
                      const isSuccess = item.status === 'success';
                      const { time, date } = formatTimestampParts(item.timestamp);
                      const isCold = (item.load_duration_ms != null && item.load_duration_ms > 800) || item.cache_status === 'cold_cache';

                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={isSelected ? 'selected' : ''}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(249, 115, 22, 0.06)' : undefined,
                            borderLeft: isSelected ? '3px solid #f97316' : '3px solid transparent'
                          }}
                        >
                          <td style={{ color: '#94a3b8' }}>
                            <div style={{ color: isSelected ? '#f97316' : '#f8fafc', fontWeight: 600 }}>
                              {time}
                            </div>
                            <div style={{ fontSize: '0.625rem', color: '#64748b' }}>
                              {date}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                background: 'rgba(255, 255, 255, 0.04)',
                                border: '1px solid #1e2433',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                color: '#e2e8f0',
                                fontSize: '0.6875rem'
                              }}
                            >
                              req_{item.request_id ? item.request_id.slice(-7) : '01j7b9x'}
                            </span>
                          </td>
                          <td style={{ color: '#cbd5e1' }}>
                            {item.application_id || 'direct'}
                          </td>
                          <td style={{ color: '#10b981' }}>
                            {item.model}
                          </td>
                          <td>
                            <span
                              style={{
                                color: isSuccess ? '#10b981' : '#f43f5e',
                                background: isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                                border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontSize: '0.6875rem',
                                fontWeight: 600
                              }}
                            >
                              {isSuccess ? '200 OK' : '429 LIMIT'}
                            </span>
                          </td>
                          <td style={{ color: '#e2e8f0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                                {item.latency_ms >= 1000 ? `${(item.latency_ms / 1000).toFixed(1)}s` : `${Math.round(item.latency_ms)}ms`}
                              </span>
                              {isCold && (
                                <span style={{
                                  fontSize: '0.5625rem',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  background: 'rgba(244, 63, 94, 0.15)',
                                  border: '1px solid rgba(244, 63, 94, 0.35)',
                                  color: '#fb7185',
                                  fontWeight: 600
                                }}>
                                  Cold Start
                                </span>
                              )}
                              {item.cache_status === 'cache_hit' && (
                                <span style={{
                                  fontSize: '0.5625rem',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  border: '1px solid rgba(16, 185, 129, 0.35)',
                                  color: '#34d399',
                                  fontWeight: 600
                                }}>
                                  KV Hit
                                </span>
                              )}
                            </div>
                            {(item.load_duration_ms || item.prompt_eval_duration_ms || item.eval_duration_ms) ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                                {item.load_duration_ms != null && item.load_duration_ms > 0 && (
                                  <span style={{ color: item.load_duration_ms > 1000 ? '#fb7185' : '#94a3b8' }}>
                                    Cold: {item.load_duration_ms >= 1000 ? `${(item.load_duration_ms / 1000).toFixed(1)}s` : `${Math.round(item.load_duration_ms)}ms`}
                                  </span>
                                )}
                                {item.load_duration_ms != null && item.load_duration_ms > 0 && (item.prompt_eval_duration_ms || item.eval_duration_ms) && <span>·</span>}
                                {item.prompt_eval_duration_ms != null && item.prompt_eval_duration_ms > 0 && (
                                  <span style={{ color: '#38bdf8' }}>
                                    KV: {item.prompt_eval_duration_ms >= 1000 ? `${(item.prompt_eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(item.prompt_eval_duration_ms)}ms`}
                                  </span>
                                )}
                                {item.prompt_eval_duration_ms != null && item.prompt_eval_duration_ms > 0 && item.eval_duration_ms && <span>·</span>}
                                {item.eval_duration_ms != null && item.eval_duration_ms > 0 && (
                                  <span style={{ color: '#10b981' }}>
                                    Gen: {item.eval_duration_ms >= 1000 ? `${(item.eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(item.eval_duration_ms)}ms`}
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Strip */}
          <div
            className="font-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '12px',
              borderTop: '1px solid #1c212d',
              fontSize: '0.6875rem',
              color: '#64748b'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
              Storage: SQLite (WAL Mode)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                style={{
                  background: 'transparent',
                  border: '1px solid #1e2433',
                  color: page <= 1 ? '#475569' : '#cbd5e1',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Previous
              </button>
              <span>Page {data?.pagination.page || 1} / {data?.pagination.totalPages || 1}</span>
              <button
                disabled={page >= (data?.pagination.totalPages || 1)}
                onClick={() => setPage(p => p + 1)}
                style={{
                  background: 'transparent',
                  border: '1px solid #1e2433',
                  color: page >= (data?.pagination.totalPages || 1) ? '#475569' : '#cbd5e1',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                  cursor: page >= (data?.pagination.totalPages || 1) ? 'not-allowed' : 'pointer'
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Frame Diagnostic Inspector Drawer */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Inspector Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1c212d', paddingBottom: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    color: '#f8fafc',
                    background: 'rgba(255, 255, 255, 0.05)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}
                >
                  req_{currentItem?.request_id ? currentItem.request_id.slice(-7) : '01j7b9x'}
                </span>
                <button
                  onClick={() => handleCopyReqId(currentItem?.request_id || 'req_01j7b9x')}
                  style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}
                  title="Copy Request ID"
                >
                  {copiedReqId ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                </button>
              </div>
              <div className="font-mono" style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px', letterSpacing: '0.04em' }}>
                FRAME DIAGNOSTIC INSPECTOR
              </div>
            </div>

            <button
              onClick={() => setSelectedItem(null)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
            >
              <CloseIcon size={14} />
            </button>
          </div>

          {/* 4 Mini Metrics - Timing & Cold Cache Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }} className="font-mono">
            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '6px 8px' }}>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', fontWeight: 600 }}>TOTAL LATENCY</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
                {currentItem ? (currentItem.latency_ms >= 1000 ? `${(currentItem.latency_ms / 1000).toFixed(1)}s` : `${Math.round(currentItem.latency_ms)}ms`) : '--'}
              </div>
              <div style={{ fontSize: '0.5625rem', color: '#10b981', marginTop: '1px' }}>
                {currentItem?.status === 'success' ? '200 OK' : 'ERROR'}
              </div>
            </div>

            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '6px 8px' }}>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', fontWeight: 600 }}>COLD START (LOAD)</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: currentItem?.load_duration_ms && currentItem.load_duration_ms > 1000 ? '#fb7185' : '#10b981', marginTop: '2px' }}>
                {currentItem?.load_duration_ms ? `${(currentItem.load_duration_ms / 1000).toFixed(1)}s` : '0ms'}
              </div>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', marginTop: '1px' }}>
                {currentItem?.load_duration_ms && currentItem.load_duration_ms > 1000 ? 'Disk → VRAM' : 'Warm in RAM'}
              </div>
            </div>

            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '6px 8px' }}>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', fontWeight: 600 }}>KV PREFILL (PROMPT)</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#38bdf8', marginTop: '2px' }}>
                {currentItem?.prompt_eval_duration_ms ? (currentItem.prompt_eval_duration_ms >= 1000 ? `${(currentItem.prompt_eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(currentItem.prompt_eval_duration_ms)}ms`) : '0ms'}
              </div>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', marginTop: '1px' }}>
                {currentItem?.cache_status === 'cache_hit' ? 'KV Hit' : 'Full Ingest'}
              </div>
            </div>

            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '6px 8px' }}>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', fontWeight: 600 }}>GENERATION (EVAL)</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#10b981', marginTop: '2px' }}>
                {currentItem?.eval_duration_ms ? (currentItem.eval_duration_ms >= 1000 ? `${(currentItem.eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(currentItem.eval_duration_ms)}ms`) : '--'}
              </div>
              <div style={{ fontSize: '0.5625rem', color: '#64748b', marginTop: '1px' }}>
                {currentItem?.completion_tokens && currentItem.eval_duration_ms ? `${Math.round((currentItem.completion_tokens / (currentItem.eval_duration_ms / 1000)) * 10) / 10} tok/s` : 'Token gen'}
              </div>
            </div>
          </div>

          {/* Token Allocation Bar */}
          <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6875rem' }} className="font-mono">
              <span style={{ color: '#94a3b8' }}>Token Allocation: {activeTotalTokens.toLocaleString()} total</span>
              <span style={{ color: '#cbd5e1' }}>{activePromptTokens} prompt / {activeCompTokens} completion</span>
            </div>
            {/* Segmented bar */}
            <div style={{ height: '6px', width: '100%', background: '#1c212d', borderRadius: '3px', display: 'flex', overflow: 'hidden', margin: '6px 0 4px 0' }}>
              <div style={{ width: `${promptPercent}%`, background: '#f97316' }} />
              <div style={{ width: `${100 - promptPercent}%`, background: '#10b981' }} />
            </div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '0.625rem' }} className="font-mono">
              <span style={{ color: '#f97316' }}>● Prompt ({activePromptTokens})</span>
              <span style={{ color: '#10b981' }}>● Completion ({activeCompTokens})</span>
            </div>
          </div>

          {/* Gateway Ingress & Upstream Route */}
          <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '8px 10px' }} className="font-mono">
            <div style={{ fontSize: '0.625rem', color: '#64748b', fontWeight: 700, marginBottom: '6px' }}>
              GATEWAY INGRESS & UPSTREAM ROUTE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.6875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Client Ingress</span>
                <span style={{ color: '#e2e8f0' }}>http://localhost:4101/v1</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Application Scope</span>
                <span style={{ color: '#e2e8f0' }}>{currentItem?.application_id || 'direct-client'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Upstream Target</span>
                <span style={{ color: '#38bdf8' }}>{currentItem?.provider || 'ollama'} · {currentItem?.model || 'active-model'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Cache / Load State</span>
                <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <ZapIcon size={11} /> {currentItem?.cache_status === 'cache_hit' ? 'CACHE HIT (KV prompt reuse)' : currentItem?.load_duration_ms && currentItem.load_duration_ms > 0 ? `COLD START (${(currentItem.load_duration_ms/1000).toFixed(1)}s load)` : 'WARM INFERENCE'}
                </span>
              </div>
            </div>
          </div>

          {/* Request Status & Diagnostics */}
          {currentItem?.status === 'failure' && (
            <div style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: '6px', padding: '8px 10px' }} className="font-mono">
              <div style={{ fontSize: '0.625rem', color: '#fb7185', fontWeight: 700, marginBottom: '2px' }}>
                ERROR DIAGNOSTICS
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#f8fafc' }}>
                {currentItem.error_type || 'Unknown Error'}
              </div>
              {currentItem.error_message && (
                <div style={{ fontSize: '0.625rem', color: '#fb7185', marginTop: '4px' }}>
                  {currentItem.error_message}
                </div>
              )}
            </div>
          )}

          {/* Privacy Note */}
          <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '8px 10px' }} className="font-mono">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.6875rem', fontWeight: 600 }}>
              <ShieldCheckIcon size={13} />
              <span>Zero-Retention Privacy Guarantee</span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.625rem', color: '#64748b', lineHeight: 1.35 }}>
              Raw prompts and response tokens are never stored in the database. Only anonymous telemetry (token count, latency, HTTP status) is preserved.
            </p>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }} className="font-mono">
            <button
              onClick={onReplayInPlayground}
              style={{
                background: '#f97316',
                color: '#0c0e14',
                border: 'none',
                borderRadius: '6px',
                padding: '7px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Replay in Playground ⌘R
            </button>
            <button
              onClick={() => {
                const jsonStr = JSON.stringify(currentItem, null, 2);
                navigator.clipboard.writeText(jsonStr);
                alert('Copied telemetry JSON to clipboard!');
              }}
              style={{
                background: 'transparent',
                border: '1px solid #1e2433',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '7px',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              Export JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
