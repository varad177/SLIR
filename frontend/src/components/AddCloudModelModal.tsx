import React, { useState } from 'react';
import { addCustomCloudModel } from '../api/client';
import { CustomCloudModel } from '../types/analytics';
import { CloseIcon, AlertTriangleIcon, CheckIcon } from './icons/Icons';

interface AddCloudModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelAdded: (newModel: CustomCloudModel) => void;
}

const PROVIDER_PRESETS = [
  {
    name: 'LM Studio (Local: http://localhost:1234/v1)',
    provider: 'lmstudio',
    apiBase: 'http://localhost:1234/v1',
    modelId: 'local-model',
    displayName: 'LM Studio Local'
  },
  {
    name: 'vLLM (Local / Server: http://localhost:8000/v1)',
    provider: 'vllm',
    apiBase: 'http://localhost:8000/v1',
    modelId: 'meta-llama/Llama-3.1-8B-Instruct',
    displayName: 'vLLM Local Server'
  },
  {
    name: 'Groq Cloud (Llama 3.3 70B)',
    provider: 'groq',
    apiBase: 'https://api.groq.com/openai/v1',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B (Groq)'
  },
  {
    name: 'OpenAI (GPT-4o Mini)',
    provider: 'openai',
    apiBase: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini (OpenAI)'
  },
  {
    name: 'DeepSeek (DeepSeek Chat)',
    provider: 'deepseek',
    apiBase: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat'
  },
  {
    name: 'Custom Endpoint (Local or Remote)',
    provider: 'custom',
    apiBase: 'http://localhost:8080/v1',
    modelId: 'custom-model-id',
    displayName: 'Custom Model'
  }
];

export const AddCloudModelModal: React.FC<AddCloudModelModalProps> = ({
  isOpen,
  onClose,
  onModelAdded
}) => {
  const [displayName, setDisplayName] = useState<string>(PROVIDER_PRESETS[0].displayName);
  const [modelId, setModelId] = useState<string>(PROVIDER_PRESETS[0].modelId);
  const [provider, setProvider] = useState<string>(PROVIDER_PRESETS[0].provider);
  const [apiBase, setApiBase] = useState<string>(PROVIDER_PRESETS[0].apiBase);
  const [apiKey, setApiKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApplyPreset = (idx: number) => {
    const p = PROVIDER_PRESETS[idx];
    setDisplayName(p.displayName);
    setModelId(p.modelId);
    setProvider(p.provider);
    setApiBase(p.apiBase);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId.trim() || !apiBase.trim()) {
      setError('Model Identifier and Base URL are required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload: CustomCloudModel = {
        modelId: modelId.trim(),
        displayName: displayName.trim() || modelId.trim(),
        provider: provider.trim().toLowerCase(),
        apiBase: apiBase.trim(),
        apiKey: apiKey.trim()
      };

      await addCustomCloudModel(payload);
      onModelAdded(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save cloud model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(5, 7, 12, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px'
    }}>
      <div style={{
        background: '#12151e',
        border: '1px solid #1e2433',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '520px',
        boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(249, 115, 22, 0.1)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #1e2433',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }} />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
                Add Model Endpoint
              </h3>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '4px 0 0 16px' }}>
              Connect any local server (LM Studio, vLLM, llama.cpp) or cloud API provider
            </p>
          </div>
          <button
            onClick={onClose}
            className="mp-modal-close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px'
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertTriangleIcon size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Preset Selector */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Quick Presets
            </label>
            <select
              onChange={(e) => handleApplyPreset(parseInt(e.target.value, 10))}
              className="mp-select font-mono"
              style={{ width: '100%', fontSize: '0.75rem', background: '#090b10', borderColor: '#1e2433' }}
            >
              {PROVIDER_PRESETS.map((p, idx) => (
                <option key={p.name} value={idx}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Model Display Name */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Llama 3.3 70B (Groq)"
              className="mp-input font-mono"
              style={{ height: '36px', padding: '8px 12px', fontSize: '0.8125rem' }}
              required
            />
          </div>

          {/* Model ID */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Model Identifier (Passed to API)
            </label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="e.g. llama-3.3-70b-versatile or gpt-4o-mini"
              className="mp-input font-mono"
              style={{ height: '36px', padding: '8px 12px', fontSize: '0.8125rem' }}
              required
            />
          </div>

          {/* Base URL */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Base URL (OpenAI-compatible)
            </label>
            <input
              type="url"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              className="mp-input font-mono"
              style={{ height: '36px', padding: '8px 12px', fontSize: '0.8125rem' }}
              required
            />
          </div>

          {/* API Key */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                API Key (Optional for local vLLM/LMStudio)
              </label>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '0.6875rem', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_... or sk-..."
              className="mp-input font-mono"
              style={{ height: '36px', padding: '8px 12px', fontSize: '0.8125rem' }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid #1e2433' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="mp-btn-ghost font-mono"
              style={{ padding: '8px 16px', fontSize: '0.75rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="mp-btn-primary font-mono"
              style={{ padding: '8px 20px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {saving ? (
                <span>Connecting...</span>
              ) : (
                <>
                  <CheckIcon size={14} />
                  <span>Save & Enable Model</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
