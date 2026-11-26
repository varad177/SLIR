import React, { useEffect, useState } from 'react';
import {
  BudgetAction,
  BudgetItem,
  BudgetMetric,
  BudgetPayload,
  BudgetPeriod,
  BudgetScope
} from '../types/analytics';
import { createBudget, updateBudget } from '../api/client';
import { CloseIcon, AlertTriangleIcon } from './icons/Icons';
import { InfoTip } from './InfoTip';

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  budget?: BudgetItem | null;
  applications: Array<{ id: string; name: string }>;
  models: string[];
}

const METRIC_LABELS: Record<BudgetMetric, string> = {
  cost: 'Estimated cost (USD)',
  tokens: 'Total tokens',
  requests: 'Request count'
};

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  budget = null,
  applications,
  models
}) => {
  const [name, setName] = useState('');
  const [scopeType, setScopeType] = useState<BudgetScope>('global');
  const [applicationId, setApplicationId] = useState('');
  const [model, setModel] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [metric, setMetric] = useState<BudgetMetric>('cost');
  const [limitValue, setLimitValue] = useState('10');
  const [warnPercent, setWarnPercent] = useState('80');
  const [action, setAction] = useState<BudgetAction>('notify');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(budget?.name || '');
    setScopeType(budget?.scope_type || 'global');
    setApplicationId(budget?.application_id || applications[0]?.id || '');
    setModel(budget?.model || models[0] || '');
    setPeriod(budget?.period || 'monthly');
    setMetric(budget?.metric || 'cost');
    setLimitValue(budget ? String(budget.limit_value) : '10');
    setWarnPercent(budget ? String(budget.warn_percent) : '80');
    setAction(budget?.action || 'notify');
    setEnabled(budget?.enabled ?? true);
    setError(null);
    // Intentionally keyed on open state and budget id only: application/model
    // option arrays are recreated by the parent and must not reset a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, budget?.id]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the budget a descriptive name.');
      return;
    }
    if (scopeType === 'application' && !applicationId) {
      setError('Select the application this budget applies to.');
      return;
    }
    if (scopeType === 'model' && !model.trim()) {
      setError('Select the model this budget applies to.');
      return;
    }
    const limit = Number(limitValue);
    if (!Number.isFinite(limit) || limit <= 0) {
      setError('Limit must be a positive number.');
      return;
    }

    const payload: BudgetPayload = {
      name: name.trim(),
      scope_type: scopeType,
      application_id: scopeType === 'application' ? applicationId : null,
      model: scopeType === 'model' ? model : null,
      period,
      metric,
      limit_value: limit,
      warn_percent: Number(warnPercent) || 80,
      action,
      enabled
    };

    try {
      setSaving(true);
      setError(null);
      if (budget) {
        await updateBudget(budget.id, payload);
      } else {
        await createBudget(payload);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save budget.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mp-modal-backdrop" onClick={onClose}>
      <div className="mp-modal" style={{ width: 'min(620px, 100%)' }} onClick={(event) => event.stopPropagation()}>
        <div className="mp-modal-head">
          <div>
            <div className="mp-modal-title">{budget ? 'Edit budget' : 'Create budget'}</div>
            <div className="mp-modal-subtitle">
              Budgets evaluate recorded traffic in UTC day/month windows and can notify or block.
            </div>
          </div>
          <button className="mp-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mp-modal-body">
            {error && (
              <div className="mp-alert error">
                <AlertTriangleIcon size={14} />
                <span>{error}</span>
              </div>
            )}

            <div className="mp-form-grid">
              <label className="mp-form-field mp-form-full">
                <span>Name</span>
                <input
                  className="mp-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Monthly cloud spend cap"
                  autoFocus
                />
              </label>

              <label className="mp-form-field">
                <span className="mp-label-with-tip">
                  <span>Scope</span>
                  <InfoTip
                    title="Budget Scope"
                    text="All applications applies the cap across all gateway traffic combined. Application or Model restricts the cap to one specific app or model."
                  />
                </span>
                <select className="mp-select" value={scopeType} onChange={(event) => setScopeType(event.target.value as BudgetScope)}>
                  <option value="global">All applications</option>
                  <option value="application">Application</option>
                  <option value="model">Model</option>
                </select>
              </label>

              {scopeType === 'application' && (
                <label className="mp-form-field">
                  <span>Application</span>
                  <select className="mp-select" value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                  </select>
                </label>
              )}

              {scopeType === 'model' && (
                <label className="mp-form-field">
                  <span>Model</span>
                  <select className="mp-select" value={model} onChange={(event) => setModel(event.target.value)}>
                    {models.length === 0 && <option value="">No models seen yet</option>}
                    {models.map((modelName) => (
                      <option key={modelName} value={modelName}>{modelName}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="mp-form-field">
                <span>Period</span>
                <select className="mp-select" value={period} onChange={(event) => setPeriod(event.target.value as BudgetPeriod)}>
                  <option value="daily">Daily (UTC)</option>
                  <option value="monthly">Monthly (UTC)</option>
                </select>
              </label>

              <label className="mp-form-field">
                <span>Metric</span>
                <select className="mp-select" value={metric} onChange={(event) => setMetric(event.target.value as BudgetMetric)}>
                  {(Object.keys(METRIC_LABELS) as BudgetMetric[]).map((value) => (
                    <option key={value} value={value}>{METRIC_LABELS[value]}</option>
                  ))}
                </select>
              </label>

              <label className="mp-form-field">
                <span>Limit</span>
                <input
                  className="mp-input"
                  type="number"
                  min="0"
                  step={metric === 'cost' ? '0.01' : '1'}
                  value={limitValue}
                  onChange={(event) => setLimitValue(event.target.value)}
                />
                <small>
                  {metric === 'cost' ? 'USD at configured model pricing.' : metric === 'tokens' ? 'Sum of prompt + completion tokens.' : 'Gateway + ingested requests.'}
                </small>
              </label>

              <label className="mp-form-field">
                <span>Warning threshold</span>
                <input
                  className="mp-input"
                  type="number"
                  min="1"
                  max="100"
                  value={warnPercent}
                  onChange={(event) => setWarnPercent(event.target.value)}
                />
                <small>Percent of the limit that triggers a warning alert.</small>
              </label>

              <label className="mp-form-field">
                <span className="mp-label-with-tip">
                  <span>When exceeded</span>
                  <InfoTip
                    title="Notify vs Hard Block"
                    text="Notify only records an alert in Costs & Alerts and fires your webhook. Block gateway requests (HTTP 429) stops matching requests until the next UTC period."
                  />
                </span>
                <select className="mp-select" value={action} onChange={(event) => setAction(event.target.value as BudgetAction)}>
                  <option value="notify">Notify only</option>
                  <option value="block">Block gateway requests (429)</option>
                </select>
              </label>

              <label className="mp-form-field" style={{ justifyContent: 'flex-end' }}>
                <span>Status</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--mp-text-secondary)' }}>
                  <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                  Enabled
                </label>
              </label>
            </div>
          </div>

          <div className="mp-modal-footer">
            <button type="button" className="mp-btn mp-btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <div className="mp-modal-footer-right">
              <button type="submit" className="mp-btn mp-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : budget ? 'Save changes' : 'Create budget'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
