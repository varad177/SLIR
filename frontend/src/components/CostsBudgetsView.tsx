import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertSettings,
  BudgetAlertItem,
  BudgetItem,
  BudgetMetric,
  PricingRule,
  ApplicationItem,
  TimeSeriesPoint
} from '../types/analytics';
import {
  acknowledgeAlert,
  acknowledgeAllAlerts,
  deleteBudget,
  fetchAlertSettings,
  fetchAlerts,
  fetchBudgets,
  fetchFilterOptions,
  fetchInstalledModels,
  fetchPricingRules,
  fetchTimeSeries,
  sendTestAlert,
  updateAlertSettings,
  updateBudget
} from '../api/client';
import { BudgetModal } from './BudgetModal';
import { PricingModal } from './PricingModal';
import { copyText } from '../utils/clipboard';
import {
  AlertTriangleIcon,
  CheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  TrashIcon,
  ZapIcon
} from './icons/Icons';

interface CostsBudgetsViewProps {
  applications: ApplicationItem[];
  onAlertsChanged?: () => void;
}

const WEBHOOK_PAYLOAD_SAMPLE = JSON.stringify({
  event: 'budget.threshold',
  title: 'Budget warning',
  text: '"Daily API budget" is approaching its daily cost budget: $7.50 of $10.00 (75%, all applications).',
  content: '"Daily API budget" is approaching its daily cost budget: $7.50 of $10.00 (75%, all applications).',
  threshold: 'warning',
  budget: {
    id: 1,
    name: 'Daily API budget',
    metric: 'cost',
    period: 'daily',
    scope: 'global',
    limit: 10,
    usage: 7.5,
    percentage: 75
  },
  createdAt: new Date().toISOString()
}, null, 2);

const METRIC_LABEL: Record<BudgetMetric, string> = {
  cost: 'cost',
  tokens: 'tokens',
  requests: 'requests'
};

function formatValue(metric: BudgetMetric, value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (metric === 'cost') return `$${value.toFixed(4)}`;
  return Math.round(value).toLocaleString('en-US');
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 19).replace('T', ' ');
  return `${date.toLocaleString('en-US', { hour12: false })}`;
}

function budgetScopeLabel(budget: BudgetItem): string {
  if (budget.scope_type === 'application') return budget.application_name || budget.application_id || 'application';
  if (budget.scope_type === 'model') return budget.model || 'model';
  return 'All applications';
}

const statusTone = (percent: number, warnPercent: number) => {
  if (percent >= 100) return 'danger';
  if (percent >= warnPercent) return 'warn';
  return 'ok';
};

