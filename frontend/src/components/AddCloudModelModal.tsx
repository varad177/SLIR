import React, { useEffect, useState } from 'react';
import { addCustomCloudModel, updateCustomCloudModel, testModelConnection, testStoredModel } from '../api/client';
import { CustomCloudModel, ModelFormat, ModelTestResult } from '../types/analytics';
import { CloseIcon, AlertTriangleIcon, CheckIcon, ZapIcon } from './icons/Icons';

interface AddCloudModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelAdded: (newModel: CustomCloudModel) => void;
  modelToEdit?: CustomCloudModel | null;
}

const FORMAT_OPTIONS: Array<{ value: ModelFormat; label: string; hint: string }> = [
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    hint: '/chat/completions'
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages API',
    hint: '/v1/messages'
  }
];

const PROVIDER_PRESETS = [
  {
    name: 'Anthropic',
    provider: 'anthropic',
    format: 'anthropic' as ModelFormat,
    apiBase: 'https://api.anthropic.com',
    modelId: 'claude-3-5-sonnet-latest',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192
  },
  {
    name: 'Groq',
    provider: 'groq',
    format: 'openai' as ModelFormat,
    apiBase: 'https://api.groq.com/openai/v1',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B (Groq)',
    contextWindow: 131072
  },
  {
    name: 'OpenAI',
    provider: 'openai',
    format: 'openai' as ModelFormat,
    apiBase: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000
  },
  {
    name: 'DeepSeek',
    provider: 'deepseek',
    format: 'openai' as ModelFormat,
    apiBase: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    contextWindow: 65536
  },
  {
    name: 'OpenRouter',
    provider: 'openrouter',
    format: 'openai' as ModelFormat,
    apiBase: 'https://openrouter.ai/api/v1',
    modelId: 'anthropic/claude-3.5-sonnet',
    displayName: 'Claude 3.5 Sonnet (OpenRouter)',
    contextWindow: 200000
  },
  {
    name: 'LM Studio',
    provider: 'lmstudio',
    format: 'openai' as ModelFormat,
    apiBase: 'http://localhost:1234/v1',
    modelId: 'local-model',
    displayName: 'LM Studio Local',
    contextWindow: 32768
  },
  {
    name: 'vLLM / llama.cpp',
    provider: 'vllm',
    format: 'openai' as ModelFormat,
    apiBase: 'http://localhost:8000/v1',
    modelId: 'meta-llama/Llama-3.1-8B-Instruct',
    displayName: 'vLLM Local Server',
    contextWindow: 32768
  },
  {
    name: 'Custom OpenAI-compatible endpoint',
    provider: 'custom',
    format: 'openai' as ModelFormat,
    apiBase: 'http://localhost:8080/v1',
    modelId: 'custom-model-id',
    displayName: 'Custom Model',
    contextWindow: 8192
  }
];

const EMPTY_FORM = {
  displayName: '',
  modelId: '',
  provider: 'custom',
  format: 'openai' as ModelFormat,
  apiBase: '',
  apiKey: '',
  contextWindow: '',
  maxOutputTokens: '',
  inputCostPerMillion: '',
  outputCostPerMillion: '',
  timeoutMs: '30000'
};

