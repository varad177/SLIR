import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
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
  fetchInstalledModels,
  fetchAlerts
} from './api/client';
import { AppSidebar, NavTab } from './components/AppSidebar';
import { OverviewView } from './components/OverviewView';
import { CommandPalette } from './components/CommandPalette';
import { ResetDbModal } from './components/ResetDbModal';

const ApplicationsView = lazy(() => import('./components/ApplicationsView').then((m) => ({ default: m.ApplicationsView })));
const PlaygroundView = lazy(() => import('./components/PlaygroundView').then((m) => ({ default: m.PlaygroundView })));
const RequestLogsView = lazy(() => import('./components/RequestLogsView').then((m) => ({ default: m.RequestLogsView })));
const ModelsHubView = lazy(() => import('./components/ModelsHubView').then((m) => ({ default: m.ModelsHubView })));
const CostsBudgetsView = lazy(() => import('./components/CostsBudgetsView').then((m) => ({ default: m.CostsBudgetsView })));
const FailoverView = lazy(() => import('./components/FailoverView').then((m) => ({ default: m.FailoverView })));
const HelpView = lazy(() => import('./components/HelpView').then((m) => ({ default: m.HelpView })));
import { CopyIcon, CheckIcon, CloseIcon, BellIcon, SunIcon, MoonIcon } from './components/icons/Icons';
import { InfoTip } from './components/InfoTip';
import { useTheme } from './design-system/ThemeProvider';
import { DEFAULT_GATEWAY_PORT, fetchGatewayConfig, getBrowserGatewayBaseUrl } from './utils/gatewayConnection';
import { copyText } from './utils/clipboard';

export type OverviewTimeframe = '15m' | '1h' | '6h' | '24h' | '7d' | 'all';

const OVERVIEW_TIMEFRAME_MS: Record<OverviewTimeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'all': 0
};