export const CostsBudgetsView: React.FC<CostsBudgetsViewProps> = ({ applications, onAlertsChanged }) => {
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [alerts, setAlerts] = useState<BudgetAlertItem[]>([]);
  const [unacknowledged, setUnacknowledged] = useState(0);
  const [settings, setSettings] = useState<AlertSettings>({ webhookUrl: '', webhookEnabled: false });
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unackOnly, setUnackOnly] = useState(true);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetItem | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [costAnomaly, setCostAnomaly] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const [filterOptions, installed] = await Promise.all([
        fetchFilterOptions().catch(() => ({ models: [] as string[], providers: [], applications: [] })),
        fetchInstalledModels().catch(() => null)
      ]);
      const names = new Set<string>(filterOptions.models || []);
      for (const model of installed?.models || []) {
        if (model.name && model.name !== 'active-model') names.add(`ollama/${model.name}`);
      }
      for (const custom of installed?.customModels || []) {
        if (custom.modelId) names.add(custom.modelId);
      }
      setModels(Array.from(names).sort());
    } catch {
      // Model options are best-effort; global budgets still work.
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [budgetList, alertData, alertSettings, pricing, timeSeries] = await Promise.all([
        fetchBudgets(),
        fetchAlerts({ unacknowledged: unackOnly, limit: 100 }),
        fetchAlertSettings().catch(() => ({ webhookUrl: '', webhookEnabled: false })),
        fetchPricingRules().catch(() => [] as PricingRule[]),
        fetchTimeSeries({ interval: 'day', start: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }).catch(() => [] as TimeSeriesPoint[])
      ]);
      setBudgets(budgetList);
      setAlerts(alertData.items || []);
      setUnacknowledged(alertData.unacknowledged || 0);
      setSettings(alertSettings);
      setPricingRules(pricing);

      if (timeSeries.length >= 2) {
        const daily = timeSeries.filter((p) => p.estimatedCost > 0);
        if (daily.length >= 2) {
          const today = daily[daily.length - 1].estimatedCost;
          const previous = daily.slice(0, -1);
          const avg = previous.reduce((sum, p) => sum + p.estimatedCost, 0) / previous.length;
          if (avg > 0 && today > avg * 2) {
            setCostAnomaly(`Today's spend ($${today.toFixed(2)}) is ${(today / avg).toFixed(1)}x the 7-day average ($${avg.toFixed(2)}).`);
          } else {
            setCostAnomaly(null);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load budgets and alerts.');
    } finally {
      setLoading(false);
    }
  }, [unackOnly]);

  useEffect(() => {
    loadAll();
    loadModels();
  }, [loadAll, loadModels]);

  useEffect(() => {
    const interval = setInterval(() => { loadAll(); }, 30 * 1000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const activeBudgetCount = useMemo(() => budgets.filter((budget) => budget.enabled).length, [budgets]);
  const exceededCount = useMemo(
    () => budgets.filter((budget) => budget.enabled && budget.percent >= 100).length,
    [budgets]
  );
  const projectedCost = useMemo(
    () => budgets
      .filter((budget) => budget.enabled && budget.metric === 'cost')
      .reduce((acc, budget) => acc + (budget.projectedValue || 0), 0),
    [budgets]
  );

  const handleDelete = async (budget: BudgetItem) => {
    if (!window.confirm(`Delete budget "${budget.name}"? Its alert history will also be removed.`)) return;
    try {
      await deleteBudget(budget.id);
      setNotice(`Budget "${budget.name}" deleted.`);
      await loadAll();
      onAlertsChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to delete budget.');
    }
  };

  const handleToggle = async (budget: BudgetItem) => {
    try {
      await updateBudget(budget.id, { enabled: !budget.enabled });
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update budget.');
    }
  };

  const handleAcknowledge = async (alert: BudgetAlertItem) => {
    try {
      await acknowledgeAlert(alert.id);
      await loadAll();
      onAlertsChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to acknowledge alert.');
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      await acknowledgeAllAlerts();
      await loadAll();
      onAlertsChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to acknowledge alerts.');
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      setError(null);
      const saved = await updateAlertSettings(settings);
      setSettings(saved);
      setNotice('Alert settings saved.');
    } catch (err: any) {
      setError(err.message || 'Failed to save alert settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestWebhook = async () => {
    try {
      setTestingWebhook(true);
      setError(null);
      const result = await sendTestAlert();
      setNotice(result.message || 'Test alert sent.');
    } catch (err: any) {
      setError(err.message || 'Failed to send test alert.');
    } finally {
      setTestingWebhook(false);
    }
  };

  const openCreate = () => {
    setEditingBudget(null);
    setBudgetModalOpen(true);
  };

  const openEdit = (budget: BudgetItem) => {
    setEditingBudget(budget);
    setBudgetModalOpen(true);
  };

  return (
    <div className="mp-costs-page">
      <div className="mp-costs-header">
        <div>
          <div className="mp-eyebrow">Governance</div>
          <h1 className="mp-page-title">Costs & Alerts</h1>
          <p className="mp-page-subtitle">
            Track spend pace, enforce daily or monthly budgets, and route threshold notifications to a webhook.
          </p>
        </div>
        <div className="mp-costs-actions">
          <button className="mp-btn mp-btn-ghost" onClick={() => setPricingOpen(true)}>
            <SettingsIcon size={13} />
            Pricing rules
            <span className="mp-badge-count">{pricingRules.length}</span>
          </button>
          <button className="mp-btn mp-btn-ghost" onClick={loadAll} disabled={loading}>
            <RefreshCwIcon size={13} />
            Refresh
          </button>
          <button className="mp-btn mp-btn-primary" onClick={openCreate}>
            <PlusIcon size={13} />
            New budget
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
          <span>Active budgets</span>
          <strong>{activeBudgetCount}</strong>
        </div>
        <div className="mp-costs-stat">
          <span>Exceeded now</span>
          <strong style={{ color: exceededCount > 0 ? 'var(--mp-red)' : undefined }}>{exceededCount}</strong>
        </div>
        <div className="mp-costs-stat">
          <span>Unacknowledged alerts</span>
          <strong style={{ color: unacknowledged > 0 ? 'var(--mp-orange)' : undefined }}>{unacknowledged}</strong>
        </div>
        <div className="mp-costs-stat">
          <span>Projected cost this period</span>
          <strong>${projectedCost.toFixed(2)}</strong>
        </div>
      </div>

      <div className="mp-section-header">
        <div>
          <div className="mp-eyebrow">Guardrails</div>
          <h2 className="mp-section-title">Budgets</h2>
        </div>
      </div>

      {loading && budgets.length === 0 ? (
        <div className="mp-empty"><strong>Loading budgets...</strong></div>
      ) : budgets.length === 0 ? (
        <div className="mp-empty">
          <strong>No budgets yet</strong>
          <span>Create a daily or monthly limit on spend, tokens or requests. Hard blocks return HTTP 429 at the gateway.</span>
          <button className="mp-btn mp-btn-primary" onClick={openCreate}>
            <PlusIcon size={13} /> Create your first budget
          </button>
        </div>
      ) : (
        <div className="mp-budget-grid">
          {budgets.map((budget) => {
            const percent = Number.isFinite(budget.percent) ? budget.percent : 0;
            const tone = statusTone(percent, budget.warn_percent);
            return (
              <div key={budget.id} className={`mp-budget-card ${budget.enabled ? '' : 'disabled'}`}>
                <div className="mp-budget-card-head">
                  <div>
                    <div className="mp-budget-title">{budget.name}</div>
                    <div className="mp-budget-meta">
                      <span className="mp-badge-tag">{budgetScopeLabel(budget)}</span>
                      <span className="mp-badge-tag">{budget.period}</span>
                      <span className="mp-badge-tag">{METRIC_LABEL[budget.metric]}</span>
                      {budget.action === 'block' && (
                        <span className="mp-badge-tag" style={{ color: 'var(--mp-red)', borderColor: 'var(--mp-red-line)' }}>
                          hard block
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mp-row-actions">
                    <button className="mp-btn mp-btn-ghost" onClick={() => openEdit(budget)}>Edit</button>
                    <button className="mp-icon-btn danger" onClick={() => handleDelete(budget)} aria-label="Delete budget">
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>

                <div className="mp-budget-usage">
                  <div className="mp-budget-usage-labels">
                    <span>
                      <strong>{formatValue(budget.metric, budget.usage)}</strong>
                      <span> of {formatValue(budget.metric, budget.limit_value)}</span>
                    </span>
                    <span className={`mp-budget-percent ${tone}`}>{percent.toFixed(1)}%</span>
                  </div>
                  <div className="mp-budget-progress">
                    <div
                      className={`mp-budget-progress-fill ${tone}`}
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                  <div className="mp-budget-projection">
                    {budget.projectionReliable === false
                      ? 'Early estimate: not enough of this period has elapsed for a reliable projection.'
                      : `Projected ${formatValue(budget.metric, budget.projectedValue)} by period end`}
                    {budget.projectionReliable !== false && budget.metric === 'cost' && budget.projectedPercent > 100 ? ' (over limit)' : ''}
                  </div>
                </div>

                <div className="mp-budget-foot">
                  <span className="font-mono">{budget.periodKey}</span>
                  <label className="mp-budget-toggle">
                    <input type="checkbox" checked={budget.enabled} onChange={() => handleToggle(budget)} />
                    {budget.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mp-section-header">
        <div>
          <div className="mp-eyebrow">Notifications</div>
          <h2 className="mp-section-title">Alert history</h2>
        </div>
        <div className="mp-row-actions">
          <label className="mp-budget-toggle">
            <input type="checkbox" checked={unackOnly} onChange={(event) => setUnackOnly(event.target.checked)} />
            Unacknowledged only
          </label>
          <button className="mp-btn mp-btn-ghost" onClick={handleAcknowledgeAll} disabled={unacknowledged === 0}>
            Acknowledge all
          </button>
        </div>
      </div>

      <div className="mp-card" style={{ padding: 0, overflow: 'hidden' }}>
        {alerts.length === 0 ? (
          <div className="mp-empty compact">
            <strong>No alerts</strong>
            <span>{unackOnly ? 'Nothing needs attention right now.' : 'Threshold alerts will appear here.'}</span>
          </div>
        ) : (
          <div className="mp-table-wrapper">
            <table className="mp-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Budget</th>
                  <th>Threshold</th>
                  <th>Usage</th>
                  <th>Delivery</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id} style={{ opacity: alert.acknowledged ? 0.6 : 1 }}>
                    <td className="font-mono" style={{ whiteSpace: 'nowrap', fontSize: '0.6875rem' }}>
                      {formatDateTime(alert.created_at)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{alert.budget_name}</div>
                      <div style={{ color: 'var(--mp-text-muted)', fontSize: '0.6875rem' }}>
                        {alert.metric} · {alert.period_key}
                      </div>
                    </td>
                    <td>
                      <span
                        className="mp-badge-tag"
                        style={{
                          color: alert.threshold === 'exceeded' ? 'var(--mp-red)' : 'var(--mp-orange)',
                          borderColor: alert.threshold === 'exceeded' ? 'var(--mp-red-line)' : 'var(--mp-orange-line)'
                        }}
                      >
                        {alert.threshold}
                      </span>
                    </td>
                    <td className="font-mono" style={{ fontSize: '0.6875rem' }}>
                      {formatValue(alert.metric, alert.usage_value)} / {formatValue(alert.metric, alert.limit_value)}
                    </td>
                    <td>
                      <span className={`mp-delivery ${alert.delivery_status}`}>{alert.delivery_status.replace(/_/g, ' ')}</span>
                      {alert.delivery_error && (
                        <div style={{ color: 'var(--mp-text-muted)', fontSize: '0.625rem', marginTop: '2px' }}>{alert.delivery_error}</div>
                      )}
                    </td>
                    <td>
                      {!alert.acknowledged && (
                        <button className="mp-btn mp-btn-ghost" onClick={() => handleAcknowledge(alert)}>Acknowledge</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mp-section-header">
        <div>
{costAnomaly && (
        <div className="mp-anomaly-banner" role="alert" aria-live="polite">
          <AlertTriangleIcon size={14} />
          <span>Cost anomaly detected: {costAnomaly}</span>
        </div>
      )}
      <div className="mp-eyebrow">Delivery</div>
      <h2 className="mp-section-title">Webhook settings</h2>
        </div>
      </div>

      <div className="mp-card">
        <div className="mp-settings-grid">
          <label className="mp-form-field mp-form-full">
            <span>Webhook URL <em>(Slack, Discord or any JSON endpoint)</em></span>
            <input
              className="mp-input font-mono"
              value={settings.webhookUrl}
              onChange={(event) => setSettings((prev) => ({ ...prev, webhookUrl: event.target.value }))}
              placeholder="https://hooks.slack.com/services/..."
            />
            <small>Alerts post JSON with both <code>text</code> and <code>content</code> fields. Delivery failures never block budgeting.</small>
          </label>
          <label className="mp-form-field">
            <span>Webhook delivery</span>
            <label className="mp-budget-toggle" style={{ padding: '8px 0' }}>
              <input
                type="checkbox"
                checked={settings.webhookEnabled}
                onChange={(event) => setSettings((prev) => ({ ...prev, webhookEnabled: event.target.checked }))}
              />
              Send alerts to this webhook
            </label>
          </label>
          <div className="mp-form-field" style={{ justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="mp-btn mp-btn-primary" onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
              <button className="mp-btn mp-btn-ghost" onClick={handleTestWebhook} disabled={testingWebhook || !settings.webhookUrl}>
                <ZapIcon size={12} />
                {testingWebhook ? 'Sending...' : 'Send test alert'}
              </button>
            </div>
          </div>
        </div>
        <details className="mp-webhook-sample">
          <summary>Payload preview for Slack, Discord, and generic receivers</summary>
          <p>
            SLIR posts the same JSON to every URL. Slack reads <code>text</code>, Discord reads <code>content</code>,
            and PagerDuty/Opsgenie can route on <code>event</code>, <code>threshold</code>, and <code>budget</code>.
          </p>
          <div className="mp-webhook-sample-head">
            <span>Sample budget warning</span>
            <button
              type="button"
              className="mp-btn mp-btn-ghost"
              onClick={async () => {
                if (!(await copyText(WEBHOOK_PAYLOAD_SAMPLE))) return;
                setCopiedPayload(true);
                setTimeout(() => setCopiedPayload(false), 2000);
              }}
            >
              {copiedPayload ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
          <pre>{WEBHOOK_PAYLOAD_SAMPLE}</pre>
        </details>
      </div>

      <BudgetModal
        isOpen={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        onSaved={async () => { await loadAll(); onAlertsChanged?.(); }}
        budget={editingBudget}
        applications={applications.map((app) => ({ id: app.id, name: app.name }))}
        models={models}
      />

      <PricingModal
        isOpen={pricingOpen}
        onClose={() => { setPricingOpen(false); loadAll(); }}
        providers={Array.from(new Set(pricingRules.map((rule) => rule.provider)))}
      />
    </div>
  );
};
