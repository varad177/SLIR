import React, { useCallback, useEffect, useState } from 'react';
import { PricingRule } from '../types/analytics';
import {
  createPricingRule,
  deletePricingRule,
  fetchPricingRules,
  updatePricingRule
} from '../api/client';
import { CloseIcon, AlertTriangleIcon, PlusIcon, TrashIcon } from './icons/Icons';
import { InfoTip } from './InfoTip';
import { ConfirmModal } from './ConfirmModal';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers?: string[];
}

interface FormState {
  id: number | null;
  model_pattern: string;
  provider: string;
  input_cost_per_million: string;
  output_cost_per_million: string;
  effective_from: string;
  effective_to: string;
  currency: string;
}

const emptyForm = (): FormState => ({
  id: null,
  model_pattern: '',
  provider: 'openai',
  input_cost_per_million: '0',
  output_cost_per_million: '0',
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: '',
  currency: 'USD'
});

export const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, providers = [] }) => {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<PricingRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRules(await fetchPricingRules());
    } catch (err: any) {
      setError(err.message || 'Failed to load pricing rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm());
      setNotice(null);
      load();
    }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const update = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleEdit = (rule: PricingRule) => {
    setForm({
      id: rule.id,
      model_pattern: rule.model_pattern,
      provider: rule.provider,
      input_cost_per_million: String(rule.input_cost_per_million),
      output_cost_per_million: String(rule.output_cost_per_million),
      effective_from: rule.effective_from?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      effective_to: rule.effective_to ? rule.effective_to.slice(0, 10) : '',
      currency: rule.currency || 'USD'
    });
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.model_pattern.trim()) {
      setError('Model pattern is required.');
      return;
    }
    const input = Number(form.input_cost_per_million);
    const output = Number(form.output_cost_per_million);
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      setError('Input and output costs must be zero or greater.');
      return;
    }

    const payload = {
      model_pattern: form.model_pattern.trim(),
      provider: form.provider.trim().toLowerCase(),
      input_cost_per_million: input,
      output_cost_per_million: output,
      effective_from: new Date(`${form.effective_from}T00:00:00Z`).toISOString(),
      effective_to: form.effective_to ? new Date(`${form.effective_to}T00:00:00Z`).toISOString() : null,
      currency: form.currency || 'USD'
    };

    try {
      setSaving(true);
      setError(null);
      if (form.id) {
        await updatePricingRule(form.id, payload);
        setNotice('Pricing rule updated. Future events will use the new rates.');
      } else {
        await createPricingRule(payload);
        setNotice('Pricing rule created. Overlapping rules were closed automatically.');
      }
      setForm(emptyForm());
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to save pricing rule.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteRule = async () => {
    if (!ruleToDelete) return;
    try {
      setDeleting(true);
      await deletePricingRule(ruleToDelete.id);
      if (form.id === ruleToDelete.id) setForm(emptyForm());
      setNotice('Pricing rule deleted.');
      setRuleToDelete(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete pricing rule.');
    } finally {
      setDeleting(false);
    }
  };

  const providerOptions = Array.from(new Set([
    'openai', 'anthropic', 'google', 'groq', 'deepseek', 'mistral', 'ollama', ...providers
  ]));

  return (
    <div className="mp-modal-backdrop" onClick={onClose}>
      <div className="mp-modal" onClick={(event) => event.stopPropagation()}>
        <div className="mp-modal-head">
          <div>
            <div className="mp-modal-title">Model pricing rules</div>
            <div className="mp-modal-subtitle">
              Versioned per-provider rates power every estimated cost. Rates are USD per 1M tokens.
            </div>
          </div>
          <button className="mp-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="mp-modal-body">
          {error && (
            <div className="mp-alert error">
              <AlertTriangleIcon size={14} />
              <span>{error}</span>
            </div>
          )}
          {notice && <div className="mp-alert success"><span>{notice}</span></div>}

          <form onSubmit={handleSubmit}>
            <div className="mp-form-grid">
              <label className="mp-form-field">
                <span>Provider</span>
                <input
                  className="mp-input"
                  list="pricing-provider-options"
                  value={form.provider}
                  onChange={(event) => update('provider', event.target.value)}
                />
                <datalist id="pricing-provider-options">
                  {providerOptions.map((provider) => <option key={provider} value={provider} />)}
                </datalist>
              </label>
              <label className="mp-form-field">
                <span className="mp-label-with-tip">
                  <span>Model pattern</span>
                  <InfoTip
                    title="Model Pattern Matching"
                    text="Exact model ID or prefix wildcard matched when calculating costs. Only affects future requests—existing logs keep their original recorded cost."
                    example="e.g. gpt-4o* matches gpt-4o and gpt-4o-mini"
                  />
                </span>
                <input
                  className="mp-input"
                  value={form.model_pattern}
                  onChange={(event) => update('model_pattern', event.target.value)}
                  placeholder="gpt-4o-mini or llama*"
                />
                <small>Prefix wildcards are supported, e.g. <code>gpt-4o*</code>.</small>
              </label>
              <label className="mp-form-field">
                <span>Input $ / 1M</span>
                <input
                  className="mp-input"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.input_cost_per_million}
                  onChange={(event) => update('input_cost_per_million', event.target.value)}
                />
              </label>
              <label className="mp-form-field">
                <span>Output $ / 1M</span>
                <input
                  className="mp-input"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.output_cost_per_million}
                  onChange={(event) => update('output_cost_per_million', event.target.value)}
                />
              </label>
              <label className="mp-form-field">
                <span>Effective from</span>
                <input className="mp-input" type="date" value={form.effective_from} onChange={(event) => update('effective_from', event.target.value)} />
              </label>
              <label className="mp-form-field">
                <span>Effective to <em>(optional)</em></span>
                <input className="mp-input" type="date" value={form.effective_to} onChange={(event) => update('effective_to', event.target.value)} />
              </label>
              <label className="mp-form-field">
                <span>Currency</span>
                <input className="mp-input" value={form.currency} onChange={(event) => update('currency', event.target.value)} />
              </label>
              <div className="mp-form-field" style={{ justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="mp-btn mp-btn-primary" disabled={saving}>
                    <PlusIcon size={13} />
                    {saving ? 'Saving...' : form.id ? 'Save rule' : 'Add rule'}
                  </button>
                  {form.id && (
                    <button type="button" className="mp-btn mp-btn-ghost" onClick={() => setForm(emptyForm())}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>

          <div style={{ borderTop: '1px solid var(--mp-border)', paddingTop: '12px' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--mp-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Active & historical rules
            </div>
            {loading ? (
              <div className="mp-empty compact"><strong>Loading pricing rules...</strong></div>
            ) : rules.length === 0 ? (
              <div className="mp-empty compact"><strong>No custom pricing rules</strong><span>Built-in defaults will be used.</span></div>
            ) : (
              <div className="mp-table-wrapper" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Pattern</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Window</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => {
                      const open = !rule.effective_to || new Date(rule.effective_to).getTime() > Date.now();
                      return (
                        <tr key={rule.id}>
                          <td className="font-mono">{rule.provider}</td>
                          <td className="font-mono">{rule.model_pattern}</td>
                          <td>${Number(rule.input_cost_per_million).toFixed(4)}</td>
                          <td>${Number(rule.output_cost_per_million).toFixed(4)}</td>
                          <td style={{ fontSize: '0.6875rem', color: 'var(--mp-text-secondary)' }}>
                            {rule.effective_from?.slice(0, 10)}
                            {' → '}
                            {rule.effective_to ? rule.effective_to.slice(0, 10) : (open ? 'open' : '—')}
                          </td>
                          <td>
                            <div className="mp-row-actions">
                              <button type="button" className="mp-btn mp-btn-ghost" onClick={() => handleEdit(rule)}>Edit</button>
                              <button type="button" className="mp-icon-btn danger" onClick={() => setRuleToDelete(rule)} aria-label="Delete rule">
                                <TrashIcon size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="mp-modal-footer">
          <div className="mp-modal-footer-right">
            <button type="button" className="mp-btn mp-btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(ruleToDelete)}
        title="Delete pricing rule"
        message={`Delete pricing for ${ruleToDelete?.provider}/${ruleToDelete?.model_pattern}?`}
        subMessage="Existing historical events keep their already-recorded cost."
        confirmLabel="Delete rule"
        isDanger={true}
        loading={deleting}
        onConfirm={confirmDeleteRule}
        onClose={() => setRuleToDelete(null)}
      />
    </div>
  );
};
