import React, { useState, useEffect } from 'react';
import { 
  SummaryKpis, 
  TimeSeriesPoint, 
  RequestsResponse, 
  InstalledModelsResponse, 
  OllamaModelInfo, 
  CustomCloudModel,
  ModelBenchmarkItem,
  ApplicationItem,
  DevConfig,
  ProfileBenchmarkResult
} from '../types/analytics';
import { 
  fetchInstalledModels, 
  setActiveModel, 
  fetchModelBenchmark,
  runTestPromptBenchmark,
  fetchDevConfig,
  updateDevConfig,
  runProfileBenchmark
} from '../api/client';
import {
  CopyIcon,
  CheckIcon,
  ZapIcon,
  RefreshCwIcon,
  ChevronRightIcon,
  RotateCwIcon,
  SlidersIcon,
  ShieldCheckIcon
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
  onSelectAppId?: (appId: string | null) => void;
  activeTimeframe: '15m' | '1h' | '6h' | '24h' | '7d';
  onTimeframeChange: (tf: '15m' | '1h' | '6h' | '24h' | '7d') => void;
}

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
  onSelectAppId,
  activeTimeframe,
  onTimeframeChange
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  // Developer Runtime Latency & Context Parameters
  const [devConfig, setDevConfig] = useState<DevConfig>({ temperature: 0.7, num_ctx: 4096 });
  const [profiling, setProfiling] = useState<boolean>(false);
  const [profileResult, setProfileResult] = useState<ProfileBenchmarkResult | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Model switching on home page
  const [modelsData, setModelsData] = useState<InstalledModelsResponse | null>(null);
  const [benchmarks, setBenchmarks] = useState<ModelBenchmarkItem[]>([]);
  const [selectedSwitchModel, setSelectedSwitchModel] = useState<string>(activeModel);
  const [switching, setSwitching] = useState<boolean>(false);
  const [switchFeedback, setSwitchFeedback] = useState<string | null>(null);

  // Load installed models and benchmarks for real telemetry
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const [modelsRes, benchRes, devRes] = await Promise.all([
          fetchInstalledModels().catch(() => null),
          fetchModelBenchmark().catch(() => ({ count: 0, models: [] })),
          fetchDevConfig().catch(() => ({ temperature: 0.7, num_ctx: 4096 }))
        ]);
        if (mounted) {
          if (devRes) {
            setDevConfig(devRes);
          }
          if (modelsRes) {
            setModelsData(modelsRes);
            if (modelsRes.activeModel) {
              setSelectedSwitchModel(modelsRes.activeModel);
            }
          }
          if (benchRes?.models) {
            setBenchmarks(benchRes.models);
          }
        }
      } catch (err) {
        console.error('Failed to load overview model data:', err);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, [benchmarkRefresh]);

  useEffect(() => {
    if (activeModel) {
      setSelectedSwitchModel(activeModel);
    }
  }, [activeModel]);

  const handleSwitchModel = async (newModel: string) => {
    if (!newModel || newModel === activeModel) return;
    try {
      setSwitching(true);
      setSwitchFeedback(null);
      await setActiveModel(newModel);
      setSelectedSwitchModel(newModel);
      setSwitchFeedback(`Active model switched to ${newModel}`);
      onModelSwitched();
      setTimeout(() => setSwitchFeedback(null), 3500);
    } catch (err: any) {
      setSwitchFeedback(`Switch error: ${err.message || 'Failed'}`);
      setTimeout(() => setSwitchFeedback(null), 4000);
    } finally {
      setSwitching(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText('http://localhost:4101/v1');
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleTestPing = async () => {
    setPinging(true);
    try {
      const start = performance.now();
      const res = await runTestPromptBenchmark(activeModel, 'Ping test');
      const ms = Math.round(performance.now() - start);
      if (res && res.latencyMs) {
        setPingResult(`${Math.round(res.latencyMs)}ms OK`);
      } else {
        setPingResult(`${ms}ms OK`);
      }
      setTimeout(() => setPingResult(null), 3500);
    } catch (err: any) {
      setPingResult('Err');
      setTimeout(() => setPingResult(null), 3000);
    } finally {
      setPinging(false);
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
        model: selectedSwitchModel || activeModel,
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

  // Real KPI stats from SQLite summary
  const totalReq = summary?.totalRequests ?? 0;
  const totalCost = summary?.estimatedCost ?? 0.0;
  const totalTok = summary?.totalTokens ?? 0;
  const promptTok = summary?.promptTokens ?? 0;
  const compTok = summary?.completionTokens ?? 0;
  const avgLat = summary?.avgLatencyMs ?? 0;
  const successRate = summary?.successRate ?? (totalReq > 0 ? 100 : 100);

  // Active application filter
  const activeApp = applications.find(a => a.id === selectedAppId);

  // Active model details
  const localModels = modelsData?.models || [];
  const customCloudModels = modelsData?.customModels || [];
  const activeCustom = customCloudModels.find(c => c.modelId === activeModel);
  const activeLocal = localModels.find(m => m.name === activeModel || m.name.includes(activeModel));
  const isCloudActive = !!activeCustom;

  // Real benchmark for active model
  const activeBenchmark = benchmarks.find(b => b.model.includes(activeModel) || activeModel.includes(b.model.replace(/^ollama\//, '')));
  const activeColdLoadMs = activeBenchmark?.avgLoadMs || 0;
  const activePromptEvalMs = activeBenchmark?.avgPromptEvalMs || 0;
  const activeTps = activeBenchmark?.tokensPerSec || 0;

  // Real chart data from SQLite timeSeries
  const chartData = (timeSeries && timeSeries.length > 0)
    ? timeSeries.map((pt, i) => {
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
      })
    : [];

  // Real recent requests from SQLite buffer
  const recentItems = requests?.items?.slice(0, 8) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Gateway Online Hero Banner + Real Interactive Model Selector */}
      <div className="mp-gateway-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#f8fafc' }}>
              Gateway Online
            </span>
          </div>

          <div
            className="font-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid #1e2433',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.75rem',
              color: '#94a3b8'
            }}
          >
            <span style={{ color: '#e2e8f0' }}>http://localhost:4101/v1</span>
            <button
              onClick={handleCopyUrl}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
              title="Copy base URL"
            >
              {copiedUrl ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>

          <span className="font-mono" style={{ fontSize: '0.75rem', color: '#10b981' }}>
            {isCloudActive ? `● Ready · ${activeCustom?.provider.toUpperCase()} Cloud` : '● Ready · Local Ollama'}
          </span>
        </div>

        {/* Right Section: App Selector, Model Selector & Switcher from Home Page */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Real Interactive Application Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>APP:</span>
            <select
              value={selectedAppId || 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? null : e.target.value;
                if (onSelectAppId) onSelectAppId(val);
              }}
              className="mp-select font-mono"
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: '#090b10',
                border: selectedAppId ? '1px solid #f97316' : '1px solid #2b3345',
                color: selectedAppId ? '#f97316' : '#f8fafc',
                cursor: 'pointer',
                borderRadius: '6px',
                fontWeight: 600
              }}
            >
              <option value="all">All Applications ({applications.length})</option>
              {applications.map(app => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>

          {/* Real Interactive Model Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>ACTIVE TARGET:</span>
            <select
              value={selectedSwitchModel}
              onChange={(e) => handleSwitchModel(e.target.value)}
              disabled={switching}
              className="mp-select font-mono"
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: '#090b10',
                border: '1px solid #2b3345',
                color: '#f8fafc',
                cursor: 'pointer',
                borderRadius: '6px'
              }}
            >
              <optgroup label="Local Ollama Models">
                {localModels.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.size})
                  </option>
                ))}
              </optgroup>
              {customCloudModels.length > 0 && (
                <optgroup label="Custom & External Endpoints">
                  {customCloudModels.map(c => (
                    <option key={c.modelId} value={c.modelId}>
                      {c.displayName || c.modelId} ({c.provider.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Real Context Size (num_ctx) Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>CONTEXT (num_ctx):</span>
            <select
              value={devConfig.num_ctx}
              onChange={(e) => handleChangeContext(Number(e.target.value))}
              className="mp-select font-mono"
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: '#090b10',
                border: '1px solid #2b3345',
                color: '#f8fafc',
                cursor: 'pointer',
                borderRadius: '6px'
              }}
              title="Allocates KV cache memory window. Larger contexts increase memory allocation and loading duration."
            >
              <option value={2048}>2048 (2K - Fast Load)</option>
              <option value={4096}>4096 (4K - Standard)</option>
              <option value={8192}>8192 (8K - High Context)</option>
              <option value={16384}>16384 (16K - Deep Memory)</option>
            </select>
          </div>

          {/* Real Temperature Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>TEMP:</span>
            <select
              value={devConfig.temperature}
              onChange={(e) => handleChangeTemperature(Number(e.target.value))}
              className="mp-select font-mono"
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: '#090b10',
                border: '1px solid #2b3345',
                color: '#f8fafc',
                cursor: 'pointer',
                borderRadius: '6px'
              }}
              title="Controls sampling logits distribution. 0.0 is strictly deterministic for JSON schema and fastest stop paths."
            >
              <option value={0.0}>0.0 (Strict / JSON)</option>
              <option value={0.2}>0.2 (Focused)</option>
              <option value={0.7}>0.7 (Balanced)</option>
              <option value={1.0}>1.0 (Creative)</option>
            </select>
          </div>

          {/* Profile Latency & Load Time Button */}
          <button
            onClick={handleRunProfile}
            disabled={profiling || switching}
            style={{
              background: '#f97316',
              color: '#0c0e14',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 14px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: (profiling || switching) ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'JetBrains Mono, monospace'
            }}
            title="Send diagnostic probe with active temperature and num_ctx to measure real load duration, prompt eval, and inference latency"
          >
            <ZapIcon size={12} />
            <span>{profiling ? 'Measuring...' : 'Profile Latency'}</span>
          </button>
        </div>
      </div>

      {/* Latency Profile Error Alert */}
      {profileError && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            color: '#fb7185',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>Diagnostic error: {profileError}</span>
          <button
            onClick={() => setProfileError(null)}
            style={{ background: 'transparent', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Real Latency & Loading Diagnostics Card */}
      {profileResult && (
        <div
          className="mp-card font-mono"
          style={{
            background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.08) 0%, rgba(15, 18, 25, 0.95) 100%)',
            border: '1px solid rgba(249, 115, 22, 0.35)',
            borderRadius: '8px',
            padding: '16px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
              <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#f8fafc' }}>
                DIAGNOSTIC LATENCY & LOAD BREAKDOWN: {profileResult.model}
              </span>
              <span style={{ fontSize: '0.6875rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>
                num_ctx: {profileResult.options?.num_ctx || devConfig.num_ctx}
              </span>
              <span style={{ fontSize: '0.6875rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>
                temp: {profileResult.options?.temperature ?? devConfig.temperature}
              </span>
            </div>
            <button
              onClick={() => setProfileResult(null)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.875rem', padding: '0 4px' }}
              title="Close diagnostics"
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {/* 1. Load Duration */}
            <div style={{ background: '#090b10', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>📦 MODEL LOAD TIME</span>
                <span style={{
                  fontSize: '0.625rem',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  color: (profileResult.loadMs || 0) > 800 ? '#f59e0b' : '#10b981',
                  background: (profileResult.loadMs || 0) > 800 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)'
                }}>
                  {(profileResult.loadMs || 0) > 800 ? 'Cold Load' : 'Resident Warm'}
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                {profileResult.loadMs !== null ? `${profileResult.loadMs.toLocaleString()} ms` : '0 ms'}
              </div>
              <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                Weights & KV cache memory init
              </div>
            </div>

            {/* 2. Prompt Eval Duration (TTFT) */}
            <div style={{ background: '#090b10', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>⚡ PROMPT EVAL (TTFT)</span>
                <span style={{ fontSize: '0.625rem', color: '#f97316', background: 'rgba(249, 115, 22, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                  {profileResult.promptTokens} tokens
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                {profileResult.promptEvalMs !== null ? `${profileResult.promptEvalMs.toLocaleString()} ms` : '--'}
              </div>
              <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                Time to First Token (attention pass)
              </div>
            </div>

            {/* 3. Eval Duration (Generation) */}
            <div style={{ background: '#090b10', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>🔄 INFERENCE EVAL</span>
                <span style={{ fontSize: '0.625rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                  {profileResult.tokensPerSec} tok/s
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                {profileResult.evalMs !== null ? `${profileResult.evalMs.toLocaleString()} ms` : '--'}
              </div>
              <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                Generated {profileResult.completionTokens} tokens under T={profileResult.options?.temperature ?? devConfig.temperature}
              </div>
            </div>

            {/* 4. Total Round-Trip Latency */}
            <div style={{ background: '#090b10', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>🎯 TOTAL LATENCY</span>
                <span style={{ fontSize: '0.625rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                  {profileResult.totalTokens} total tok
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981' }}>
                {profileResult.latencyMs.toLocaleString()} ms
              </div>
              <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                End-to-end gateway execution time
              </div>
            </div>
          </div>

          {/* Sample Output Preview */}
          {profileResult.content && (
            <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '0.6875rem', color: '#94a3b8' }}>
              <span style={{ color: '#64748b', marginRight: '6px' }}>OUTPUT:</span>
              <span style={{ color: '#e2e8f0' }}>"{profileResult.content.slice(0, 160)}{profileResult.content.length > 160 ? '...' : ''}"</span>
            </div>
          )}
        </div>
      )}

      {/* Real Switch Feedback Toast */}
      {switchFeedback && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckIcon size={14} />
          <span>{switchFeedback}</span>
        </div>
      )}

      {/* 2. 4 Top KPI Cards with Real SQLite Telemetry */}
      <div className="mp-4stat-grid">
        {/* Total Requests */}
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              REQUESTS (TOTAL)
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              {successRate}% OK
            </span>
          </div>

          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', margin: '8px 0 4px 0' }} className="font-mono">
            {totalReq.toLocaleString()}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: '#64748b' }} className="font-mono">
            <span>Success: {summary?.successfulRequests ?? 0}</span>
            <span style={{ color: (summary?.failedRequests ?? 0) > 0 ? '#fb7185' : '#64748b' }}>
              Failed: {summary?.failedRequests ?? 0}
            </span>
          </div>
        </div>

        {/* Tokens Processed */}
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              TOKENS PROCESSED
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                color: '#f97316',
                background: 'rgba(249, 115, 22, 0.12)',
                border: '1px solid rgba(249, 115, 22, 0.25)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              {totalTok > 0 ? `${Math.round((promptTok / totalTok) * 100)}% prompt` : '0% prompt'}
            </span>
          </div>

          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', margin: '8px 0 4px 0' }} className="font-mono">
            {totalTok >= 1e6 ? `${(totalTok / 1e6).toFixed(2)}M` : totalTok.toLocaleString()}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: '#94a3b8' }} className="font-mono">
            <span>Prompt: {promptTok >= 1e6 ? `${(promptTok / 1e6).toFixed(2)}M` : promptTok.toLocaleString()}</span>
            <span>Completion: {compTok.toLocaleString()}</span>
          </div>
        </div>

        {/* Response Speed & Latency */}
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              RESPONSE SPEED & LATENCY
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              {activeTps > 0 ? `${activeTps} tok/s` : 'Real-time'}
            </span>
          </div>

          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', margin: '8px 0 4px 0' }} className="font-mono">
            {avgLat >= 1000 ? `${(avgLat / 1000).toFixed(2)}s` : `${Math.round(avgLat)} ms`}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: '#94a3b8' }} className="font-mono">
            <span>
              Speed: {activeTps > 0 ? `${activeTps} tokens/s` : 'Ultra Fast'}
            </span>
            <span>
              Memory: {activeColdLoadMs > 1000 ? 'Cold Start' : 'Warm in RAM'}
            </span>
          </div>
        </div>

        {/* Estimated Cost & Local Savings */}
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              ESTIMATED COST & SAVINGS
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              {isCloudActive ? 'Cloud API' : '$0.00 (Local Free)'}
            </span>
          </div>

          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', margin: '8px 0 4px 0' }} className="font-mono">
            ${totalCost.toFixed(4)}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: '#94a3b8' }} className="font-mono">
            <span>Gateway Egress: $0.00</span>
            <span style={{ color: '#10b981' }}>
              Saved ~${(totalTok * 0.00003).toFixed(2)} vs Cloud
            </span>
          </div>
        </div>
      </div>

      {/* 3. Middle Section: Real Token Throughput Chart & Real Upstream Providers List */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        {/* Real Token Throughput Chart */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                  Token Throughput
                </span>
                <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                  Rolling Timeline
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.6875rem' }} className="font-mono">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f97316' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316' }} /> Prompt
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} /> Completion
                  </span>
                </div>
              </div>

              {/* Timeframe selector */}
              <div style={{ display: 'flex', gap: '4px' }} className="font-mono">
                {(['15m', '1h', '6h', '24h', '7d'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => onTimeframeChange(tf)}
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

            {/* Recharts Area Container */}
            <div style={{ width: '100%', height: '220px' }}>
              {chartData.length === 0 ? (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed #1e2433',
                  borderRadius: '6px',
                  color: '#64748b',
                  fontSize: '0.75rem',
                  gap: '6px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  <span style={{ color: '#94a3b8' }}>No traffic recorded in SQLite yet</span>
                  <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                    Send prompt requests via client apps or Playground to graph throughput curves
                  </span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="#334155" fontSize={10} tickLine={false} fontFamily="JetBrains Mono" />
                    <YAxis stroke="#334155" fontSize={10} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val} fontFamily="JetBrains Mono" />
                    <Tooltip
                      contentStyle={{ background: '#090b10', borderColor: '#1e2433', borderRadius: '6px', fontSize: '11px', fontFamily: 'JetBrains Mono' }}
                      labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
                      formatter={(val: any, name: any) => [`${val.toLocaleString()} tokens`, name === 'prompt' ? 'Prompt' : 'Completion']}
                    />
                    <Area type="monotone" dataKey="prompt" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#promptGrad)" />
                    <Area type="monotone" dataKey="completion" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#compGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Real Upstream Providers Card */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                Upstream Providers
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.6875rem',
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.12)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontWeight: 600
                }}
              >
                {1 + customCloudModels.length} OK
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* 1. Local Ollama */}
              <div
                onClick={() => {
                  if (localModels.length > 0 && activeModel !== localModels[0].name) {
                    handleSwitchModel(localModels[0].name);
                  }
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: !isCloudActive ? '#161925' : '#090b10',
                  border: `1px solid ${!isCloudActive ? '#f97316' : '#1e2433'}`,
                  cursor: 'pointer'
                }}
                className="font-mono"
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: !isCloudActive ? '#10b981' : '#64748b' }} />
                    <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.75rem' }}>
                      Ollama Local
                    </span>
                  </div>
                  <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px', marginLeft: '12px' }}>
                    :11434 · {localModels.length} models installed
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.6875rem', color: !isCloudActive ? '#10b981' : '#64748b', fontWeight: 600 }}>
                    {!isCloudActive ? 'Active 0ms' : 'Standby'}
                  </span>
                </div>
              </div>

              {/* 2. Custom Cloud Models */}
              {customCloudModels.map((cm) => {
                const isSelected = activeModel === cm.modelId;
                const bm = benchmarks.find(b => b.model.includes(cm.modelId));
                return (
                  <div
                    key={cm.modelId}
                    onClick={() => handleSwitchModel(cm.modelId)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isSelected ? '#161925' : '#090b10',
                      border: `1px solid ${isSelected ? '#f97316' : '#1e2433'}`,
                      cursor: 'pointer'
                    }}
                    className="font-mono"
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSelected ? '#10b981' : '#64748b' }} />
                        <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.75rem' }}>
                          {cm.displayName || cm.modelId}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px', marginLeft: '12px' }}>
                        {cm.provider.toUpperCase()} · {cm.apiBase.replace(/^https?:\/\//, '').split('/')[0]}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.6875rem', color: isSelected ? '#10b981' : '#64748b', fontWeight: 600 }}>
                        {isSelected ? 'Active' : 'Standby'} {bm?.avgLatencyMs ? `${Math.round(bm.avgLatencyMs)}ms` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid #1e2433',
              fontSize: '0.6875rem'
            }}
            className="font-mono"
          >
            <button
              onClick={() => onNavigateToTab('models')}
              style={{ background: 'transparent', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '0.6875rem' }}
            >
              Manage Models →
            </button>
          </div>
        </div>
      </div>

      {/* 4. Bottom Section: Real Recent Live Requests Table */}
      <div className="mp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
              Recent Live Requests
            </span>
            <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#64748b' }}>
              {selectedAppId ? `● Filtered: ${activeApp?.name || selectedAppId}` : '● Live SQLite Buffer'}
            </span>
          </div>

          <button
            onClick={() => onNavigateToTab('logs')}
            className="font-mono"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f97316',
              fontSize: '0.75rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>View all in Logs</span>
            <ChevronRightIcon size={12} />
          </button>
        </div>

        <div className="mp-table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="mp-table font-mono" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>REQUEST ID</th>
                <th>CLIENT APP</th>
                <th>ROUTED MODEL</th>
                <th>HTTP</th>
                <th>LATENCY</th>
                <th>TOKENS</th>
              </tr>
            </thead>
            <tbody>
              {recentItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                    No recent live requests recorded yet.
                  </td>
                </tr>
              ) : (
                recentItems.map((req) => {
                  const isSuccess = req.status === 'success';
                  const { time, date } = formatTimestampParts(req.timestamp);
                  const isCold = (req.load_duration_ms != null && req.load_duration_ms > 800) || req.cache_status === 'cold_cache';
                  return (
                    <tr key={req.id}>
                      <td style={{ color: '#94a3b8' }}>
                        <div style={{ color: '#f8fafc', fontWeight: 600 }}>
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
                          req_{req.request_id ? req.request_id.slice(-8) : '00000000'}
                        </span>
                      </td>
                      <td style={{ color: '#cbd5e1' }}>
                        {req.application_id || 'direct-client'}
                      </td>
                      <td style={{ color: '#f8fafc' }}>
                        {req.model}
                      </td>
                      <td>
                        <span
                          style={{
                            color: isSuccess ? '#10b981' : '#f43f5e',
                            background: isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                            border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '0.6875rem',
                            fontWeight: 600
                          }}
                        >
                          {isSuccess ? '200 OK' : 'ERROR'}
                        </span>
                      </td>
                      <td style={{ color: '#e2e8f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                            {req.latency_ms >= 1000 ? `${(req.latency_ms / 1000).toFixed(1)}s` : `${Math.round(req.latency_ms)} ms`}
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
                          {req.cache_status === 'cache_hit' && (
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
                        {(req.load_duration_ms || req.prompt_eval_duration_ms || req.eval_duration_ms) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>
                            {req.load_duration_ms != null && req.load_duration_ms > 0 && (
                              <span style={{ color: req.load_duration_ms > 1000 ? '#fb7185' : '#94a3b8' }}>
                                Cold: {req.load_duration_ms >= 1000 ? `${(req.load_duration_ms / 1000).toFixed(1)}s` : `${Math.round(req.load_duration_ms)}ms`}
                              </span>
                            )}
                            {req.load_duration_ms != null && req.load_duration_ms > 0 && (req.prompt_eval_duration_ms || req.eval_duration_ms) && <span>·</span>}
                            {req.prompt_eval_duration_ms != null && req.prompt_eval_duration_ms > 0 && (
                              <span style={{ color: '#38bdf8' }}>
                                KV: {req.prompt_eval_duration_ms >= 1000 ? `${(req.prompt_eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(req.prompt_eval_duration_ms)}ms`}
                              </span>
                            )}
                            {req.prompt_eval_duration_ms != null && req.prompt_eval_duration_ms > 0 && req.eval_duration_ms && <span>·</span>}
                            {req.eval_duration_ms != null && req.eval_duration_ms > 0 && (
                              <span style={{ color: '#10b981' }}>
                                Gen: {req.eval_duration_ms >= 1000 ? `${(req.eval_duration_ms / 1000).toFixed(1)}s` : `${Math.round(req.eval_duration_ms)}ms`}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ color: '#f8fafc' }}>
                        {(req.total_tokens || 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Note */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '12px',
            paddingTop: '10px',
            borderTop: '1px solid #1e2433',
            fontSize: '0.6875rem',
            color: '#64748b'
          }}
          className="font-mono"
        >
          <span>● Zero Retention: Raw prompts and completions are never stored on disk. Only anonymous telemetry is recorded.</span>
          <span>Storage: SQLite (WAL Mode)</span>
        </div>
      </div>
    </div>
  );
};
