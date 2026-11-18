import React from 'react';
import {
  LogoPulseIcon,
  OverviewIcon,
  PlaygroundIcon,
  ModelsIcon,
  ApplicationsIcon,
  LogsIcon,
  CostsIcon,
  FailoverIcon,
  ChevronDownIcon,
  ShieldCheckIcon
} from './icons/Icons';
import type { ApplicationItem } from '../types/analytics';

export type NavTab = 'overview' | 'playground' | 'models' | 'apps' | 'logs' | 'costs' | 'failover';

interface AppSidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  applications?: ApplicationItem[];
  selectedAppId?: string | null;
  onSelectAppId?: (appId: string | null) => void;
  appsCount?: number;
  activeModel?: string;
  gatewayPort?: number;
  gatewayOnline?: boolean | null;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentTab,
  onTabChange,
  applications = [],
  selectedAppId = null,
  onSelectAppId,
  appsCount = 0,
  activeModel = 'qwen2.5:3b',
  gatewayPort = 4101,
  gatewayOnline = null
}) => {
  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: string | number }> = [
    { id: 'overview', label: 'Overview', icon: <OverviewIcon size={15} /> },
    { id: 'apps', label: 'Applications', icon: <ApplicationsIcon size={15} />, badge: appsCount > 0 ? appsCount : undefined },
    { id: 'models', label: 'Models', icon: <ModelsIcon size={15} /> },
    { id: 'logs', label: 'Request Logs', icon: <LogsIcon size={15} /> },
    { id: 'costs', label: 'Costs & Alerts', icon: <CostsIcon size={15} /> },
    { id: 'failover', label: 'Failover', icon: <FailoverIcon size={15} /> },
    { id: 'playground', label: 'Playground', icon: <PlaygroundIcon size={15} /> }
  ];

  return (
    <aside className="mp-sidebar">
      {/* 1. Brand Header */}
      <div className="mp-sidebar-brand">
        <LogoPulseIcon size={20} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--mp-text-primary)', letterSpacing: '0.04em' }}>
            SLIR
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: '0.625rem',
              background: 'var(--mp-hover-bg)',
              color: 'var(--mp-green)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 600
            }}
            title="Switch LLM In Runtime"
          >
            SWITCH RUNTIME
          </span>
        </div>
      </div>

      {/* 2. Analytics scope */}
      <div className="mp-scope-switcher">
        <div className="mp-scope-label">Analytics scope</div>
        <div className="mp-select-wrap">
          <select
            className="mp-scope-select"
            value={selectedAppId ?? 'all'}
            onChange={(e) => onSelectAppId?.(e.target.value === 'all' ? null : e.target.value)}
            aria-label="Analytics scope"
          >
            <option value="all">All applications</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>{app.name}</option>
            ))}
          </select>
          <ChevronDownIcon size={12} className="mp-select-chevron" />
        </div>
        <div className="mp-scope-hint">
          {selectedAppId
            ? 'Metrics and logs are filtered to this application.'
            : 'Showing aggregate metrics across every application.'}
        </div>
      </div>

      {/* 3. Nav Items List */}
      <nav className="mp-sidebar-nav">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`mp-sidebar-item ${isActive ? 'active' : ''}`}
            >
              <span className="mp-sidebar-icon" style={{ opacity: isActive ? 1 : 0.7 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1, textAlign: 'left', fontWeight: isActive ? 600 : 500, fontSize: '0.8125rem' }}>
                {item.label}
              </span>
              {item.badge !== undefined && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    background: isActive ? 'var(--mp-orange)' : 'var(--mp-hover-bg)',
                    color: isActive ? '#0b0d13' : 'var(--mp-text-secondary)',
                    padding: '1px 5px',
                    borderRadius: '8px'
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 4. Bottom System Strip */}
      <div className="mp-sidebar-footer">
        <div className="mp-sidebar-target">
          <span className="mp-sidebar-target-label">Global fallback</span>
          <span className="mp-sidebar-target-value font-mono" title={activeModel}>{activeModel}</span>
        </div>
        <div className="mp-sidebar-meta font-mono">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              className="mp-pulse-dot"
              style={{
                width: '6px',
                height: '6px',
                background: gatewayOnline === false ? '#f43f5e' : gatewayOnline === null ? '#f59e0b' : '#10b981'
              }}
            />
            Gateway :{gatewayPort} {gatewayOnline === false ? 'offline' : gatewayOnline === null ? 'checking' : 'live'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--mp-text-secondary)' }}>
            <ShieldCheckIcon size={12} />
            Prompts not retained
          </span>
        </div>
      </div>
    </aside>
  );
};
