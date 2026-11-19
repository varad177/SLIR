import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationItem } from '../types/analytics';
import type { NavTab } from './AppSidebar';

interface CommandPaletteProps {
  open: boolean;
  applications: ApplicationItem[];
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onSelectApp: (appId: string | null) => void;
}

interface CommandAction {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void;
}

const TAB_ACTIONS: Array<{ tab: NavTab; label: string; keywords: string }> = [
  { tab: 'overview', label: 'Go to Overview', keywords: 'dashboard analytics home latency chart' },
  { tab: 'apps', label: 'Go to Applications', keywords: 'api key create app client' },
  { tab: 'models', label: 'Go to Models', keywords: 'ollama cloud provider active model benchmark' },
  { tab: 'logs', label: 'Go to Request Logs', keywords: 'telemetry trace search export' },
  { tab: 'costs', label: 'Go to Costs and Alerts', keywords: 'budget spend webhook pricing' },
  { tab: 'failover', label: 'Go to Failover', keywords: 'fallback chain resilience' },
  { tab: 'playground', label: 'Go to Playground', keywords: 'test prompt compare models' },
  { tab: 'help', label: 'Open User Manual', keywords: 'help docs guide setup' }
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  applications,
  onClose,
  onNavigate,
  onSelectApp
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const actions = useMemo<CommandAction[]>(() => {
    const tabActions = TAB_ACTIONS.map((item) => ({
      id: `tab:${item.tab}`,
      label: item.label,
      hint: 'Navigate',
      keywords: `${item.label} ${item.tab} ${item.keywords}`,
      run: () => onNavigate(item.tab)
    }));
    const appActions = applications.map((app) => ({
      id: `app:${app.id}`,
      label: app.name,
      hint: `Select application · ${app.defaultModel}`,
      keywords: `${app.name} ${app.description || ''} ${app.id} ${app.defaultModel} application`,
      run: () => {
        onSelectApp(app.id);
        onNavigate('overview');
      }
    }));
    return [...tabActions, ...appActions];
  }, [applications, onNavigate, onSelectApp]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) => action.keywords.toLowerCase().includes(normalized));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const runAction = (action?: CommandAction) => {
    if (!action) return;
    action.run();
    onClose();
  };

  return (
    <div className="mp-command-backdrop" onMouseDown={onClose}>
      <div
        className="mp-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="mp-command-input"
          value={query}
          placeholder="Search tabs, applications, and actions..."
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runAction(filtered[activeIndex]);
            }
          }}
        />
        <div className="mp-command-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="mp-command-empty">No matching tabs or applications.</div>
          ) : filtered.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className="mp-command-item"
              data-active={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runAction(action)}
            >
              <span>
                <strong>{action.label}</strong>
                <small>{action.hint}</small>
              </span>
              <kbd>Enter</kbd>
            </button>
          ))}
        </div>
        <div className="mp-command-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="mp-command-shortcut">Ctrl/⌘ K</span>
        </div>
      </div>
    </div>
  );
};