export const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');
  const [summary, setSummary] = useState<SummaryKpis | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [requests, setRequests] = useState<RequestsResponse | null>(null);
  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [installedModels, setInstalledModels] = useState<string[]>(['active-model', 'qwen2.5:1.5b', 'qwen2.5:3b']);
  const [activeModel, setActiveModel] = useState<string>('qwen2.5:3b');
  const [page, setPage] = useState<number>(1);
  const [selectedAppId, setSelectedAppId] = useState<string | null | undefined>(undefined);
  const [benchmarkRefresh, setBenchmarkRefresh] = useState<number>(0);
  const [overviewTimeframe, setOverviewTimeframe] = useState<OverviewTimeframe>('24h');
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [commandOpen, setCommandOpen] = useState<boolean>(false);
  const [resetNotification, setResetNotification] = useState<string | null>(null);
  const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [gatewayPort, setGatewayPort] = useState<number>(DEFAULT_GATEWAY_PORT);
  const [unacknowledgedAlerts, setUnacknowledgedAlerts] = useState<number>(0);
  const [logsLaunchTarget, setLogsLaunchTarget] = useState<{
    failover?: 'all' | 'only' | 'used' | 'failed' | 'none';
    search?: string;
    nonce: number;
  } | null>(null);

  const inspectLogs = useCallback((options: {
    appId?: string | null;
    failover?: 'all' | 'only' | 'used' | 'failed' | 'none';
    search?: string;
  }) => {
    if (options.appId !== undefined) {
      setSelectedAppId(options.appId);
    }
    setLogsLaunchTarget({
      failover: options.failover ?? 'all',
      search: options.search ?? '',
      nonce: Date.now()
    });
    setCurrentTab('logs');
  }, []);

  const refreshAlertCount = useCallback(async () => {
    try {
      const data = await fetchAlerts({ unacknowledged: true, limit: 1 });
      setUnacknowledgedAlerts(data.unacknowledged || 0);
    } catch {
      // Gateway may be starting up; the bell simply stays at its last value.
    }
  }, []);

  useEffect(() => {
    refreshAlertCount();
    const interval = setInterval(refreshAlertCount, 30 * 1000);
    return () => clearInterval(interval);
  }, [refreshAlertCount]);

  useEffect(() => {
    let gPressed = false;
    let gTimer: number | undefined;
    const shortcuts: Record<string, NavTab> = {
      o: 'overview',
      a: 'apps',
      l: 'logs',
      m: 'models',
      c: 'costs',
      f: 'failover',
      p: 'playground',
      h: 'help'
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '?') {
        event.preventDefault();
        setCurrentTab('help');
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'g') {
        gPressed = true;
        window.clearTimeout(gTimer);
        gTimer = window.setTimeout(() => { gPressed = false; }, 1200);
        return;
      }
      if (gPressed && shortcuts[key]) {
        event.preventDefault();
        setCurrentTab(shortcuts[key]);
        gPressed = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(gTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (mounted) setGatewayOnline(res.ok);
      } catch {
        if (mounted) setGatewayOnline(false);
      }
    };
    const loadGatewayConfig = async () => {
      const config = await fetchGatewayConfig();
      if (mounted) setGatewayPort(config.gatewayPort);
    };
    checkHealth();
    loadGatewayConfig();
    const interval = setInterval(checkHealth, 15000);
    const configInterval = setInterval(loadGatewayConfig, 30 * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
      clearInterval(configInterval);
    };
  }, []);

  // Load telemetry data from backend
  const loadDashboardData = useCallback(async () => {
    const isAllTime = overviewTimeframe === 'all';
    const timeframeStart = isAllTime
      ? undefined
      : new Date(Date.now() - OVERVIEW_TIMEFRAME_MS[overviewTimeframe]).toISOString();
    const timeframeInterval = isAllTime
      ? 'month'
      : overviewTimeframe === '7d'
        ? 'day'
        : overviewTimeframe === '15m'
          ? 'minute'
          : overviewTimeframe === '1h'
            ? '5m'
            : 'hour';
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

  // Default the workspace to the first application once apps are known, but
  // preserve an explicit "All applications" choice (selectedAppId === null).
  useEffect(() => {
    if (applications.length === 0) return;
    if (selectedAppId === undefined) {
      setSelectedAppId(applications[0].id);
      return;
    }
    if (typeof selectedAppId === 'string' && !applications.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(applications[0].id);
    }
  }, [applications, selectedAppId]);

  const handleBenchmarkComplete = () => {
    setBenchmarkRefresh(prev => prev + 1);
    loadDashboardData();
  };

  const copyConfigSnippet = async () => {
    const app = applications.find((candidate) => candidate.id === selectedAppId) || applications[0];
    const apiKey = app?.apiKey || '<your-application-key>';
    const config = `Base URL: ${getBrowserGatewayBaseUrl(gatewayPort)}\nModel: active-model\nAuthorization: Bearer ${apiKey}`;
    if (await copyText(config)) {
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    }
  };

  const routingAppId = selectedAppId === null
    ? (applications[0]?.id ?? null)
    : (selectedAppId ?? applications[0]?.id ?? null);
  const scopedApp = applications.find((app) => app.id === (selectedAppId ?? routingAppId));

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
      case 'overview': return 'Overview';
      case 'playground': return 'Playground';
      case 'models': return 'Models & Providers';
      case 'apps': return 'Applications & API Clients';
      case 'logs': return 'Request Logs';
      case 'costs': return 'Costs & Alerts';
      case 'failover': return 'Automatic Failover';
      case 'help': return 'User Manual';
      default: return 'Gateway';
    }
  };

  return (
    <div className="mp-layout">
      {/* 1. Left Sidebar Navigation */}
      <AppSidebar
        currentTab={currentTab}
        onTabChange={(tab) => {
          if (tab !== 'logs') setLogsLaunchTarget(null);
          setCurrentTab(tab);
        }}
        applications={applications}
        selectedAppId={selectedAppId ?? null}
        onSelectAppId={setSelectedAppId}
        appsCount={applications.length}
        activeModel={activeModel}
        gatewayPort={gatewayPort}
        gatewayOnline={gatewayOnline}
      />

      {/* 2. Main Content Area */}
      <div className="mp-main-content">
        {(!browserOnline || gatewayOnline === false) && (
          <div className="mp-connection-banner" role="status">
            <span className="mp-pulse-dot" />
            <span>
              {!browserOnline
                ? 'You are offline. Dashboard data may be stale.'
                : 'SLIR gateway is unreachable. Check that the backend is running and the gateway port is mapped.'}
            </span>
          </div>
        )}
        {/* Top Navbar */}
        <header className="mp-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--mp-text-muted)', fontSize: '0.8125rem' }}>SLIR</span>
            <span style={{ color: 'var(--mp-border-strong)', fontSize: '0.8125rem' }}>/</span>
            <span style={{ color: 'var(--mp-text-secondary)', fontWeight: 600, fontSize: '0.8125rem' }}>
              {getBreadcrumbTitle()}
            </span>

            {/* Active Model Breadcrumb Pill */}
            <InfoTip
              title="Global fallback model"
              text="The shared default model used by any app set to 'Follow global' (model: 'active-model'). Apps pinned to their own model ignore this setting."
              example="Switch this anytime on the Models tab"
            >
              <div
                className="font-mono"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--mp-hover-bg)',
                  border: '1px solid var(--mp-border)',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  fontSize: '0.6875rem',
                  color: 'var(--mp-text-primary)',
                  marginLeft: '4px'
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-orange)' }} />
                <span style={{ color: 'var(--mp-text-secondary)' }}>Global:</span>
                <strong style={{ color: 'var(--mp-text-primary)' }}>{activeModel.length > 24 ? `${activeModel.slice(0, 22)}...` : activeModel}</strong>
              </div>
            </InfoTip>

            <InfoTip
              title="Dashboard analytics scope"
              text="Shows which application's telemetry you are currently filtering by in the sidebar. Choose 'All applications' to see combined metrics."
            >
              <div
                className="font-mono"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--mp-hover-bg-subtle)',
                  border: '1px solid var(--mp-border)',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  fontSize: '0.6875rem',
                  color: 'var(--mp-text-secondary)',
                  marginLeft: '2px'
                }}
              >
                {selectedAppId === null ? 'All applications' : (scopedApp?.name || 'Select application')}
              </div>
            </InfoTip>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} className="font-mono">
            {/* Alert Bell */}
            <button
              onClick={() => setCurrentTab('costs')}
              className="mp-btn-ghost"
              style={{ position: 'relative', padding: '5px 7px' }}
              title={unacknowledgedAlerts > 0 ? `${unacknowledgedAlerts} unacknowledged budget alert(s)` : 'No unacknowledged alerts'}
              aria-label="Budget alerts"
            >
              <BellIcon size={14} />
              {unacknowledgedAlerts > 0 && (
                <span
                  className="font-mono"
                  style={{
                    position: 'absolute',
                    top: '-5px',
                    right: '-5px',
                    minWidth: '15px',
                    height: '15px',
                    padding: '0 3px',
                    borderRadius: '999px',
                    background: '#f43f5e',
                    color: '#ffffff',
                    fontSize: '0.5625rem',
                    fontWeight: 700,
                    display: 'grid',
                    placeItems: 'center',
                    lineHeight: 1
                  }}
                >
                  {unacknowledgedAlerts > 99 ? '99+' : unacknowledgedAlerts}
                </span>
              )}
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="mp-btn-ghost"
              style={{ padding: '5px 7px' }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            </button>

            {/* Live Status Indicator */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.6875rem',
                color: gatewayOnline === false ? '#f43f5e' : gatewayOnline === null ? '#f59e0b' : '#10b981',
                fontWeight: 600,
                letterSpacing: '0.02em'
              }}
            >
              <span
                className="mp-pulse-dot"
                style={{
                  width: '6px',
                  height: '6px',
                  background: gatewayOnline === false ? '#f43f5e' : gatewayOnline === null ? '#f59e0b' : '#10b981'
                }}
              />
              {gatewayOnline === false ? 'GATEWAY OFFLINE' : gatewayOnline === null ? 'GATEWAY CHECKING' : 'GATEWAY LIVE'}
            </div>

            {/* Copy Config */}
            <button
              onClick={copyConfigSnippet}
              className="mp-btn-ghost font-mono"
              style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              {copiedConfig ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              <span>{copiedConfig ? 'Copied' : 'Copy API config'}</span>
            </button>

            {/* Reset Database Trigger */}
            <button
              onClick={handleOpenResetModal}
              className="mp-btn-ghost font-mono"
              style={{ fontSize: '0.75rem', padding: '4px 10px', color: 'var(--mp-text-secondary)' }}
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
              background: 'var(--mp-green-soft)',
              borderBottom: '1px solid var(--mp-green-line)',
              color: 'var(--mp-green)',
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
              style={{ background: 'transparent', border: 'none', color: 'var(--mp-green)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
              aria-label="Dismiss notification"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {/* Page Body View Router */}
        <main className="mp-page-body">
          <Suspense fallback={<div className="mp-empty compact"><strong>Loading view...</strong></div>}>
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
                selectedAppId={routingAppId}
                allAppsScope={selectedAppId === null}
                onSelectAppId={(appId) => setSelectedAppId(appId)}
                activeTimeframe={overviewTimeframe}
                onTimeframeChange={setOverviewTimeframe}
                onInspectRequest={(requestId) => inspectLogs({ failover: 'only', search: requestId })}
                gatewayPort={gatewayPort}
              />
            )}

            {currentTab === 'playground' && (
              <PlaygroundView
                installedModels={installedModels}
                applications={applications}
                activeModel={activeModel}
                gatewayPort={gatewayPort}
                onBenchmarkComplete={handleBenchmarkComplete}
              />
            )}

            {currentTab === 'models' && (
              <ModelsHubView
                onModelSwitched={handleBenchmarkComplete}
                refreshTrigger={benchmarkRefresh}
                applications={applications}
              />
            )}

            {currentTab === 'apps' && (
              <ApplicationsView
                applications={applications}
                onApplicationsChange={loadDashboardData}
                installedModels={installedModels}
                onSelectAppForPlayground={() => setCurrentTab('playground')}
                onInspectAppLogs={(appId) => {
                  setSelectedAppId(appId);
                  setCurrentTab('logs');
                }}
              />
            )}

            {currentTab === 'logs' && (
              <RequestLogsView
                applications={applications}
                installedModels={installedModels}
                initialAppId={selectedAppId ?? null}
                initialFailoverFilter={logsLaunchTarget?.failover}
                initialSearch={logsLaunchTarget?.search}
                initialFocusNonce={logsLaunchTarget?.nonce}
                onClearDatabase={handleOpenResetModal}
                onReplayInPlayground={() => setCurrentTab('playground')}
              />
            )}

            {currentTab === 'costs' && (
              <CostsBudgetsView
                applications={applications}
                onAlertsChanged={refreshAlertCount}
              />
            )}

            {currentTab === 'failover' && (
              <FailoverView
                applications={applications}
                selectedAppId={routingAppId}
                onSelectAppId={setSelectedAppId}
                onApplicationsChanged={loadDashboardData}
                onInspectLogs={(opts) => inspectLogs(opts)}
              />
            )}

            {currentTab === 'help' && (
              <HelpView
                applications={applications}
                selectedAppId={selectedAppId ?? null}
                activeModel={activeModel}
                gatewayPort={gatewayPort}
                onNavigateToTab={setCurrentTab}
              />
            )}
          </Suspense>
        </main>
      </div>

      <CommandPalette
        open={commandOpen}
        applications={applications}
        onClose={() => setCommandOpen(false)}
        onNavigate={setCurrentTab}
        onSelectApp={setSelectedAppId}
      />

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
