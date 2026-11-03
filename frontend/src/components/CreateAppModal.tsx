import React, { useState } from 'react';
import { createApplication } from '../api/client';
import { ApplicationItem } from '../types/analytics';
import { CloseIcon, AlertTriangleIcon, CheckIcon, CopyIcon, ApplicationsIcon } from './icons/Icons';

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
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [envMode, setEnvMode] = useState<'host' | 'docker'>('docker');

  const activeBaseUrl = envMode === 'docker' ? 'http://host.docker.internal:4101/v1' : 'http://localhost:4101/v1';

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

  const copyToClipboard = (text: string, isKey = true) => {
    navigator.clipboard.writeText(text);
    if (isKey) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
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
    }} onClick={resetAndClose}>
      <div 
        style={{
          background: '#12151e',
          border: '1px solid #1e2433',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(249, 115, 22, 0.1)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
              <span style={{ color: '#f97316' }}>
                <ApplicationsIcon size={16} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                {createdApp ? 'Application Credentials Generated' : 'Register New Application'}
              </h3>
            </div>
            <p style={{ margin: '4px 0 0 24px', fontSize: '0.75rem', color: '#64748b' }}>
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

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
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
              <span style={{ color: '#10b981', marginTop: '1px' }}>
                <CheckIcon size={16} />
              </span>
              <div>
                <div style={{ color: '#34d399', fontWeight: 600, fontSize: '0.8125rem' }}>
                  Application "{createdApp.name}" registered successfully!
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
                  Copy your credentials below. You can plug them directly into your C# (.NET), Python, or cURL client.
                </p>
              </div>
            </div>

            {/* Environment Toggle: Docker vs Host */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Where will your application run?
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setEnvMode('docker')}
                  style={{
                    background: envMode === 'docker' ? 'rgba(249, 115, 22, 0.15)' : '#090b10',
                    border: `1px solid ${envMode === 'docker' ? '#f97316' : '#1e2433'}`,
                    color: envMode === 'docker' ? '#f8fafc' : '#64748b',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                  className="font-mono"
                >
                  <div style={{ fontWeight: 700, color: envMode === 'docker' ? '#f97316' : '#cbd5e1' }}>Inside Docker Container</div>
                  <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>Uses host.docker.internal:4101</div>
                </button>
                <button
                  type="button"
                  onClick={() => setEnvMode('host')}
                  style={{
                    background: envMode === 'host' ? 'rgba(249, 115, 22, 0.15)' : '#090b10',
                    border: `1px solid ${envMode === 'host' ? '#f97316' : '#1e2433'}`,
                    color: envMode === 'host' ? '#f8fafc' : '#64748b',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                  className="font-mono"
                >
                  <div style={{ fontWeight: 700, color: envMode === 'host' ? '#f97316' : '#cbd5e1' }}>Direct Host (IDE / CLI)</div>
                  <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '2px' }}>Uses localhost:4101</div>
                </button>
              </div>
            </div>

            {/* Base URL */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Gateway Base URL ({envMode === 'docker' ? 'Docker Bridge' : 'Localhost'})
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={activeBaseUrl}
                  className="mp-input font-mono"
                  style={{ background: '#090b10', color: '#38bdf8', fontSize: '0.8125rem' }}
                />
                <button
                  onClick={() => copyToClipboard(activeBaseUrl, false)}
                  className="mp-btn-primary font-mono"
                  style={{ padding: '0 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  {copiedUrl ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                </button>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', marginTop: '4px' }}>
                {envMode === 'docker'
                  ? 'Docker containers cannot reach "localhost" directly. host.docker.internal bridges out to your host PC.'
                  : 'Use localhost when testing directly on Windows/Mac with python main.py or dotnet run.'}
              </div>
            </div>

            {/* API Key */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Virtual API Key (Save this key)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={createdApp.apiKey}
                  className="mp-input font-mono"
                  style={{ background: '#090b10', color: '#34d399', fontSize: '0.8125rem', fontWeight: 600 }}
                />
                <button
                  onClick={() => copyToClipboard(createdApp.apiKey, true)}
                  className="mp-btn-primary font-mono"
                  style={{ padding: '0 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  {copiedKey ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', marginTop: '4px' }}>
                Requests using this key will be tracked with system prompt caching & token telemetry.
              </div>
            </div>

            {/* Sample C# appsettings snippet */}
            <div style={{
              background: '#090b10',
              border: '1px solid #1e2433',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace' }}>
                <span>Example: appsettings.json ({envMode === 'docker' ? 'Docker Compose' : 'Local IDE'})</span>
                <span style={{ color: '#38bdf8' }}>C# / .NET Ready</span>
              </div>
              <pre className="font-mono" style={{ margin: 0, fontSize: '0.75rem', color: '#cbd5e1', overflowX: 'auto', lineHeight: 1.4 }}>
{`"Llm": {
  "Endpoint": "${activeBaseUrl}",
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
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Description (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Real-time industrial motor predictive maintenance bot"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mp-input font-mono"
                style={{ fontSize: '0.8125rem', height: '36px' }}
              />
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Default Target Model
              </label>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="mp-select font-mono"
                style={{ width: '100%', fontSize: '0.75rem', background: '#090b10', borderColor: '#1e2433' }}
              >
                <option value="active-model">active-model (Dynamic Gateway Switcher)</option>
                {installedModels.filter(m => m !== 'active-model').map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', marginTop: '4px' }}>
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
              color: '#94a3b8',
              lineHeight: 1.4
            }}>
              Upon creating this app, you will receive a dedicated <strong>Base URL</strong> (<code>http://localhost:4101/v1</code>) and <strong>Virtual API Key</strong> (<code>mp_live_...</code>) ready to authenticate requests.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid #1e2433' }}>
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
