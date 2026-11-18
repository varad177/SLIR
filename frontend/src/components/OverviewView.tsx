import React, { useState, useEffect } from 'react';
import {
  SummaryKpis,
  TimeSeriesPoint,
  RequestsResponse,
  InstalledModelsResponse,
  ModelBenchmarkItem,
  ApplicationItem,
  DevConfig,
  ProfileBenchmarkResult
} from '../types/analytics';
import {
  fetchInstalledModels,
  fetchModelBenchmark,
  fetchDevConfig,
  updateDevConfig,
  runProfileBenchmark,
  updateApplication
} from '../api/client';
import {
  CopyIcon,
  CheckIcon,
  ZapIcon,
  ChevronRightIcon,
  SlidersIcon,
  CloseIcon
} from './icons/Icons';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';

interface OverviewViewProps {
  summary: SummaryKpis | null;
  timeSeries: TimeSeriesPoint[];
  requests: RequestsResponse | null;
  page: number;
  onPageChange: (newPage: number) => void;
  benchmarkRefresh: number;
  onModelSwitched: () => void;
  onNavigateToTab: (tab: 'apps' | 'playground' | 'logs' | 'models') => void;
  onClearDatabase?: () => void;
  activeModel?: string;
  applications?: ApplicationItem[];
  selectedAppId?: string | null;
  allAppsScope?: boolean;
  onSelectAppId?: (appId: string | null) => void;
  activeTimeframe: '15m' | '1h' | '6h' | '24h' | '7d';
  onTimeframeChange: (tf: '15m' | '1h' | '6h' | '24h' | '7d') => void;
}

const formatTimestampParts = (iso?: string) => {
  if (!iso) {
    return { time: '--:--:--', date: '----/--/-- UTC' };
  }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      const parts = iso.split('T');
      return {
        time: parts[1] ? parts[1].replace('Z', '').slice(0, 8) : iso,
        date: parts[0] ? `${parts[0]} UTC` : 'UTC'
      };
    }
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { time, date };
  } catch {
    return { time: iso, date: 'UTC' };
  }
};

