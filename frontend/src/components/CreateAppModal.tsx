import React, { useState } from 'react';
import { createApplication } from '../api/client';
import { ApplicationItem } from '../types/analytics';
import { CloseIcon, AlertTriangleIcon, CheckIcon, CopyIcon, ApplicationsIcon } from './icons/Icons';
import { InfoTip } from './InfoTip';
import { GatewayConnectionCard } from './GatewayConnectionCard';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import { copyText } from '../utils/clipboard';

const APP_TEMPLATES = [
  { label: 'General assistant', name: 'General Assistant', description: 'General-purpose chat and workflow assistant.' },
  { label: 'RAG service', name: 'RAG Service', description: 'Retrieval-augmented answers over internal documents.' },
  { label: 'Code review bot', name: 'Code Review Bot', description: 'Reviews pull requests and suggests changes.' },
  { label: 'Support chatbot', name: 'Support Chatbot', description: 'Customer support assistant with guardrails.' },
  { label: 'Industrial monitor', name: 'Sensor Monitor', description: 'Real-time sensor analysis and maintenance alerts.' }
];

interface CreateAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (app: ApplicationItem) => void;
  installedModels?: string[];
}

export const CreateAppModal: React.FC<CreateAppModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  installedModels = ['active-model', 'qwen2.5:1.5b', 'qwen2.5:3b']
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultModel, setDefaultModel] = useState('active-model');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdApp, setCreatedApp] = useState<ApplicationItem | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(getBrowserGatewayBaseUrl());

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide an application name.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await createApplication({
        name: name.trim(),
        description: description.trim(),
        defaultModel
      });

      if (res.success && res.application) {
        setCreatedApp(res.application);
        onCreated(res.application);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create application.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (!(await copyText(text))) return;
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setDefaultModel('active-model');
    setCreatedApp(null);
    setError(null);
    onClose();
  };

  return (
    <div className="mp-modal-backdrop" style={{ zIndex: 9999 }} onClick={resetAndClose}>
      <div
        className="mp-modal"
        style={{
          width: '100%',
          maxWidth: '560px',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--mp-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--mp-bg-subtle)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--mp-orange)' }}>
                <ApplicationsIcon size={16} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--mp-text-primary)', letterSpacing: '-0.01em' }}>
                {createdApp ? 'Application Credentials Generated' : 'Register New Application'}
              </h3>
            </div>
            <p style={{ margin: '4px 0 0 24px', fontSize: '0.75rem', color: 'var(--mp-text-muted)' }}>
              {createdApp 
                ? 'Credentials generated. Plug into your client SDK or C# / Python codebase.'
                : 'Provisions virtual API key and isolated routing policy.'}
            </p>
          </div>
          <button 
            onClick={resetAndClose}
            className="mp-modal-close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--mp-text-muted)',
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

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--mp-red)',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            margin: '16px 20px 0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <AlertTriangleIcon size={14} />
            <span>{error}</span>
          </div>
        )}

        {createdApp ? (
          /* SUCCESS SCREEN: SHOW KEY & BASE URL */
          <div style={{ padding: '20px' }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '6px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px'
            }}>
              <span style={{ color: 'var(--mp-green)', marginTop: '1px' }}>
                <CheckIcon size={16} />
              </span>
              <div>
                <div style={{ color: 'var(--mp-green)', fontWeight: 600, fontSize: '0.8125rem' }}>
                  Application "{createdApp.name}" registered successfully!
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--mp-text-secondary)', lineHeight: 1.4 }}>
                  Copy your credentials below. You can plug them directly into your C# (.NET), Python, or cURL client.
                </p>
              </div>
            </div>

            <GatewayConnectionCard value={baseUrl} onChange={setBaseUrl} compact />

            {/* API Key */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Virtual API Key (Save this key)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={createdApp.apiKey}
                  className="mp-input font-mono"
                  style={{ background: 'var(--mp-surface-input)', color: 'var(--mp-green)', fontSize: '0.8125rem', fontWeight: 600 }}
                />
                <button
                  onClick={() => copyToClipboard(createdApp.apiKey)}
                  className="mp-btn-primary font-mono"
                  style={{ padding: '0 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  {copiedKey ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginTop: '4px' }}>
                Requests using this key will be tracked with system prompt caching & token telemetry.
              </div>
            </div>

            {/* Sample C# appsettings snippet */}
            <div style={{
              background: 'var(--mp-surface-input)',
              border: '1px solid var(--mp-border)',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace' }}>
                <span>Example: appsettings.json</span>
                <span style={{ color: 'var(--mp-cyan)' }}>C# / .NET Ready</span>
              </div>
              <pre className="font-mono" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mp-text-secondary)', overflowX: 'auto', lineHeight: 1.4 }}>
{`"Llm": {
  "Endpoint": "${baseUrl}",
  "ApiKey": "${createdApp.apiKey}",
  "Model": "${createdApp.defaultModel}"
}`}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={resetAndClose} className="mp-btn-primary font-mono" style={{ padding: '8px 20px', fontSize: '0.75rem' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          /* REGISTRATION FORM */
          <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Start from a template
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {APP_TEMPLATES.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="mp-btn mp-btn-ghost"
                    style={{ fontSize: '0.6875rem', padding: '5px 9px' }}
                    onClick={() => {
                      setName(template.name);
                      setDescription(template.description);
                    }}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Application Name *
              </label>
              <input
                type="text"
                placeholder="e.g. SensorReportBot (.NET), Code Review Bot, RAG Service"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mp-input font-mono"
                style={{ fontSize: '0.8125rem', height: '36px' }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Description (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Real-time industrial maintenance bot"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mp-input font-mono"
                style={{ fontSize: '0.8125rem', height: '36px' }}
              />
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <span>Default Target Model</span>
                <InfoTip
                  title="Follow Global vs Pinned Model"
                  text="Choose 'active-model' to follow the shared Global Fallback (switchable anytime from the dashboard without touching your app). Choose a specific model to lock ('pin') this app to that model alone."
                />
              </label>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="mp-select font-mono"
                style={{ width: '100%', fontSize: '0.75rem', background: 'var(--mp-surface-input)', borderColor: 'var(--mp-border)' }}
              >
                <option value="active-model">active-model (Dynamic Gateway Switcher)</option>
                {installedModels.filter(m => m !== 'active-model').map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginTop: '4px' }}>
                Selecting <code>active-model</code> enables zero-downtime hot-swapping between local Ollama and Cloud models from the dashboard.
              </div>
            </div>

            <div style={{
              background: 'rgba(56, 189, 248, 0.05)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: '6px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontSize: '0.75rem',
              color: 'var(--mp-text-secondary)',
              lineHeight: 1.4
            }}>
              Upon creating this app, you will receive a dedicated <strong>Base URL</strong> (<code>{getBrowserGatewayBaseUrl()}</code>) and <strong>Virtual API Key</strong> (<code>mp_live_...</code>) ready to authenticate requests.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--mp-border)' }}>
              <button
                type="button"
                onClick={resetAndClose}
                className="mp-btn-ghost font-mono"
                style={{ padding: '8px 16px', fontSize: '0.75rem' }}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="mp-btn-primary font-mono"
                disabled={loading || !name.trim()}
                style={{ padding: '8px 20px', fontSize: '0.75rem' }}
              >
                {loading ? 'Generating Credentials...' : 'Create Application'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
