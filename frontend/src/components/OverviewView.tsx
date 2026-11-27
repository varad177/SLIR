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
  CloseIcon,
  RotateCwIcon
} from './icons/Icons';
import { InfoTip } from './InfoTip';
import { FailoverRouteSummary } from './FailoverRouteSummary';
import { RequestDetailInspector } from './RequestDetailInspector';
import { copyText } from '../utils/clipboard';
import { failoverReasonLabel, hasFailoverActivity } from '../utils/failover';
import {
  formatTimestampParts,
  formatLatency,
  formatBreakdown,
  requestStatusLabel
} from '../utils/telemetryFormat';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
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
  gatewayPort?: number;
  allAppsScope?: boolean;
  onSelectAppId?: (appId: string | null) => void;
  activeTimeframe: '15m' | '1h' | '6h' | '24h' | '7d' | 'all';
  onTimeframeChange: (tf: '15m' | '1h' | '6h' | '24h' | '7d' | 'all') => void;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  onInspectRequest?: (requestId: string) => void;
}

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
  onTimeframeChange,
  autoRefresh = true,
  onAutoRefreshChange,
  refreshing = false,
  onRefresh,
  onInspectRequest,
  gatewayPort = 4101
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; label: string } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('slir-onboarding-dismissed') !== 'true'
  );

  const [devConfig, setDevConfig] = useState<DevConfig>({ temperature: 0.7, num_ctx: 4096 });
  const [profiling, setProfiling] = useState(false);
  const [profileResult, setProfileResult] = useState<ProfileBenchmarkResult | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [modelsData, setModelsData] = useState<InstalledModelsResponse | null>(null);
  const [benchmarks, setBenchmarks] = useState<ModelBenchmarkItem[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [tokenChartHover, setTokenChartHover] = useState<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const [recentFilter, setRecentFilter] = useState<'all' | 'failover' | 'failure'>('all');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

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

  const handleCopyUrl = async () => {
    if (!(await copyText(getBrowserGatewayBaseUrl(gatewayPort)))) return;
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
      const failoverHeader = res.headers.get('x-slir-failover');
      const failoverFrom = res.headers.get('x-slir-failover-from') || effectiveModel;
      const failoverReason = res.headers.get('x-slir-failover-reason');
      if (!res.ok) {
        onModelSwitched();
        const errMsg = payload?.error?.message || payload?.error || `Gateway returned HTTP ${res.status}`;
        throw new Error(
          failoverHeader === 'attempted'
            ? `Failover attempted but failed: ${errMsg}`
            : errMsg
        );
      }
      const latency = performance.now() - startedAt;
      const routedModel = res.headers.get('x-slir-model') || payload?.model || effectiveModel;
      const tokens = payload?.usage?.total_tokens ?? 0;
      onModelSwitched();
      setPingResult({
        ok: true,
        label: failoverHeader === 'true'
          ? `Failover happened: ${failoverFrom} failed (${failoverReasonLabel(failoverReason)}) → ${routedModel} · ${Math.round(latency)} ms · ${tokens} tokens`
          : `${Math.round(latency)} ms · ${routedModel} · ${tokens} tokens`
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

  const cacheBadgeClass = `mp-badge ${cacheReported === 0 ? 'neutral' : cacheRate >= 50 ? 'success' : 'warn'}`;
  const costBadgeClass = `mp-badge ${totalCost > 0 ? 'warn' : 'success'}`;
  const requestsBadgeClass = totalReq === 0
    ? 'mp-badge neutral'
    : `mp-badge ${successRate >= 99 ? 'success' : successRate >= 95 ? 'warn' : 'danger'}`;

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
      requests: pt.requests || 0,
      avgLatency: pt.avgLatencyMs || 0,
      p95Latency: pt.latencyP95Ms || 0,
      p50Latency: pt.latencyP50Ms || 0
    };
  });

  const allRecent = requests?.items || [];
  const failoverCount = allRecent.filter((req) => hasFailoverActivity(req)).length;
  const failureCount = allRecent.filter((req) => req.status === 'failure').length;
  const filteredRecent = recentFilter === 'failover'
    ? allRecent.filter((req) => hasFailoverActivity(req))
    : recentFilter === 'failure'
      ? allRecent.filter((req) => req.status === 'failure')
      : allRecent;
  const recentItems = filteredRecent.slice(0, 10);
  const selectedItem = selectedRequestId
    ? allRecent.find((req) => req.request_id === selectedRequestId) || null
    : null;

  return (
    <div className="mp-overview">
      {showOnboarding && totalReq === 0 && (
        <section className="mp-onboarding-card">
          <div className="mp-onboarding-copy">
            <div className="mp-eyebrow">First run</div>
            <h2>Get your first request through SLIR</h2>
            <p>Three steps: create an application, confirm its model route, then send a test request and inspect the log.</p>
          </div>
          <div className="mp-onboarding-steps">
            <button type="button" onClick={() => onNavigateToTab('apps')}>
              <span>1</span>
              <strong>Create or open an application</strong>
              <small>Copy its virtual API key.</small>
            </button>
            <button type="button" onClick={() => onNavigateToTab('models')}>
              <span>2</span>
              <strong>Choose the active model</strong>
              <small>Use a local Ollama model or a cloud endpoint.</small>
            </button>
            <button type="button" onClick={() => onNavigateToTab('playground')}>
              <span>3</span>
              <strong>Send a test request</strong>
              <small>Requests appear in Logs with latency and tokens.</small>
            </button>
          </div>
          <button
            type="button"
            className="mp-onboarding-dismiss"
            onClick={() => {
              window.localStorage.setItem('slir-onboarding-dismissed', 'true');
              setShowOnboarding(false);
            }}
          >
            Dismiss
          </button>
        </section>
      )}

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
            <InfoTip
              title={isPinned ? 'Pinned model' : 'Follows global fallback'}
              text={
                isPinned
                  ? 'This application is locked ("pinned") to a dedicated model. All requests using this app key route here (ignoring any model sent by the SDK) even if the Global Fallback changes.'
                  : 'This application follows the shared Global Fallback. All requests using this app key route to whichever model is set globally on the Models tab, regardless of the model configured in the SDK.'
              }
              example={isPinned ? 'Click "Follow global" to unpin' : 'Select a specific model below to pin this app'}
            >
              <span className={`mp-rule-chip ${isPinned ? 'pinned' : 'global'}`}>
                <span className="mp-rule-dot" />
                {isPinned ? 'Pinned model' : 'Follows global fallback'}
              </span>
            </InfoTip>
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
            <span className="mp-field-label mp-label-with-tip">
              <span>Route this application to</span>
              <InfoTip
                title="Application Routing Mode"
                text="'Follow global fallback' shares one global model across unpinned apps. Picking any specific model pins this app so its default route never changes when you switch the global model."
              />
            </span>
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

          <InfoTip
            title="Follow global"
            text="Removes this app's model pin so it automatically uses the shared Global Fallback model again."
          >
            <button
              className="mp-btn mp-btn-secondary mp-nowrap"
              onClick={() => handleRoutingModelChange('active-model')}
              disabled={switching || !isPinned || !routingAppId}
            >
              Follow global
            </button>
          </InfoTip>
        </div>

        <div className="mp-routing-footer">
          <div className="mp-url-chip font-mono">
            <span>{getBrowserGatewayBaseUrl(gatewayPort)}</span>
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
          <span className="mp-label-with-tip">
            <span>Context</span>
            <InfoTip
              title="Context window (num_ctx)"
              text="Max tokens (prompt + reply combined) a local Ollama model keeps in memory at once. Larger context uses more GPU VRAM."
            />
          </span>
          <select className="mp-select mp-select-compact font-mono" value={devConfig.num_ctx} onChange={(e) => handleChangeContext(Number(e.target.value))}>
            <option value={2048}>2K</option>
            <option value={4096}>4K</option>
            <option value={8192}>8K</option>
            <option value={16384}>16K</option>
          </select>
        </label>
        <label className="mp-inline-field">
          <span className="mp-label-with-tip">
            <span>Temperature</span>
            <InfoTip
              title="Sampling temperature"
              text="Controls output randomness. 0.0 produces deterministic, repeatable answers; higher values (0.7–1.0) give more varied and creative replies."
            />
          </span>
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
              <span className="mp-label-with-tip">
                <span>Load</span>
                <InfoTip
                  title="Model Load Duration"
                  text="Time to load model weights into GPU/RAM. Over ~800ms means 'Cold weights' (first load); near 0ms means 'Warm in memory'."
                />
              </span>
              <strong>{profileResult.loadMs !== null ? formatLatency(profileResult.loadMs) : 'Not reported'}</strong>
              <small>{profileResult.loadMs === null ? 'Cloud endpoint' : profileResult.loadMs > 800 ? 'Cold weights' : 'Warm in memory'}</small>
            </div>
            <div className="mp-profile-metric">
              <span className="mp-label-with-tip">
                <span>Prompt eval</span>
                <InfoTip
                  title="Prompt Evaluation (TTFT)"
                  text="Time spent reading and processing your input prompt before the model begins generating its first output token."
                />
              </span>
              <strong>{profileResult.promptEvalMs !== null ? formatLatency(profileResult.promptEvalMs) : 'Not reported'}</strong>
              <small>{profileResult.promptTokens} prompt tokens</small>
            </div>
            <div className="mp-profile-metric">
              <span className="mp-label-with-tip">
                <span>Generation</span>
                <InfoTip
                  title="Token Generation Time"
                  text="Time spent producing the reply tokens, plus output speed measured in tokens per second (tok/s)."
                />
              </span>
              <strong>{profileResult.evalMs !== null ? formatLatency(profileResult.evalMs) : 'Not reported'}</strong>
              <small>{profileResult.tokensPerSec} tok/s · {profileResult.completionTokens} tokens</small>
            </div>
            <div className="mp-profile-metric highlight">
              <span className="mp-label-with-tip">
                <span>End to end</span>
                <InfoTip
                  title="Total Latency"
                  text="Complete wall-clock time from sending the request until the full response finishes."
                />
              </span>
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
            <span className={requestsBadgeClass}>{totalReq === 0 ? 'No data' : successRate + '% success'}</span>
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
            <span className="mp-badge neutral">{totalTok > 0 ? Math.round((promptTok / totalTok) * 100) + '% in' : 'No traffic'}</span>
          </div>
          <div className="mp-kpi-value font-mono">{totalTok >= 1e6 ? `${(totalTok / 1e6).toFixed(2)}M` : totalTok.toLocaleString()}</div>
          <div className="mp-kpi-foot">
            <span>{promptTok.toLocaleString()} prompt</span>
            <span>{compTok.toLocaleString()} completion</span>
          </div>
        </div>

        <div className="mp-kpi mp-kpi-chart">
          <div className="mp-kpi-top">
            <span>Token Volume</span>
            <div className="mp-segmented font-mono mp-segmented-compact">
              {(['15m', '1h', '6h', '24h', '7d', 'all'] as const).map((tf) => (
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
          <div className="mp-kpi-chart-body"
               onMouseEnter={(e) => setTokenChartHover({ active: true, x: e.clientX, y: e.clientY })}
               onMouseLeave={() => setTokenChartHover({ active: false, x: 0, y: 0 })}
               onMouseMove={(e) => setTokenChartHover(prev => prev.active ? { ...prev, x: e.clientX, y: e.clientY } : prev)}>
            {chartData.length === 0 ? (
              <div className="mp-empty compact" style={{ padding: '20px', textAlign: 'center' }}>
                <strong>No token data</strong>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="promptGradKpi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-orange)" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="var(--mp-orange)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="completionGradKpi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-cyan)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--mp-cyan)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="#334155" fontSize={9} tickLine={false} fontFamily="JetBrains Mono" interval="preserveStartEnd" />
                  <YAxis stroke="#334155" fontSize={9} tickLine={false} fontFamily="JetBrains Mono" tickFormatter={(val) => val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val} />
                  <Tooltip
                    contentStyle={{ background: 'var(--mp-surface-input)', borderColor: 'var(--mp-border)', borderRadius: '6px', fontSize: '11px', fontFamily: 'JetBrains Mono' }}
                    labelStyle={{ color: 'var(--mp-text-primary)', fontWeight: 600 }}
                    formatter={(val: any, name: any) => [Number(val).toLocaleString() + ' tokens', name === 'prompt' ? 'Prompt' : 'Completion']}
                  />
                  <Area type="linear" dataKey="prompt" stroke="var(--mp-orange)" strokeWidth={2} fillOpacity={1} fill="url(#promptGradKpi)" dot={false} />
                  <Area type="linear" dataKey="completion" stroke="var(--mp-cyan)" strokeWidth={2} fillOpacity={1} fill="url(#completionGradKpi)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mp-kpi-foot">
            <span>{promptTok.toLocaleString()} prompt</span>
            <span>{compTok.toLocaleString()} completion</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span className="mp-label-with-tip">
              <span>Prompt cache</span>
              <InfoTip
                title="Prompt KV Cache Hits"
                text="How often the model reused cached prompt prefixes (such as a repeated system prompt) instead of re-evaluating them, reducing latency and input cost."
              />
            </span>
            <span className={cacheBadgeClass}>
              {cacheReported > 0 ? cacheRate + '% hit' : 'Not reported'}
            </span>
          </div>
          <div className="mp-kpi-value font-mono">{cacheHits.toLocaleString()}</div>
          <div className="mp-kpi-foot">
            <span>{cacheReported.toLocaleString()} cache-reported</span>
            <span>{activeLoadMs > 0 ? 'load ' + formatLatency(activeLoadMs) : 'load n/a'}</span>
          </div>
        </div>

        <div className="mp-kpi">
          <div className="mp-kpi-top">
            <span className="mp-label-with-tip">
              <span>Estimated spend</span>
              <InfoTip
                title="Estimated Spend & Burn Rate"
                text="Calculated from prompt/completion tokens using your Pricing Rules under Costs & Alerts. Local Ollama models count as $0 unless you assign a rate."
              />
            </span>
            <span className={costBadgeClass}>{totalCost > 0 ? 'Priced' : 'No cost'}</span>
          </div>
          <div className="mp-kpi-value font-mono">${totalCost.toFixed(4)}</div>
          <div className="mp-kpi-foot">
            <span>${burnRate.toFixed(2)}/day</span>
            <span>~${projected30d.toFixed(2)} / 30d</span>
          </div>
        </div>
      </section>

      <div className={`mp-logs-grid ${selectedItem ? 'has-inspector' : ''}`}>
        <section className="mp-card mp-overview-requests-card">
          <div className="mp-section-head">
            <div>
              <div className="mp-eyebrow">Latest activity</div>
              <div className="mp-section-title">Recent requests</div>
            </div>
            <div className="mp-section-head-actions mp-recent-controls-wrap">
              <div className="mp-segmented font-mono mp-segmented-compact" role="tablist" aria-label="Filter recent requests">
                <button
                  type="button"
                  className={recentFilter === 'all' ? 'active' : ''}
                  onClick={() => setRecentFilter('all')}
                >
                  All ({allRecent.length})
                </button>
                <button
                  type="button"
                  className={recentFilter === 'failover' ? 'active' : ''}
                  onClick={() => setRecentFilter('failover')}
                >
                  Failovers ({failoverCount})
                </button>
                <button
                  type="button"
                  className={recentFilter === 'failure' ? 'active' : ''}
                  onClick={() => setRecentFilter('failure')}
                >
                  Failed ({failureCount})
                </button>
              </div>
              {onAutoRefreshChange && (
                <label className="mp-checkbox" title="Poll dashboard KPIs, charts, and recent requests every 5 seconds">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => onAutoRefreshChange(e.target.checked)}
                  />
                  <span>{autoRefresh ? 'Live tail' : 'Auto refresh'}</span>
                  {autoRefresh && <span className="mp-live-dot" aria-hidden="true" />}
                </label>
              )}
              {onRefresh && (
                <button
                  type="button"
                  className="mp-btn mp-btn-ghost"
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  <RotateCwIcon size={12} className={refreshing ? 'spin' : ''} />
                  {refreshing ? 'Refreshing' : 'Refresh'}
                </button>
              )}
              <button className="mp-link-btn" onClick={() => onNavigateToTab('logs')}>
                Open logs <ChevronRightIcon size={11} />
              </button>
            </div>
          </div>

          <div className="mp-table-wrapper">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Application</th>
                  <th>Model &amp; routing</th>
                  <th>Status</th>
                  <th>Latency breakdown</th>
                  <th>Tokens</th>
                  <th style={{ textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {recentItems.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="mp-empty compact">
                        <strong>{allRecent.length === 0 ? 'No requests yet' : 'No matching recent requests'}</strong>
                        <span>
                          {allRecent.length === 0
                            ? 'Requests appear here once an application sends traffic through the gateway.'
                            : 'Switch filter back to All to see other recent traffic.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : recentItems.map((req) => {
                  const ok = req.status === 'success';
                  const isSelected = selectedItem?.request_id === req.request_id;
                  const { time, date } = formatTimestampParts(req.timestamp);
                  const toggleSelect = () =>
                    setSelectedRequestId((prev) => (prev === req.request_id ? null : req.request_id));
                  return (
                    <tr
                      key={req.id}
                      className={`mp-clickable-row ${isSelected ? 'selected' : ''}`}
                      onClick={toggleSelect}
                      tabIndex={0}
                      aria-selected={isSelected}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleSelect();
                        }
                      }}
                    >
                      <td>
                        <div className="mp-table-primary font-mono">{time}</div>
                        <div className="mp-table-secondary font-mono">{date}</div>
                      </td>
                      <td>
                        <div className="mp-table-primary">{req.application_name || req.application_id || 'Direct client'}</div>
                        {req.client_model && req.client_model !== req.model && (
                          <div className="mp-table-secondary font-mono">SDK sent {req.client_model}</div>
                        )}
                      </td>
                      <td>
                        <FailoverRouteSummary item={req} showProvider={false} />
                      </td>
                      <td>
                        <span className={`mp-badge ${ok ? 'success' : 'danger'}`}>
                          {ok ? 'OK' : 'Failed'} · {requestStatusLabel(req)}
                        </span>
                      </td>
                      <td className="font-mono">
                        <div>{formatLatency(req.latency_ms)}</div>
                        <div className="mp-table-secondary" style={{ display: 'flex', gap: '10px', fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}>
                          <span title="Model load">L:{formatBreakdown(req.load_duration_ms)}</span>
                          <span title="Prompt eval">PE:{formatBreakdown(req.prompt_eval_duration_ms)}</span>
                          <span title="Generation">G:{formatBreakdown(req.eval_duration_ms)}</span>
                        </div>
                        {req.cache_status === 'cache_hit' && <span className="mp-table-secondary">cache hit</span>}
                      </td>
                      <td className="font-mono">{(req.total_tokens || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="mp-link-btn font-mono"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect();
                          }}
                        >
                          {isSelected ? 'Viewing' : 'Inspect'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mp-table-foot font-mono">
            <span>Click any request row to inspect full failover hops, latency breakdown, and errors.</span>
            <span>SQLite · WAL</span>
          </div>
        </section>

        {selectedItem && (
          <RequestDetailInspector
            item={selectedItem}
            gatewayPort={gatewayPort}
            onClose={() => setSelectedRequestId(null)}
            onOpenInLogs={onInspectRequest}
            onReplayInPlayground={() => onNavigateToTab('playground')}
          />
        )}
      </div>

      {tokenChartHover.active && chartData.length > 0 && (
        <div
          className="mp-chart-modal"
          onClick={() => setTokenChartHover({ active: false, x: 0, y: 0 })}
        >
          <div className="mp-chart-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="mp-chart-modal-header">
              <div className="mp-section-title font-mono">Token Volume — Detail</div>
              <button
                className="mp-chart-modal-close"
                onClick={() => setTokenChartHover({ active: false, x: 0, y: 0 })}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="mp-chart-modal-body">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 40 }}>
                  <defs>
                    <linearGradient id="promptGradTip" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-orange)" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="var(--mp-orange)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="completionGradTip" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--mp-cyan)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--mp-cyan)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    stroke="#334155"
                    fontSize={12}
                    tickLine={false}
                    fontFamily="JetBrains Mono"
                    interval="preserveStartEnd"
                    tick={{ fill: 'var(--mp-text-muted)' }}
                  />
                  <YAxis
                    stroke="#334155"
                    fontSize={12}
                    tickLine={false}
                    fontFamily="JetBrains Mono"
                    tickFormatter={(val) => val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}
                    tick={{ fill: 'var(--mp-text-muted)' }}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--mp-surface-input)',
                      borderColor: 'var(--mp-border)',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontFamily: 'JetBrains Mono',
                      padding: '12px 16px',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
                    }}
                    labelStyle={{ color: 'var(--mp-text-primary)', fontWeight: 600, fontSize: '12px' }}
                    formatter={(val: any, name: any) => [
                      Number(val).toLocaleString() + ' tokens',
                      name === 'prompt' ? 'Prompt Tokens' : 'Completion Tokens'
                    ]}
                    itemStyle={{ padding: '4px 0' }}
                    labelFormatter={(label) => {
                      const point = chartData.find(d => d.time === label);
                      if (point) {
                        return `${label}  •  Total: ${(point.prompt + point.completion).toLocaleString()} tokens`;
                      }
                      return label;
                    }}
                  />
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--mp-border)" vertical={false} />
                  <Legend
                    layout="horizontal"
                    align="center"
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={10}
                    wrapperStyle={{ paddingBottom: '10px', paddingTop: '5px' }}
                  />
                  <Area
                    type="linear"
                    dataKey="prompt"
                    name="Prompt"
                    stroke="var(--mp-orange)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#promptGradTip)"
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="linear"
                    dataKey="completion"
                    name="Completion"
                    stroke="var(--mp-cyan)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#completionGradTip)"
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