export const AddCloudModelModal: React.FC<AddCloudModelModalProps> = ({
  isOpen,
  onClose,
  onModelAdded,
  modelToEdit = null
}) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const isEditing = Boolean(modelToEdit);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setTestResult(null);
    setShowKey(false);
    setShowAdvanced(false);
    if (modelToEdit) {
      setForm({
        displayName: modelToEdit.displayName || '',
        modelId: modelToEdit.modelId || '',
        provider: modelToEdit.provider || 'custom',
        format: modelToEdit.format || 'openai',
        apiBase: modelToEdit.apiBase || '',
        apiKey: '',
        contextWindow: modelToEdit.contextWindow ? String(modelToEdit.contextWindow) : '',
        maxOutputTokens: modelToEdit.maxOutputTokens ? String(modelToEdit.maxOutputTokens) : '',
        inputCostPerMillion: modelToEdit.inputCostPerMillion != null ? String(modelToEdit.inputCostPerMillion) : '',
        outputCostPerMillion: modelToEdit.outputCostPerMillion != null ? String(modelToEdit.outputCostPerMillion) : '',
        timeoutMs: modelToEdit.timeoutMs ? String(modelToEdit.timeoutMs) : '30000'
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [isOpen, modelToEdit]);

  if (!isOpen) return null;

  const update = <K extends keyof typeof EMPTY_FORM,>(field: K, value: (typeof EMPTY_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const applyPreset = (index: number) => {
    const preset = PROVIDER_PRESETS[index];
    setForm((prev) => ({
      ...prev,
      provider: preset.provider,
      format: preset.format,
      apiBase: preset.apiBase,
      modelId: preset.modelId,
      displayName: preset.displayName,
      contextWindow: String(preset.contextWindow),
      maxOutputTokens: preset.maxOutputTokens ? String(preset.maxOutputTokens) : ''
    }));
  };

  const validate = () => {
    if (!form.modelId.trim()) return 'Model identifier is required.';
    if (!form.apiBase.trim()) return 'Base URL is required.';
    if (!/^https?:\/\//i.test(form.apiBase.trim())) return 'Base URL must start with http:// or https://.';
    return null;
  };

  const handleTest = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      if (!form.apiKey.trim() && modelToEdit) {
        const result = await testStoredModel(modelToEdit.modelId, {
          apiBase: form.apiBase.trim(),
          modelId: form.modelId.trim(),
          format: form.format,
          timeoutMs: Number(form.timeoutMs) || undefined
        });
        setTestResult(result);
      } else {
        const result = await testModelConnection({
          apiBase: form.apiBase.trim(),
          apiKey: form.apiKey.trim() || undefined,
          modelId: form.modelId.trim(),
          format: form.format,
          timeoutMs: Number(form.timeoutMs) || undefined
        });
        setTestResult(result);
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: CustomCloudModel = {
        modelId: form.modelId.trim(),
        displayName: form.displayName.trim() || form.modelId.trim(),
        provider: form.provider.trim().toLowerCase() || 'custom',
        format: form.format,
        apiBase: form.apiBase.trim(),
        apiKey: form.apiKey.trim() || undefined,
        keepApiKey: isEditing && !form.apiKey.trim(),
        contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
        maxOutputTokens: form.maxOutputTokens ? Number(form.maxOutputTokens) : null,
        inputCostPerMillion: form.inputCostPerMillion ? Number(form.inputCostPerMillion) : null,
        outputCostPerMillion: form.outputCostPerMillion ? Number(form.outputCostPerMillion) : null,
        timeoutMs: form.timeoutMs ? Number(form.timeoutMs) : null
      };

      if (isEditing && modelToEdit) {
        await updateCustomCloudModel(modelToEdit.modelId, payload);
      } else {
        await addCustomCloudModel(payload);
      }
      onModelAdded(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save model endpoint.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mp-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="mp-modal" role="dialog" aria-modal="true" aria-labelledby="model-modal-title">
        <div className="mp-modal-head">
          <div>
            <div className="mp-eyebrow">{isEditing ? 'Edit endpoint' : 'New endpoint'}</div>
            <h2 id="model-modal-title" className="mp-modal-title">{isEditing ? 'Edit model' : 'Add a model'}</h2>
            <p className="mp-modal-subtitle">
              Connect an OpenAI-compatible or Anthropic-compatible endpoint. You can verify the connection before saving.
            </p>
          </div>
          <button className="mp-icon-btn" onClick={onClose} disabled={saving} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="mp-modal-body">
          {error && (
            <div className="mp-alert error">
              <AlertTriangleIcon size={14} />
              <span>{error}</span>
            </div>
          )}

          {!isEditing && (
            <div className="mp-preset-grid">
              {PROVIDER_PRESETS.map((preset, index) => (
                <button
                  key={preset.name}
                  type="button"
                  className={`mp-preset ${form.provider === preset.provider && form.apiBase === preset.apiBase ? 'active' : ''}`}
                  onClick={() => applyPreset(index)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.apiBase.replace(/^https?:\/\//, '')}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mp-form-grid">
            <label className="mp-form-field">
              <span>Display name</span>
              <input
                className="mp-input"
                value={form.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                placeholder="e.g. Llama 3.3 70B (Groq)"
              />
              <small>Shown in routing menus.</small>
            </label>

            <label className="mp-form-field">
              <span>Provider label</span>
              <input
                className="mp-input font-mono"
                value={form.provider}
                onChange={(e) => update('provider', e.target.value)}
                placeholder="groq, openai, lmstudio..."
              />
              <small>Used for grouping and cost attribution.</small>
            </label>

            <label className="mp-form-field mp-form-full">
              <span>API format</span>
              <select
                className="mp-select"
                value={form.format}
                onChange={(e) => update('format', e.target.value as ModelFormat)}
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.hint})
                  </option>
                ))}
              </select>
              <small>How SLIR talks to this provider. Use Anthropic only for the native Anthropic API.</small>
            </label>

            <label className="mp-form-field mp-form-full">
              <span>Model identifier</span>
              <input
                className="mp-input font-mono"
                value={form.modelId}
                onChange={(e) => update('modelId', e.target.value)}
                placeholder="llama-3.3-70b-versatile"
                disabled={isEditing}
                required
              />
              <small>
                {isEditing
                  ? 'The identifier is fixed while editing. Add a new endpoint to route a different model id.'
                  : <>Must match the value accepted by the provider's <code>{form.format === 'anthropic' ? '/v1/messages' : '/chat/completions'}</code> endpoint.</>}
              </small>
            </label>

            <label className="mp-form-field mp-form-full">
              <span>Base URL</span>
              <input
                className="mp-input font-mono"
                type="url"
                value={form.apiBase}
                onChange={(e) => update('apiBase', e.target.value)}
                placeholder={form.format === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.groq.com/openai/v1'}
                required
              />
              <small>
                {form.format === 'anthropic'
                  ? <>The gateway appends <code>/v1/messages</code>. Including <code>/v1</code> in the base URL is fine.</>
                  : <>Include the API version. The gateway appends <code>/chat/completions</code>.</>}
              </small>
            </label>

            <label className="mp-form-field mp-form-full">
              <span>API key {isEditing && <em>optional</em>}</span>
              <div className="mp-input-row">
                <input
                  className="mp-input font-mono"
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => update('apiKey', e.target.value)}
                  placeholder={isEditing && modelToEdit?.hasApiKey ? 'Leave blank to keep the stored key' : 'sk-...'}
                  autoComplete="off"
                />
                <button type="button" className="mp-btn mp-btn-ghost" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <small>Stored locally in SQLite. Prefer a scoped key with a spending limit.</small>
            </label>
          </div>

          <button type="button" className="mp-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
          </button>

          {showAdvanced && (
            <div className="mp-form-grid">
              <label className="mp-form-field">
                <span>Context window</span>
                <input className="mp-input font-mono" type="number" min={1} value={form.contextWindow} onChange={(e) => update('contextWindow', e.target.value)} placeholder="131072" />
              </label>
              <label className="mp-form-field">
                <span>Max output tokens</span>
                <input className="mp-input font-mono" type="number" min={1} value={form.maxOutputTokens} onChange={(e) => update('maxOutputTokens', e.target.value)} placeholder="4096" />
              </label>
              <label className="mp-form-field">
                <span>Input cost / 1M tokens</span>
                <input className="mp-input font-mono" type="number" min={0} step="0.0001" value={form.inputCostPerMillion} onChange={(e) => update('inputCostPerMillion', e.target.value)} placeholder="0.59" />
              </label>
              <label className="mp-form-field">
                <span>Output cost / 1M tokens</span>
                <input className="mp-input font-mono" type="number" min={0} step="0.0001" value={form.outputCostPerMillion} onChange={(e) => update('outputCostPerMillion', e.target.value)} placeholder="0.79" />
              </label>
              <label className="mp-form-field">
                <span>Request timeout (ms)</span>
                <input className="mp-input font-mono" type="number" min={2000} max={60000} value={form.timeoutMs} onChange={(e) => update('timeoutMs', e.target.value)} />
              </label>
            </div>
          )}

          {testResult && (
            <div className={`mp-test-result ${testResult.ok ? 'ok' : 'error'}`}>
              <div>
                <strong>{testResult.ok ? 'Connection verified' : 'Connection failed'}</strong>
                <p>{testResult.message}</p>
                {testResult.ok && testResult.sample && <p className="font-mono">Sample: {testResult.sample}</p>}
              </div>
              {testResult.latencyMs != null && <span className="font-mono">{Math.round(testResult.latencyMs)} ms</span>}
            </div>
          )}

          <div className="mp-modal-footer">
            <button type="button" className="mp-btn mp-btn-ghost" onClick={handleTest} disabled={testing || saving}>
              <ZapIcon size={12} />
              {testing ? 'Testing...' : 'Test connection'}
            </button>
            <div className="mp-modal-footer-right">
              <button type="button" className="mp-btn mp-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="mp-btn mp-btn-primary" disabled={saving}>
                <CheckIcon size={13} />
                {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Add model'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