const formatLatency = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)} ms`;
const formatBreakdown = (ms: number | null | undefined) => ms != null ? `${(ms / 1000).toFixed(2)}s` : 'n/a';
const normalizeModel = (value?: string | null) => (value || '').replace(/^ollama\//, '').toLowerCase();

export const OverviewView: React.FC<OverviewViewProps> = ({
  summary,
  timeSeries,
  requests,
  onNavigateToTab,
  onModelSwitched,
  activeModel = 'qwen2.5:3b',
  benchmarkRefresh,
  applications = [],
  selectedAppId = null,
  allAppsScope = false,
  onSelectAppId,
  activeTimeframe,
  onTimeframeChange
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; label: string } | null>(null);

  const [devConfig, setDevConfig] = useState<DevConfig>({ temperature: 0.7, num_ctx: 4096 });
  const [profiling, setProfiling] = useState(false);
  const [profileResult, setProfileResult] = useState<ProfileBenchmarkResult | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [modelsData, setModelsData] = useState<InstalledModelsResponse | null>(null);
  const [benchmarks, setBenchmarks] = useState<ModelBenchmarkItem[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const activeApp = applications.find((app) => app.id === selectedAppId) || applications[0];
  const routingAppId = activeApp?.id || selectedAppId;
  const appDefaultModel = activeApp?.defaultModel || 'active-model';
  const isPinned = appDefaultModel !== 'active-model';
  const effectiveModel = isPinned ? appDefaultModel : activeModel;
  const [modelDraft, setModelDraft] = useState(appDefaultModel);

  useEffect(() => {
    setModelDraft(appDefaultModel);
  }, [appDefaultModel, routingAppId]);

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const [modelsRes, benchRes, devRes] = await Promise.all([
          fetchInstalledModels().catch(() => null),
          fetchModelBenchmark().catch(() => ({ count: 0, models: [] })),
          fetchDevConfig().catch(() => ({ temperature: 0.7, num_ctx: 4096 }))
        ]);
        if (!mounted) return;
        if (devRes) setDevConfig(devRes);
        if (modelsRes) setModelsData(modelsRes);
        if (benchRes?.models) setBenchmarks(benchRes.models);
      } catch (err) {
        console.error('Failed to load overview model data:', err);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, [benchmarkRefresh]);

  const flashFeedback = (ok: boolean, message: string) => {
    setSwitchFeedback({ ok, message });
    setTimeout(() => setSwitchFeedback(null), 4000);
  };

  const handleRoutingModelChange = async (model: string) => {
    if (!routingAppId || switching) return;
    setSwitching(true);
    setSwitchFeedback(null);
    try {
      await updateApplication(routingAppId, { defaultModel: model });
      setModelDraft(model);
      const appName = activeApp?.name || 'Application';
      flashFeedback(
        true,
        model === 'active-model'
          ? `${appName} now follows the global fallback (${activeModel}).`
          : `${appName} pinned to ${model}.`
      );
      onModelSwitched();
    } catch (err: any) {
      setModelDraft(appDefaultModel);
      flashFeedback(false, err.message || 'Failed to update application routing.');
    } finally {
      setSwitching(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText('http://localhost:4101/v1');
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleTestRoute = async () => {
    if (!activeApp?.apiKey) {
      setPingResult({ ok: false, label: 'Application key unavailable' });
      return;
    }

    setPinging(true);
    setPingResult(null);
    const startedAt = performance.now();
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApp.apiKey}`
        },
        body: JSON.stringify({
          model: 'active-model',
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 8,
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message || payload?.error || `Gateway returned HTTP ${res.status}`);
      }
      const latency = performance.now() - startedAt;
      const routedModel = payload?.model || effectiveModel;
      const tokens = payload?.usage?.total_tokens ?? 0;
      setPingResult({
        ok: true,
        label: `${Math.round(latency)} ms · ${routedModel} · ${tokens} tokens`
      });
    } catch (err: any) {
      setPingResult({ ok: false, label: err.message || 'Route test failed' });
    } finally {
      setPinging(false);
      setTimeout(() => setPingResult(null), 6000);
    }
  };

  const handleChangeContext = async (newCtx: number) => {
    setDevConfig(prev => ({ ...prev, num_ctx: newCtx }));
    try {
      await updateDevConfig({ num_ctx: newCtx });
    } catch (e) {
      console.error('Failed to update dev num_ctx:', e);
    }
  };

  const handleChangeTemperature = async (newTemp: number) => {
    setDevConfig(prev => ({ ...prev, temperature: newTemp }));
    try {
      await updateDevConfig({ temperature: newTemp });
    } catch (e) {
      console.error('Failed to update dev temperature:', e);
    }
  };

  const handleRunProfile = async () => {
    setProfiling(true);
    setProfileError(null);
    try {
      const res = await runProfileBenchmark({
        model: effectiveModel,
        temperature: devConfig.temperature,
        num_ctx: devConfig.num_ctx
      });
      setProfileResult(res);
      onModelSwitched();
    } catch (err: any) {
      setProfileError(err.message || 'Latency profiling failed');
    } finally {
      setProfiling(false);
    }
  };

  const totalReq = summary?.totalRequests ?? 0;
  const totalCost = summary?.estimatedCost ?? 0;
  const totalTok = summary?.totalTokens ?? 0;
  const promptTok = summary?.promptTokens ?? 0;
  const compTok = summary?.completionTokens ?? 0;
  const avgLat = summary?.avgLatencyMs ?? 0;
  const p95Lat = summary?.latencyP95Ms ?? null;
  const p50Lat = summary?.latencyP50Ms ?? null;
  const cacheRate = summary?.cacheHitRate ?? 0;
  const cacheHits = summary?.cacheHitRequests ?? 0;
  const cacheReported = summary?.cacheReportedRequests ?? 0;
  const projected30d = summary?.projected30dCost ?? 0;
  const burnRate = summary?.burnRatePerDay ?? 0;
  const successRate = summary?.successRate ?? 0;

  const localModels = modelsData?.models || [];
  const customCloudModels = modelsData?.customModels || [];
  const activeCustom = customCloudModels.find(c => normalizeModel(c.modelId) === normalizeModel(effectiveModel));
  const isCloudActive = !!activeCustom;
  const modelKnown = effectiveModel === 'active-model'
    || localModels.some(m => normalizeModel(m.name) === normalizeModel(effectiveModel))
    || isCloudActive;

  const activeBenchmark = benchmarks.find((b) => {
    const benchmarkModel = normalizeModel(b.model);
    const target = normalizeModel(effectiveModel);
    return benchmarkModel === target || benchmarkModel.endsWith(`/${target}`) || target.endsWith(`/${benchmarkModel}`);
  });
  const activeTps = activeBenchmark?.tokensPerSec || 0;
  const activeLoadMs = activeBenchmark?.avgLoadMs || 0;

  const chartData = timeSeries.map((pt) => {
    let label = pt.bucket;
    if (label.includes('T')) {
      const parts = label.split('T');
      label = `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
    }
    return {
      time: label,
      prompt: pt.promptTokens || 0,
      completion: pt.completionTokens || 0,
      total: pt.totalTokens || 0,
      requests: pt.requests || 0
    };
  });

  const recentItems = requests?.items?.slice(0, 8) || [];

  return (
    <div className="mp-overview">
      <section className="mp-routing-card">
        <div className="mp-routing-main">
          <div className="mp-routing-heading">
            <div className="mp-eyebrow">Model routing</div>
            <h1 className="mp-page-title">
              {activeApp ? activeApp.name : 'No application selected'}
            </h1>
            <p className="mp-page-subtitle">
              {allAppsScope
                ? 'Analytics are aggregated across all applications. Routing changes apply to the application below.'
                : 'Requests sent with this application key are routed by the rule below.'}
            </p>
          </div>

          <div className="mp-routing-summary">
            <span className={`mp-rule-chip ${isPinned ? 'pinned' : 'global'}`}>
              <span className="mp-rule-dot" />
              {isPinned ? 'Pinned model' : 'Follows global fallback'}
            </span>
            <span className="mp-routing-target font-mono" title={effectiveModel}>{effectiveModel}</span>
            <span className="mp-routing-provider">{isCloudActive ? activeCustom?.provider : 'Ollama'}</span>
          </div>
        </div>

        <div className="mp-routing-controls">
          {applications.length > 1 && onSelectAppId && (
            <label className="mp-field">
              <span className="mp-field-label">Application</span>
              <select
                className="mp-select"
                value={routingAppId || ''}
                onChange={(e) => onSelectAppId(e.target.value)}
              >
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>{app.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="mp-field mp-field-grow">
            <span className="mp-field-label">Route this application to</span>
            <select
              className="mp-select font-mono"
              value={modelDraft}
              onChange={(e) => handleRoutingModelChange(e.target.value)}
              disabled={switching || !routingAppId}
            >
              <option value="active-model">Follow global fallback ({activeModel})</option>
              {localModels.length > 0 && (
                <optgroup label="Local Ollama">
                  {localModels.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </optgroup>
              )}
              {customCloudModels.length > 0 && (
                <optgroup label="Cloud endpoints">
                  {customCloudModels.map((c) => (
                    <option key={c.modelId} value={c.modelId}>
                      {c.displayName || c.modelId} · {c.provider}
                    </option>
                  ))}
                </optgroup>
              )}
              {!modelKnown && modelDraft !== 'active-model' && (
                <option value={modelDraft}>{modelDraft} (unavailable)</option>
              )}
            </select>
          </label>

          <button
            className="mp-btn mp-btn-secondary mp-nowrap"
            onClick={() => handleRoutingModelChange('active-model')}
            disabled={switching || !isPinned || !routingAppId}
            title="Remove the pin and follow the global active model"
          >
            Follow global
          </button>
        </div>

        <div className="mp-routing-footer">
          <div className="mp-url-chip font-mono">
            <span>{'http://localhost:4101/v1'}</span>
            <button onClick={handleCopyUrl} title="Copy base URL" aria-label="Copy base URL">
              {copiedUrl ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>
          <div className="mp-routing-actions">
            <button className="mp-btn mp-btn-ghost" onClick={handleTestRoute} disabled={pinging}>
              <ZapIcon size={12} />
              {pinging ? 'Testing...' : 'Test route'}
            </button>
            <button className="mp-btn mp-btn-ghost" onClick={handleRunProfile} disabled={profiling}>
              <SlidersIcon size={12} />
              {profiling ? 'Measuring...' : 'Profile latency'}
            </button>
            {onSelectAppId && (
              <button className="mp-link-btn" onClick={() => onNavigateToTab('models')}>
                Manage models <ChevronRightIcon size={11} />
              </button>
            )}
          </div>
        </div>

        {pingResult && (
          <div className={`mp-inline-result ${pingResult.ok ? 'ok' : 'error'}`}>
            {pingResult.label}
          </div>
        )}
        {switchFeedback && (
          <div className={`mp-inline-result ${switchFeedback.ok ? 'ok' : 'error'}`}>
            {switchFeedback.ok && <CheckIcon size={12} />}
            {switchFeedback.message}
          </div>
        )}
      </section>

      <section className="mp-tuning-strip">
        <span className="mp-tuning-label">Runtime defaults</span>
        <label className="mp-inline-field">
          <span>Context</span>
          <select className="mp-select mp-select-compact font-mono" value={devConfig.num_ctx} onChange={(e) => handleChangeContext(Number(e.target.value))}>
            <option value={2048}>2K</option>
            <option value={4096}>4K</option>
            <option value={8192}>8K</option>
            <option value={16384}>16K</option>
          </select>
        </label>
        <label className="mp-inline-field">
          <span>Temperature</span>
          <select className="mp-select mp-select-compact font-mono" value={devConfig.temperature} onChange={(e) => handleChangeTemperature(Number(e.target.value))}>
            <option value={0}>0.0 strict</option>
            <option value={0.2}>0.2 focused</option>
            <option value={0.7}>0.7 balanced</option>
            <option value={1}>1.0 creative</option>
          </select>
        </label>
        <span className="mp-tuning-hint">Applies to requests that do not send their own values.</span>
      </section>

      {profileError && (
        <div className="mp-alert error">
          <span>{profileError}</span>
          <button onClick={() => setProfileError(null)} aria-label="Dismiss"><CloseIcon size={13} /></button>
        </div>
      )}

      {profileResult && (
        <section className={`mp-card mp-profile-card ${profileResult.isCloud ? 'cloud' : 'local'}`}>
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">Latency profile</div>
              <div className="mp-section-title">{profileResult.model}</div>
            </div>
            <div className="mp-profile-meta font-mono">
              <span>ctx {profileResult.options?.num_ctx || devConfig.num_ctx}</span>
              <span>temp {profileResult.options?.temperature ?? devConfig.temperature}</span>
              <button className="mp-icon-btn" onClick={() => setProfileResult(null)} aria-label="Close profile"><CloseIcon size={13} /></button>
            </div>
          </div>

          <div className="mp-profile-grid">
            <div className="mp-profile-metric">
              <span>Load</span>
              <strong>{profileResult.loadMs !== null ? formatLatency(profileResult.loadMs) : 'Not reported'}</strong>
              <small>{profileResult.loadMs === null ? 'Cloud endpoint' : profileResult.loadMs > 800 ? 'Cold weights' : 'Warm in memory'}</small>
            </div>
            <div className="mp-profile-metric">
              <span>Prompt eval</span>
              <strong>{profileResult.promptEvalMs !== null ? formatLatency(profileResult.promptEvalMs) : 'Not reported'}</strong>
              <small>{profileResult.promptTokens} prompt tokens</small>
            </div>
            <div className="mp-profile-metric">
              <span>Generation</span>
              <strong>{profileResult.evalMs !== null ? formatLatency(profileResult.evalMs) : 'Not reported'}</strong>
              <small>{profileResult.tokensPerSec} tok/s · {profileResult.completionTokens} tokens</small>
            </div>
            <div className="mp-profile-metric highlight">
              <span>End to end</span>
              <strong>{formatLatency(profileResult.latencyMs)}</strong>
              <small>{profileResult.totalTokens} tokens total</small>
            </div>
          </div>

          {profileResult.content && (
            <div className="mp-profile-output">
              <span className="mp-eyebrow">Sample</span>
              <p>{profileResult.content.slice(0, 220)}{profileResult.content.length > 220 ? '...' : ''}</p>
            </div>
          )}
        </section>
      )}

      <section className="mp-kpi-grid">
        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span>Requests</span>
            {totalReq === 0
              ? <span className="mp-badge neutral">No data</span>
              : <span className={`mp-badge ${successRate >= 99 ? 'success' : successRate >= 95 ? 'warn' : 'danger'}`}>{successRate}% success</span>}
          </div>
          <div className="mp-kpi-value font-mono">{totalReq.toLocaleString()}</div>
          <div className="mp-kpi-foot">
            <span>{summary?.successfulRequests ?? 0} succeeded</span>
            <span className={(summary?.failedRequests ?? 0) > 0 ? 'text-danger' : ''}>{summary?.failedRequests ?? 0} failed</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span>Tokens</span>
            <span className="mp-badge neutral">{totalTok > 0 ? `${Math.round((promptTok / totalTok) * 100)}% in` : 'No traffic'}</span>
          </div>
          <div className="mp-kpi-value font-mono">{totalTok >= 1e6 ? `${(totalTok / 1e6).toFixed(2)}M` : totalTok.toLocaleString()}</div>
          <div className="mp-kpi-foot">
            <span>{promptTok.toLocaleString()} prompt</span>
            <span>{compTok.toLocaleString()} completion</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span>Latency p95</span>
            <span className="mp-badge neutral">{activeTps > 0 ? `${activeTps} tok/s` : 'No sample'}</span>
          </div>
          <div className="mp-kpi-value font-mono">{totalReq > 0 ? formatLatency(p95Lat ?? avgLat) : '--'}</div>
          <div className="mp-kpi-foot">
            <span>avg {formatLatency(avgLat)}</span>
            <span>p50 {p50Lat != null ? formatLatency(p50Lat) : '--'}</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span>Prompt cache</span>
            <span className={`mp-badge ${cacheReported === 0 ? 'neutral' : cacheRate >= 50 ? 'success' : 'warn'}`}>
              {cacheReported > 0 ? `${cacheRate}% hit` : 'Not reported'}
            </span>
          </div>
          <div className="mp-kpi-value font-mono">{cacheHits.toLocaleString()}</div>
          <div className="mp-kpi-foot">
            <span>{cacheReported.toLocaleString()} cache-reported</span>
            <span>{activeLoadMs > 0 ? `load ${formatLatency(activeLoadMs)}` : 'load n/a'}</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span>Estimated spend</span>
            <span className={`mp-badge ${totalCost > 0 ? 'warn' : 'success'}`}>{totalCost > 0 ? 'Priced' : 'No cost'}</span>
          </div>
          <div className="mp-kpi-value font-mono">${totalCost.toFixed(4)}</div>
          <div className="mp-kpi-foot">
            <span>${burnRate.toFixed(2)}/day</span>
            <span>~${projected30d.toFixed(2)} / 30d</span>
          </div>
        </div>
      </section>

      <section className="mp-overview-grid">
        <div className="mp-card mp-chart-card">
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">Throughput</div>
              <div className="mp-section-title">Token volume</div>
            </div>
            <div className="mp-segmented font-mono">
              {(['15m', '1h', '6h', '24h', '7d'] as const).map((tf) => (
                <button
                  key={tf}
                  className={activeTimeframe === tf ? 'active' : ''}
                  onClick={() => onTimeframeChange(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="mp-chart-legend font-mono">
            <span><i className="prompt" /> Prompt</span>
            <span><i className="completion" /> Completion</span>
          </div>

          <div className="mp-chart-body">
            {chartData.length === 0 ? (
              <div className="mp-empty">
                <strong>No traffic in this window</strong>
                <span>Send a request through an application key or the Playground to populate this chart.</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-orange)" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="var(--mp-orange)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-cyan)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--mp-cyan)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="#334155" fontSize={10} tickLine={false} fontFamily="JetBrains Mono" />
                  <YAxis stroke="#334155" fontSize={10} tickLine={false} fontFamily="JetBrains Mono" tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val} />
                  <Tooltip
                    contentStyle={{ background: 'var(--mp-surface-input)', borderColor: 'var(--mp-border)', borderRadius: '6px', fontSize: '11px', fontFamily: 'JetBrains Mono' }}
                    labelStyle={{ color: 'var(--mp-text-primary)', fontWeight: 600 }}
                    formatter={(val: any, name: any) => [`${Number(val).toLocaleString()} tokens`, name === 'prompt' ? 'Prompt' : 'Completion']}
                  />
                  <Area type="monotone" dataKey="prompt" stroke="var(--mp-orange)" strokeWidth={2} fillOpacity={1} fill="url(#promptGrad)" />
                  <Area type="monotone" dataKey="completion" stroke="var(--mp-cyan)" strokeWidth={2} fillOpacity={1} fill="url(#completionGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="mp-card mp-route-map">
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">Available targets</div>
              <div className="mp-section-title">Providers and models</div>
            </div>
            <span className="mp-muted font-mono">{localModels.length + customCloudModels.length} models</span>
          </div>

          <div className="mp-target-list">
            {localModels.length > 0 ? localModels.map((model) => {
              const selected = normalizeModel(effectiveModel) === normalizeModel(model.name);
              const benchmark = benchmarks.find(b => normalizeModel(b.model) === normalizeModel(model.name));
              return (
                <button
                  key={model.name}
                  className={`mp-target-row ${selected ? 'active' : ''}`}
                  onClick={() => handleRoutingModelChange(model.name)}
                  disabled={switching || !routingAppId}
                >
                  <span className="mp-target-main">
                    <span className="mp-status-dot" />
                    <span>
                      <strong>{model.name}</strong>
                      <small>Ollama · {model.parameterSize || 'local'} · {model.size}</small>
                    </span>
                  </span>
                  <span className="mp-target-side font-mono" title={benchmark ? `avg ${formatLatency(benchmark.avgLatencyMs)}` : undefined}>
                    {selected ? 'Selected' : benchmark ? `${formatLatency(benchmark.p95LatencyMs ?? benchmark.avgLatencyMs)} p95` : 'Pin'}
                  </span>
                </button>
              );
            }) : (
              <div className="mp-empty compact">
                <strong>No local models discovered</strong>
                <span>Start Ollama or add a cloud endpoint in Models.</span>
              </div>
            )}

            {customCloudModels.map((model) => {
              const selected = normalizeModel(effectiveModel) === normalizeModel(model.modelId);
              const benchmark = benchmarks.find(b => normalizeModel(b.model) === normalizeModel(model.modelId));
              return (
                <button
                  key={model.modelId}
                  className={`mp-target-row ${selected ? 'active' : ''}`}
                  onClick={() => handleRoutingModelChange(model.modelId)}
                  disabled={switching || !routingAppId}
                >
                  <span className="mp-target-main">
                    <span className="mp-status-dot cloud" />
                    <span>
                      <strong>{model.displayName || model.modelId}</strong>
                      <small>{model.provider} · {model.apiBase.replace(/^https?:\/\//, '').split('/')[0]}</small>
                    </span>
                  </span>
                  <span className="mp-target-side font-mono" title={benchmark ? `avg ${formatLatency(benchmark.avgLatencyMs)}` : undefined}>
                    {selected ? 'Selected' : benchmark ? `${formatLatency(benchmark.p95LatencyMs ?? benchmark.avgLatencyMs)} p95` : 'Pin'}
                  </span>
                </button>
              );
            })}
          </div>

          <button className="mp-link-btn mp-route-map-link" onClick={() => onNavigateToTab('models')}>
            Manage models <ChevronRightIcon size={11} />
          </button>
        </div>
      </section>

      <section className="mp-card">
        <div className="mp-section-head">
          <div>
            <div className="mp-eyebrow">Latest activity</div>
            <div className="mp-section-title">Recent requests</div>
          </div>
          <button className="mp-link-btn" onClick={() => onNavigateToTab('logs')}>
            Open logs <ChevronRightIcon size={11} />
          </button>
        </div>

        <div className="mp-table-wrapper">
          <table className="mp-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Application</th>
                <th>Model</th>
                <th>Status</th>
                <th>Latency breakdown</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {recentItems.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="mp-empty compact">
                      <strong>No requests yet</strong>
                      <span>Requests appear here once an application sends traffic through the gateway.</span>
                    </div>
                  </td>
                </tr>
              ) : recentItems.map((req) => {
                const ok = req.status === 'success';
                const { time, date } = formatTimestampParts(req.timestamp);
                return (
                  <tr key={req.id}>
                    <td>
                      <div className="mp-table-primary font-mono">{time}</div>
                      <div className="mp-table-secondary font-mono">{date}</div>
                    </td>
                    <td>
                      <div className="mp-table-primary">{req.application_name || req.application_id || 'Direct client'}</div>
                      {req.client_model && req.client_model !== req.model && (
                        <div className="mp-table-secondary font-mono">requested {req.client_model}</div>
                      )}
                    </td>
                    <td className="font-mono">{req.model}</td>
                    <td>
                      <span className={`mp-badge ${ok ? 'success' : 'danger'}`}>
                        {req.http_status || (ok ? 200 : 'error')}
                      </span>
                    </td>
                    <td className="font-mono">
                      <div>{formatLatency(req.latency_ms)}</div>
                      <div className="mp-table-secondary" style={{ display: 'flex', gap: '10px', fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}>
                        <span title="Model load">L:{formatBreakdown(req.load_duration_ms)}</span>
                        <span title="Prompt eval">PE:{formatBreakdown(req.prompt_eval_duration_ms)}</span>
                        <span title="Generation">G:{formatBreakdown(req.eval_duration_ms)}</span>
                      </div>
                      {req.cache_status === 'cache_hit' && <span className="mp-table-secondary"> cache hit</span>}
                    </td>
                    <td className="font-mono">{(req.total_tokens || 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mp-table-foot font-mono">
          <span>Prompts and completions are not stored. Only anonymous telemetry is kept.</span>
          <span>SQLite · WAL</span>
        </div>
      </section>
    </div>
  );
};
