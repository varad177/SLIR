import React, { useState, useEffect, useCallback } from 'react';
import { 
  SummaryKpis, 
  TimeSeriesPoint, 
  RequestsResponse,
  ApplicationItem
} from './types/analytics';
import { 
  fetchSummary, 
  fetchTimeSeries, 
  fetchRequests,
  fetchApplications,
  fetchInstalledModels
} from './api/client';
import { AppSidebar, NavTab } from './components/AppSidebar';
import { OverviewView } from './components/OverviewView';
import { ApplicationsView } from './components/ApplicationsView';
import { PlaygroundView } from './components/PlaygroundView';
import { RequestLogsView } from './components/RequestLogsView';
import { ModelsHubView } from './components/ModelsHubView';
import { ResetDbModal } from './components/ResetDbModal';
import { CopyIcon, CheckIcon, RotateCwIcon } from './components/icons/Icons';

export type OverviewTimeframe = '15m' | '1h' | '6h' | '24h' | '7d';

const OVERVIEW_TIMEFRAME_MS: Record<OverviewTimeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');
  const [summary, setSummary] = useState<SummaryKpis | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [requests, setRequests] = useState<RequestsResponse | null>(null);
  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [installedModels, setInstalledModels] = useState<string[]>(['active-model', 'qwen2.5:1.5b', 'qwen2.5:3b']);
  const [activeModel, setActiveModel] = useState<string>('qwen2.5:3b');
  const [page, setPage] = useState<number>(1);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [benchmarkRefresh, setBenchmarkRefresh] = useState<number>(0);
  const [overviewTimeframe, setOverviewTimeframe] = useState<OverviewTimeframe>('24h');
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [resetNotification, setResetNotification] = useState<string | null>(null);

  // Load telemetry data from backend
  const loadDashboardData = useCallback(async () => {
    const timeframeStart = new Date(
      Date.now() - OVERVIEW_TIMEFRAME_MS[overviewTimeframe]
    ).toISOString();
    const timeframeInterval = overviewTimeframe === '7d' ? 'day' : 'hour';
    try {
      const [sumData, tsData, reqData, appsData, modelsData] = await Promise.all([
        fetchSummary({ interval: timeframeInterval, start: timeframeStart, appId: selectedAppId ?? undefined }).catch(() => null),
        fetchTimeSeries({ interval: timeframeInterval, start: timeframeStart, appId: selectedAppId ?? undefined }).catch(() => []),
        fetchRequests({ page, limit: 10, appId: selectedAppId ?? undefined }).catch(() => null),
        fetchApplications().catch(() => ({ applications: [] })),
        fetchInstalledModels().catch(() => null)
      ]);

      if (sumData) setSummary(sumData);
      if (tsData) setTimeSeries(tsData);
      if (reqData) setRequests(reqData);
      if (appsData?.applications) setApplications(appsData.applications);
      if (modelsData) {
        if (modelsData.activeModel) setActiveModel(modelsData.activeModel);
        const modelNames = ['active-model', ...(modelsData.models || []).map(m => m.name)];
        if (modelsData.customModels) {
          modelNames.push(...modelsData.customModels.map(c => c.modelId));
        }
        setInstalledModels(Array.from(new Set(modelNames)));
      }
    } catch (err: any) {
      console.error('Error fetching dashboard telemetry:', err);
    }
  }, [page, selectedAppId, overviewTimeframe]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleBenchmarkComplete = () => {
    setBenchmarkRefresh(prev => prev + 1);
    loadDashboardData();
  };

  const copyConfigSnippet = () => {
    const config = `// Connect SensorReportBot or any app to SLIR (Switch LLM In Runtime):\nBase URL: http://localhost:4101/v1\nModel: active-model\nAuth Header: Authorization: Bearer dev-secret-key`;
    navigator.clipboard.writeText(config);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const handleOpenResetModal = () => {
    setIsResetModalOpen(true);
  };

  const handleResetSuccess = async (result: {
    deletedEvents: number;
    deletedApps?: number;
    message: string;
    clearApps: boolean;
    reseedDefault: boolean;
  }) => {
    setSummary({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 100,
      errorRate: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      avgLatencyMs: 0,
      missingTokensCount: 0,
      costBreakdown: { confirmedCount: 0, estimatedCount: 0, unknownCount: 0 }
    });
    setTimeSeries([]);
    setRequests({
      items: [],
      pagination: { total: 0, page: 1, limit: 10, totalPages: 1 }
    });

    setBenchmarkRefresh(prev => prev + 1);
    setResetNotification(
      `${result.message} (${result.deletedEvents} requests cleared${result.clearApps ? `, ${result.deletedApps} apps wiped` : ''}).`
    );
    setTimeout(() => setResetNotification(null), 6000);
    await loadDashboardData();
  };

  const getBreadcrumbTitle = () => {
    switch (currentTab) {
      case 'overview': return 'Gateway';
      case 'playground': return 'Playground';
      case 'models': return 'Models & Providers';
      case 'apps': return 'Applications & API Clients';
      case 'logs': return 'Request Logs';
      default: return 'Gateway';
    }
  };

  return (
    <div className="mp-layout">
      {/* 1. Left Sidebar Navigation */}
      <AppSidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        appsCount={applications.length}
        activeModel={activeModel}
        gatewayPort={4101}
      />

      {/* 2. Main Content Area */}
      <div className="mp-main-content">
        {/* Top Navbar */}
        <header className="mp-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>SLIR</span>
            <span style={{ color: '#475569', fontSize: '0.8125rem' }}>/</span>
            <span style={{ color: '#cbd5e1', fontWeight: 600, fontSize: '0.8125rem' }}>
              {getBreadcrumbTitle()}
            </span>

            {/* Active Model Breadcrumb Pill */}
            <div
              className="font-mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e2433',
                padding: '2px 8px',
                borderRadius: '5px',
                fontSize: '0.6875rem',
                color: '#e2e8f0',
                marginLeft: '4px'
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316' }} />
              <span style={{ color: '#94a3b8' }}>Target:</span>
              <strong style={{ color: '#f8fafc' }}>{activeModel.length > 24 ? `${activeModel.slice(0, 22)}...` : activeModel}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} className="font-mono">
            {/* Live Status Indicator */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.6875rem',
                color: '#10b981',
                fontWeight: 600,
                letterSpacing: '0.02em'
              }}
            >
              <span className="mp-pulse-dot" style={{ width: '6px', height: '6px', background: '#10b981' }} />
              GATEWAY LIVE
            </div>

            {/* Copy Config */}
            <button
              onClick={copyConfigSnippet}
              className="mp-btn-ghost font-mono"
              style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              {copiedConfig ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              <span>{copiedConfig ? 'Copied' : 'Copy Config'}</span>
            </button>

            {/* Reset Database Trigger */}
            <button
              onClick={handleOpenResetModal}
              className="mp-btn-ghost font-mono"
              style={{ fontSize: '0.75rem', padding: '4px 10px', color: '#94a3b8' }}
              title="Database Reset & Gateway Settings"
            >
              <span>Reset DB</span>
            </button>
          </div>
        </header>

        {/* Global Notification Toast */}
        {resetNotification && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              borderBottom: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              padding: '8px 24px',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'JetBrains Mono, monospace'
            }}
          >
            <span>{resetNotification}</span>
            <button
              onClick={() => setResetNotification(null)}
              style={{ background: 'transparent', border: 'none', color: '#34d399', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Page Body View Router */}
        <main className="mp-page-body">
          {currentTab === 'overview' && (
            <OverviewView
              summary={summary}
              timeSeries={timeSeries}
              requests={requests}
              page={page}
              onPageChange={setPage}
              benchmarkRefresh={benchmarkRefresh}
              onModelSwitched={handleBenchmarkComplete}
              onNavigateToTab={setCurrentTab}
              onClearDatabase={handleOpenResetModal}
              activeModel={activeModel}
              applications={applications}
              selectedAppId={selectedAppId}
              onSelectAppId={setSelectedAppId}
              activeTimeframe={overviewTimeframe}
              onTimeframeChange={setOverviewTimeframe}
            />
          )}

          {currentTab === 'playground' && (
            <PlaygroundView
              installedModels={installedModels}
              applications={applications}
              activeModel={activeModel}
              onBenchmarkComplete={handleBenchmarkComplete}
            />
          )}

          {currentTab === 'models' && (
            <ModelsHubView
              onModelSwitched={handleBenchmarkComplete}
              refreshTrigger={benchmarkRefresh}
            />
          )}

          {currentTab === 'apps' && (
            <ApplicationsView
              applications={applications}
              onApplicationsChange={loadDashboardData}
              installedModels={installedModels}
              onSelectAppForPlayground={() => setCurrentTab('playground')}
            />
          )}

          {currentTab === 'logs' && (
            <RequestLogsView
              applications={applications}
              installedModels={installedModels}
              onClearDatabase={handleOpenResetModal}
              onReplayInPlayground={() => setCurrentTab('playground')}
            />
          )}
        </main>
      </div>

      {/* Global Reset Database Modal */}
      <ResetDbModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onResetSuccess={handleResetSuccess}
      />
    </div>
  );
};
export default App;
