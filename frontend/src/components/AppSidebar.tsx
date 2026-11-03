import React from 'react';
import {
  LogoPulseIcon,
  OverviewIcon,
  PlaygroundIcon,
  ModelsIcon,
  ApplicationsIcon,
  LogsIcon,
  SlidersIcon
} from './icons/Icons';

export type NavTab = 'overview' | 'playground' | 'models' | 'apps' | 'logs';

interface AppSidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  appsCount?: number;
  activeModel?: string;
  gatewayPort?: number;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentTab,
  onTabChange,
  appsCount = 0,
  activeModel = 'qwen2.5:3b',
  gatewayPort = 4101
}) => {
  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: string | number }> = [
    { id: 'overview', label: 'Overview', icon: <OverviewIcon size={15} /> },
    { id: 'apps', label: 'Applications', icon: <ApplicationsIcon size={15} />, badge: appsCount > 0 ? appsCount : undefined },
    { id: 'models', label: 'Models', icon: <ModelsIcon size={15} /> },
    { id: 'logs', label: 'Request Logs', icon: <LogsIcon size={15} /> },
    { id: 'playground', label: 'Playground', icon: <PlaygroundIcon size={15} /> }
  ];

  return (
    <aside className="mp-sidebar">
      {/* 1. Brand Header */}
      <div className="mp-sidebar-brand">
        <LogoPulseIcon size={20} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#f8fafc', letterSpacing: '0.04em' }}>
            SLIR
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: '0.625rem',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#34d399',
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

      {/* 2. Nav Items List */}
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
                    background: isActive ? '#f97316' : 'rgba(255, 255, 255, 0.08)',
                    color: isActive ? '#0b0d13' : '#cbd5e1',
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

      {/* 3. Bottom System Strip */}
      <div className="mp-sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span
            className="font-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.6875rem',
              color: '#10b981',
              fontWeight: 600
            }}
          >
            <span className="mp-pulse-dot" style={{ width: '6px', height: '6px', background: '#10b981' }} />
            Port :{gatewayPort}
          </span>
          <span className="font-mono" style={{ fontSize: '0.625rem', color: '#10b981' }}>
            Ready
          </span>
        </div>

        <div
          className="font-mono"
          style={{
            fontSize: '0.625rem',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span>🔒 Zero Retention (Prompts Purged)</span>
        </div>
      </div>
    </aside>
  );
};
