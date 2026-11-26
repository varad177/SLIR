import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApplicationItem,
  InstalledModelsResponse,
  UsageEventItem
} from '../types/analytics';
import { fetchInstalledModels, fetchRequests, updateApplication } from '../api/client';
import { failoverReasonLabel, parseFailoverTrace } from '../utils/failover';
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  FailoverIcon,
  RefreshCwIcon,
  TrashIcon,
  ZapIcon
} from './icons/Icons';
import { InfoTip } from './InfoTip';
import { FailoverTraceList } from './FailoverTraceList';

interface FailoverViewProps {
  applications: ApplicationItem[];
  selectedAppId?: string | null;
  onSelectAppId?: (appId: string | null) => void;
  onApplicationsChanged?: () => void;
  onInspectLogs?: (options: { appId?: string | null; failover?: 'only' | 'all'; search?: string }) => void;
}

const formatTime = (iso?: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', { hour12: false });
};

export const FailoverView: React.FC<FailoverViewProps> = ({
  applications,
  selectedAppId = null,
  onSelectAppId,
  onApplicationsChanged,
  onInspectLogs
}) => {
  const activeApp = applications.find((app) => app.id === selectedAppId) || applications[0] || null;
  const [modelsData, setModelsData] = useState<InstalledModelsResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [recentFailoverEvents, setRecentFailoverEvents] = useState<UsageEventItem[]>([]);
  const [failoverTotal, setFailoverTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const savedModels = activeApp?.fallbackModels || [];
  const savedEnabled = Boolean(activeApp?.failoverEnabled);
  const dirty = enabled !== savedEnabled || fallbackModels.join('\u0000') !== savedModels.join('\u0000');

  const availableModels = useMemo(() => {
    const values = new Set<string>();
    for (const model of modelsData?.models || []) {
      if (model.name) values.add(model.name);
    }
    for (const custom of modelsData?.customModels || []) {
      if (custom.modelId) values.add(custom.modelId);
    }
    for (const model of fallbackModels) values.delete(model);
    return Array.from(values).sort();
  }, [fallbackModels, modelsData]);

  const failoverEvents = recentFailoverEvents;

  const primaryLabel = activeApp?.defaultModel === 'active-model'
    ? 'Global active model'
    : activeApp?.defaultModel || 'Primary';

  const loadModels = useCallback(async () => {
    try {
      const data = await fetchInstalledModels();
      setModelsData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load available models.');
    }
  }, []);

  const loadRecentEvents = useCallback(async () => {
    if (!activeApp) {
      setRecentFailoverEvents([]);
      setFailoverTotal(0);
      return;
    }
    try {
      const data = await fetchRequests({ appId: activeApp.id, failover: 'only', limit: 25 });
      setRecentFailoverEvents(data.items || []);
      setFailoverTotal(data.pagination?.total ?? (data.items?.length || 0));
    } catch (err: any) {
      setError(err.message || 'Failed to load recent failover events.');
    }
  }, [activeApp]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([loadModels(), loadRecentEvents()]).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [loadModels, loadRecentEvents]);

  useEffect(() => {
    setEnabled(Boolean(activeApp?.failoverEnabled));
    setFallbackModels(activeApp?.fallbackModels ? [...activeApp.fallbackModels] : []);
    setSelectedModel('');
  }, [activeApp?.id, activeApp?.failoverEnabled, activeApp?.fallbackModels]);

  useEffect(() => {
    if (selectedModel && !availableModels.includes(selectedModel)) {
      setSelectedModel('');
    }
  }, [availableModels, selectedModel]);

  const handleSelectApp = (appId: string) => {
    setNotice(null);
    setError(null);
    onSelectAppId?.(appId || null);
  };

  const handleAdd = () => {
    if (!selectedModel || fallbackModels.includes(selectedModel)) return;
    if (fallbackModels.length >= 5) {
      setError('A maximum of five fallback models can be configured.');
      return;
    }
    setFallbackModels((current) => [...current, selectedModel]);
    setSelectedModel('');
    setError(null);
  };

  const moveModel = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fallbackModels.length) return;
    setFallbackModels((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!activeApp) return;
    try {
      setSaving(true);
      setError(null);
      const result = await updateApplication(activeApp.id, {
        failoverEnabled: enabled,
        fallbackModels
      });
      setNotice(
        enabled && fallbackModels.length > 0
          ? `Failover chain saved for ${activeApp.name}.`
          : `Automatic failover disabled for ${result.application?.name || activeApp.name}.`
      );
      onApplicationsChanged?.();
      await loadRecentEvents();
    } catch (err: any) {
      setError(err.message || 'Failed to save failover settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEnabled(Boolean(activeApp?.failoverEnabled));
    setFallbackModels(activeApp?.fallbackModels ? [...activeApp.fallbackModels] : []);
    setError(null);
    setNotice(null);
  };

  const handleRefresh = async () => {
    setError(null);
    setNotice(null);
    await Promise.all([loadModels(), loadRecentEvents()]);
  };

  if (!activeApp) {
    return (
      <div className="mp-failover-page">
        <div className="mp-empty">
          <strong>No applications yet</strong>
          <span>Create an application before configuring automatic failover.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-failover-page">
      <div className="mp-costs-header">
        <div>
          <div className="mp-eyebrow">Resilience</div>
          <h1 className="mp-page-title">Automatic Failover</h1>
          <p className="mp-page-subtitle">
            Give each application an ordered fallback chain. Rate limits, timeouts, network errors and provider 5xx
            responses switch to the next model without changing the client request.
          </p>
        </div>
        <div className="mp-costs-actions">
          <button className="mp-btn mp-btn-ghost" onClick={handleRefresh} disabled={loading}>
            <RefreshCwIcon size={13} />
            Refresh
          </button>
          <button className="mp-btn mp-btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            <CheckIcon size={13} />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mp-alert error">
          <AlertTriangleIcon size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {notice && (
        <div className="mp-alert success">
          <CheckIcon size={14} />
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="mp-costs-stats">
        <div className="mp-costs-stat">
          <span>Failover status</span>
          <strong style={{ color: enabled ? 'var(--mp-green)' : 'var(--mp-text-muted)' }}>
            {enabled ? 'Enabled' : 'Off'}
          </strong>
        </div>
        <div className="mp-costs-stat">
          <span>Fallback models</span>
          <strong>{fallbackModels.length}</strong>
        </div>
        <div className="mp-costs-stat">
          <span>Recorded failovers</span>
          <strong>{failoverTotal}</strong>
        </div>
        <div className="mp-costs-stat">
          <span className="mp-label-with-tip">
            <span>Primary route</span>
            <InfoTip
              title="Primary Route"
              text="The first model SLIR calls for this app (either the Global Fallback or its Pinned model). Fallbacks only run if this primary model fails with 429, 5xx, timeout, or network error."
            />
          </span>
          <strong className="mp-failover-primary">
            {activeApp.defaultModel === 'active-model' ? 'Global active model' : activeApp.defaultModel}
          </strong>
        </div>
      </div>

      <div className="mp-failover-grid">
        <section className="mp-card mp-failover-config">
          <div className="mp-failover-card-head">
            <div>
              <div className="mp-eyebrow">Application policy</div>
              <h2 className="mp-section-title mp-label-with-tip">
                <span>Failover chain</span>
                <InfoTip
                  title="Ordered Fallback Chain"
                  text="Up to 5 backup models tried top-to-bottom when the primary fails. Requests blocked by a hard budget cap (429) stop immediately, and fallback models exceeding a budget are skipped."
                />
              </h2>
            </div>
            <label className="mp-field mp-failover-app-field">
              <span className="mp-field-label">Application</span>
              <span className="mp-select-wrap">
                <select
                  className="mp-select"
                  value={activeApp.id}
                  onChange={(event) => handleSelectApp(event.target.value)}
                >
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>{app.name}</option>
                  ))}
                </select>
                <ChevronDownIcon size={12} className="mp-select-chevron" />
              </span>
            </label>
          </div>

          <label className="mp-failover-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>Enable automatic failover</strong>
              <small>When off, the fallback order is preserved but never used.</small>
            </span>
          </label>

          <div className={`mp-failover-route-preview ${enabled ? '' : 'disabled'}`}>
            <div className="mp-failover-route-step primary">
              <span>Primary</span>
              <strong>{primaryLabel}</strong>
            </div>
            {fallbackModels.map((model, index) => (
              <React.Fragment key={model}>
                <span className="mp-failover-route-arrow">→</span>
                <div className="mp-failover-route-step">
                  <span>Fallback {index + 1}</span>
                  <strong>{model}</strong>
                </div>
              </React.Fragment>
            ))}
            <span className="mp-failover-route-arrow">→</span>
            <div className="mp-failover-route-step terminal">
              <span>If all fail</span>
              <strong>Request fails</strong>
            </div>
          </div>

          <div className={`mp-failover-chain ${enabled ? '' : 'disabled'}`}>
            {fallbackModels.length === 0 ? (
              <div className="mp-empty compact">
                <strong>No fallback models configured</strong>
                <span>Add a model below. The primary model is already the first route.</span>
              </div>
            ) : (
              fallbackModels.map((model, index) => (
                <div className="mp-failover-row" key={model}>
                  <span className="mp-failover-index font-mono">{index + 1}</span>
                  <span className="mp-failover-model font-mono" title={model}>{model}</span>
                  <span className="mp-failover-row-actions">
                    <button
                      className="mp-icon-btn"
                      onClick={() => moveModel(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move ${model} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="mp-icon-btn"
                      onClick={() => moveModel(index, 1)}
                      disabled={index === fallbackModels.length - 1}
                      title="Move down"
                      aria-label={`Move ${model} down`}
                    >
                      ↓
                    </button>
                    <button
                      className="mp-icon-btn danger"
                      onClick={() => setFallbackModels((current) => current.filter((item) => item !== model))}
                      title="Remove fallback model"
                      aria-label={`Remove ${model}`}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mp-failover-add">
            <span className="mp-select-wrap">
              <select
                className="mp-select font-mono"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={availableModels.length === 0 || fallbackModels.length >= 5}
              >
                <option value="">
                  {availableModels.length === 0 ? 'No other models available' : 'Select a fallback model'}
                </option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <ChevronDownIcon size={12} className="mp-select-chevron" />
            </span>
            <button
              className="mp-btn mp-btn-secondary"
              onClick={handleAdd}
              disabled={!selectedModel || fallbackModels.length >= 5}
            >
              Add model
            </button>
          </div>

          <div className="mp-failover-actions">
            <span className="mp-failover-hint">
              Order matters: SLIR tries each model from top to bottom. Failed attempts are recorded in Request Logs.
            </span>
            <button className="mp-btn mp-btn-ghost" onClick={handleReset} disabled={!dirty || saving}>
              Discard
            </button>
          </div>

          <div className="mp-failover-notes">
            <div>
              <FailoverIcon size={13} />
              <span>Only requests authenticated with this application's API key use this chain.</span>
            </div>
            <div>
              <AlertTriangleIcon size={13} />
              <span>Streaming requests can only fail over before the first response chunk is sent.</span>
            </div>
            <div>
              <ZapIcon size={13} />
              <span>Fallback models must already be installed locally or configured as cloud endpoints.</span>
            </div>
          </div>
        </section>

        <section className="mp-card mp-failover-recent">
          <div className="mp-failover-card-head">
            <div>
              <div className="mp-eyebrow">Telemetry</div>
              <h2 className="mp-section-title">Failover attempt logs</h2>
            </div>
            <div className="mp-failover-event-actions">
              <span className="mp-badge-count">{failoverTotal}</span>
              {onInspectLogs && (
                <button
                  type="button"
                  className="mp-link-btn"
                  onClick={() => onInspectLogs({ appId: activeApp.id, failover: 'only' })}
                >
                  Open in Logs ↗
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="mp-empty compact"><strong>Loading telemetry...</strong></div>
          ) : failoverEvents.length === 0 ? (
            <div className="mp-empty compact">
              <strong>No failovers recorded</strong>
              <span>Triggered failovers and per-attempt error logs will appear here.</span>
            </div>
          ) : (
            <div className="mp-failover-event-list">
              {failoverEvents.map((event) => {
                const trace = parseFailoverTrace(event.failover_trace);
                return (
                  <div className="mp-failover-event" key={event.id}>
                    <div className="mp-failover-event-top">
                      <span className={`mp-badge ${event.status === 'success' ? 'success' : 'danger'}`}>
                        {event.failover_used === 1 ? 'Failover succeeded' : 'Failover failed'}
                      </span>
                      <span className="font-mono">
                        {formatTime(event.timestamp)} · {Math.round(event.latency_ms)} ms
                      </span>
                    </div>
                    <div className="mp-failover-event-id-row">
                      <span className="mp-failover-event-reqid font-mono" title={event.request_id}>
                        {event.request_id}
                      </span>
                      {onInspectLogs && (
                        <button
                          type="button"
                          className="mp-link-btn"
                          onClick={() => onInspectLogs({
                            appId: activeApp.id,
                            failover: 'only',
                            search: event.request_id
                          })}
                        >
                          Inspect log ↗
                        </button>
                      )}
                    </div>
                    <div className="mp-failover-event-route font-mono">
                      <span>{event.failover_from_model || 'primary'}</span>
                      <span className="mp-failover-arrow">→</span>
                      <strong>{event.failover_used === 1 ? event.model : `${event.model} (failed)`}</strong>
                    </div>
                    <div className="mp-failover-event-meta">
                      <span>{failoverReasonLabel(event.failover_reason)}</span>
                      <span>{event.failover_attempts || 0} fallback attempt(s)</span>
                      <span>HTTP {event.http_status || (event.status === 'success' ? 200 : 'error')}</span>
                    </div>
                    {trace.length > 0 ? (
                      <FailoverTraceList trace={trace} />
                    ) : event.error_message ? (
                      <div className="mp-failover-trace-message font-mono">{event.error_message}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
