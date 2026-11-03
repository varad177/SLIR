import React, { useState, useEffect } from 'react';
import { ApplicationItem } from '../types/analytics';
import { fetchApplications, deleteApplication, regenerateAppKey } from '../api/client';
import { CreateAppModal } from './CreateAppModal';
import { ConfirmModal } from './ConfirmModal';
import {
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  RotateCwIcon,
  TrashIcon,
  ChevronRightIcon
} from './icons/Icons';

interface ApplicationsViewProps {
  applications?: ApplicationItem[];
  onApplicationsChange?: () => void;
  onSelectAppForPlayground?: (appId: string) => void;
  installedModels?: string[];
}

export const ApplicationsView: React.FC<ApplicationsViewProps> = ({
  applications,
  onApplicationsChange,
  onSelectAppForPlayground,
  installedModels = ['active-model', 'qwen2.5:3b']
}) => {
  const [apps, setApps] = useState<ApplicationItem[]>(applications || []);
  const [selectedApp, setSelectedApp] = useState<ApplicationItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [revealedKey, setRevealedKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'python' | 'csharp' | 'node' | 'curl'>('python');
  const [envMode, setEnvMode] = useState<'host' | 'docker'>('docker');

  // Confirmation Modals State
  const [appToDelete, setAppToDelete] = useState<ApplicationItem | null>(null);
  const [appToRotateKey, setAppToRotateKey] = useState<ApplicationItem | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  useEffect(() => {
    if (applications) {
      setApps(applications);
      if (!selectedApp && applications.length > 0) {
        setSelectedApp(applications[0]);
      } else if (selectedApp) {
        const found = applications.find(a => a.id === selectedApp.id);
        if (found) setSelectedApp(found);
      }
    }
  }, [applications]);

  const handleCopy = (text: string, type: 'key' | 'url' | 'code') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const confirmDeleteApp = async () => {
    if (!appToDelete) return;
    try {
      setActionLoading(true);
      await deleteApplication(appToDelete.id);
      const remaining = apps.filter(a => a.id !== appToDelete.id);
      setApps(remaining);
      setSelectedApp(remaining.length > 0 ? remaining[0] : null);
      if (onApplicationsChange) onApplicationsChange();
    } catch (err: any) {
      alert(`Failed to delete application: ${err.message}`);
    } finally {
      setActionLoading(false);
      setAppToDelete(null);
    }
  };

  const confirmRotateKey = async () => {
    if (!appToRotateKey) return;
    try {
      setActionLoading(true);
      const res = await regenerateAppKey(appToRotateKey.id);
      if (res.success && res.apiKey) {
        const updated = apps.map(a => a.id === appToRotateKey.id ? { ...a, apiKey: res.apiKey, maskedApiKey: res.maskedApiKey } : a);
        setApps(updated);
        setSelectedApp(prev => prev && prev.id === appToRotateKey.id ? { ...prev, apiKey: res.apiKey, maskedApiKey: res.maskedApiKey } : prev);
        if (onApplicationsChange) onApplicationsChange();
      }
    } catch (err: any) {
      alert(`Failed to rotate key: ${err.message}`);
    } finally {
      setActionLoading(false);
      setAppToRotateKey(null);
    }
  };

  const current = selectedApp || (apps.length > 0 ? apps[0] : null);
  const currentKey = current ? current.apiKey : 'mp_live_your_key_here';
  const activeBaseUrl = envMode === 'docker' ? 'http://host.docker.internal:4101/v1' : 'http://localhost:4101/v1';
  const currentBaseUrl = activeBaseUrl;
  const currentModel = current ? current.defaultModel : 'active-model';

  const totalAppsReqs = apps.reduce((acc, a) => acc + (a.totalRequests || 0), 0);
  const totalAppsTokens = apps.reduce((acc, a) => acc + (a.totalTokens || 0), 0);
  const totalAppsCost = apps.reduce((acc, a) => acc + (a.totalCost || 0), 0);

  // Dynamic code snippets pre-filled with live app credentials
  const getSnippet = () => {
    switch (activeCodeTab) {
      case 'python':
        return `# OpenAI-compatible Python SDK
from openai import OpenAI

client = OpenAI(
    base_url="${currentBaseUrl}",
    api_key="${currentKey}"
)

response = client.chat.completions.create(
    model="${currentModel}",
    messages=[{"role": "user", "content": "Hello gateway!"}]
)
print(response.choices[0].message.content)`;

      case 'csharp':
        return `// C# .NET 8 HttpClient Implementation
using System.Net.Http.Headers;
using System.Text.Json;

var client = new HttpClient { BaseAddress = new Uri("${currentBaseUrl}/") };
client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "${currentKey}");

var payload = new {
    model = "${currentModel}",
    messages = new[] { new { role = "user", content = "Analyze vibration telemetry" } }
};

var response = await client.PostAsJsonAsync("chat/completions", payload);
var json = await response.Content.ReadAsStringAsync();
Console.WriteLine(json);`;

      case 'node':
        return `// Node.js OpenAI SDK or Native Fetch
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${currentBaseUrl}",
  apiKey: "${currentKey}"
});

const completion = await openai.chat.completions.create({
  model: "${currentModel}",
  messages: [{ role: "user", content: "Query diagnostics" }]
});

console.log(completion.choices[0].message.content);`;

      case 'curl':
        return `curl ${currentBaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${currentKey}" \\
  -d '{
    "model": "${currentModel}",
    "messages": [{"role": "user", "content": "Test prompt"}]
  }'`;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
              Applications & API Clients
            </h2>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid #1e2433',
                padding: '2px 7px',
                borderRadius: '4px',
                color: '#94a3b8'
              }}
            >
              {apps.length} listed
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            Manage registered client apps, virtual gateway keys, and SDK routing policies.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} className="font-mono">
          <button
            className="mp-btn-ghost font-mono"
            style={{ fontSize: '0.75rem', padding: '5px 12px' }}
          >
            Global Policies
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              background: '#f97316',
              color: '#0c0e14',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>+ Register Application</span>
          </button>
        </div>
      </div>

      {/* 2. 4 Top Stat Cards */}
      <div className="mp-4stat-grid">
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              REGISTERED CLIENTS
            </span>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
          </div>
          <div style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f8fafc', margin: '6px 0 2px 0' }} className="font-mono">
            {apps.length} <span style={{ fontSize: '0.8125rem', color: '#10b981', fontWeight: 600 }}>Active in Cluster</span>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#64748b' }} className="font-mono">
            0 suspended · 0 standby
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              GATEWAY BASE URL
            </span>
            <button
              onClick={() => handleCopy('http://localhost:4101/v1', 'url')}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}
              title="Copy Base URL"
            >
              {copiedUrl ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: '6px 0 2px 0' }} className="font-mono">
            http://localhost:4101/v1
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#64748b' }} className="font-mono">
            v1 Spec Compliant · HTTP/2 Loopback
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              24H GATEWAY REQS
            </span>
            <span style={{ fontSize: '0.6875rem', color: '#10b981' }} className="font-mono">
              {totalAppsReqs > 0 ? 'Active' : 'Idle'}
            </span>
          </div>
          <div style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f8fafc', margin: '6px 0 2px 0' }} className="font-mono">
            {totalAppsReqs.toLocaleString()} <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>reqs</span>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#64748b' }} className="font-mono">
            {totalAppsTokens > 0 ? `${totalAppsTokens.toLocaleString()} tokens total` : 'Ready for traffic'}
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
              ACTIVE MODEL TARGET
            </span>
            <span
              style={{
                fontSize: '0.625rem',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '1px 5px',
                borderRadius: '3px',
                color: '#94a3b8'
              }}
              className="font-mono"
            >
              Default
            </span>
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', margin: '6px 0 2px 0' }} className="font-mono">
            {currentModel}
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#10b981' }} className="font-mono">
            Gateway Managed Target
          </div>
        </div>
      </div>

      {/* 3. 2-Column Main Workspace */}
      <div className="mp-apps-grid">
        {/* Left Column: Active Deployments List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
              Active Deployments
            </span>
            <span className="font-mono" style={{ fontSize: '0.6875rem', color: '#64748b' }}>
              Sort: Throughput ↓
            </span>
          </div>

          {apps.length === 0 ? (
            <div className="mp-card" style={{ padding: '36px 16px', textAlign: 'center' }}>
              <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.875rem' }}>No client applications registered</div>
              <p style={{ margin: '4px 0 12px 0', fontSize: '0.75rem', color: '#64748b' }}>
                Register an app to get an API key and base URL.
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mp-btn-primary"
                style={{ padding: '6px 16px', fontSize: '0.75rem' }}
              >
                + Register First App
              </button>
            </div>
          ) : (
            apps.map((app) => {
              const isSelected = current?.id === app.id;
              return (
                <div
                  key={app.id}
                  onClick={() => setSelectedApp(app)}
                  className="mp-card"
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#161925' : '#12151e',
                    borderColor: isSelected ? '#f97316' : '#1e2433',
                    padding: '12px 14px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '5px',
                          background: 'rgba(249, 115, 22, 0.15)',
                          color: '#f97316',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '0.6875rem',
                          fontWeight: 700
                        }}
                      >
                        ●
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                            {app.name}
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.625rem',
                              color: '#10b981',
                              background: 'rgba(16, 185, 129, 0.12)',
                              padding: '1px 5px',
                              borderRadius: '3px'
                            }}
                          >
                            ● Active
                          </span>
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.625rem', color: '#64748b' }}>
                          {app.id} · Created {new Date(app.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="font-mono" style={{ fontSize: '0.6875rem', color: isSelected ? '#f97316' : '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span>Inspecting</span>
                      <ChevronRightIcon size={12} />
                    </div>
                  </div>

                  {/* 4 Metrics Strip */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px',
                      background: '#0c0e14',
                      border: '1px solid #1a1e2b',
                      borderRadius: '6px',
                      padding: '8px 10px'
                    }}
                    className="font-mono"
                  >
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>MODEL ALIAS</div>
                      <div style={{ fontSize: '0.6875rem', color: '#cbd5e1', fontWeight: 600, marginTop: '1px' }}>
                        {app.defaultModel}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>24H REQS</div>
                      <div style={{ fontSize: '0.6875rem', color: '#f8fafc', fontWeight: 700, marginTop: '1px' }}>
                        {app.totalRequests ? app.totalRequests.toLocaleString() : '0'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: app.failedRequests && app.failedRequests > 0 ? '#f43f5e' : '#10b981' }}>
                        {app.totalRequests > 0
                          ? `${Math.round(((app.totalRequests - (app.failedRequests || 0)) / app.totalRequests) * 100)}% ok`
                          : 'No Traffic'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>TOKENS</div>
                      <div style={{ fontSize: '0.6875rem', color: '#f8fafc', fontWeight: 700, marginTop: '1px' }}>
                        {app.totalTokens ? app.totalTokens.toLocaleString() : '0'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>
                        {app.lastActive ? new Date(app.lastActive).toLocaleDateString() : 'No reqs yet'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>ROUTED COST</div>
                      <div style={{ fontSize: '0.6875rem', color: '#10b981', fontWeight: 700, marginTop: '1px' }}>
                        ${app.totalCost ? app.totalCost.toFixed(4) : '0.0000'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>
                        {app.defaultModel === 'active-model' ? 'Dynamic' : 'Direct'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Subfooter */}
          <div
            className="font-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 4px',
              fontSize: '0.6875rem',
              color: '#64748b'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
              All clients authenticate with virtual API keys. Telemetry is tracked per application.
            </span>
            <span style={{ color: '#38bdf8', cursor: 'pointer' }}>
              Audit Gateway Logs ↗
            </span>
          </div>
        </div>

        {/* Right Column: Client Inspector */}
        {current && (
          <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Inspector Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1c212d', paddingBottom: '10px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316' }} />
                  <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f8fafc' }}>
                    Client Inspector
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#f8fafc', marginTop: '4px' }}>
                  {current.name}
                </div>
                <div style={{ fontSize: '0.6875rem', color: '#94a3b8', marginTop: '2px' }}>
                  {current.description || 'Registered client application connected to SLIR gateway'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }} className="font-mono">
                <span
                  style={{
                    fontSize: '0.625rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    color: '#94a3b8'
                  }}
                >
                  {current.id}
                </span>
                <div style={{ fontSize: '0.625rem', color: '#10b981', marginTop: '4px' }}>
                  Live Routing
                </div>
              </div>
            </div>

            {/* Virtual Gateway Key Card */}
            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748b' }}>
                  VIRTUAL GATEWAY KEY
                </span>
                <span style={{ fontSize: '0.625rem', color: '#94a3b8' }}>
                  Scope: Read & Execute
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#12151e', border: '1px solid #1a1e2b', padding: '6px 8px', borderRadius: '4px' }}>
                <span style={{ flex: 1, fontSize: '0.75rem', color: '#10b981', fontWeight: 600, wordBreak: 'break-all' }}>
                  {revealedKey ? current.apiKey : current.maskedApiKey}
                </span>
                <button
                  onClick={() => setRevealedKey(!revealedKey)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  title={revealedKey ? 'Hide key' : 'Reveal key'}
                >
                  {revealedKey ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                </button>
                <button
                  onClick={() => handleCopy(current.apiKey, 'key')}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  title="Copy Key"
                >
                  {copiedKey ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.625rem', color: '#64748b' }}>
                <span>Created: {new Date(current.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => setAppToRotateKey(current)}
                  style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <RotateCwIcon size={11} /> Rotate Key
                </button>
              </div>
            </div>

            {/* Model Alias Routing Hierarchy */}
            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>
                MODEL ALIAS ROUTING
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.75rem', color: '#f8fafc', fontWeight: 600 }}>
                  Alias: {current.defaultModel}
                </span>
                <span
                  style={{
                    fontSize: '0.625rem',
                    background: 'rgba(249, 115, 22, 0.15)',
                    border: '1px solid rgba(249, 115, 22, 0.3)',
                    color: '#f97316',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    fontWeight: 600
                  }}
                >
                  Active Target
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.6875rem' }}>
                <div style={{ color: '#cbd5e1' }}>
                  ↓ Primary: {current.defaultModel} ({current.defaultModel === 'active-model' ? 'Dynamic Gateway Switcher' : 'Direct Target'})
                </div>
                <div style={{ color: '#64748b' }}>
                  ↳ Base URL: {activeBaseUrl}/chat/completions
                </div>
              </div>
            </div>

            {/* Application Runtime Environment Toggle */}
            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>
                APPLICATION RUNTIME ENVIRONMENT
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                <button
                  type="button"
                  onClick={() => setEnvMode('docker')}
                  style={{
                    background: envMode === 'docker' ? 'rgba(249, 115, 22, 0.15)' : '#090b10',
                    border: `1px solid ${envMode === 'docker' ? '#f97316' : '#1e2433'}`,
                    color: envMode === 'docker' ? '#f8fafc' : '#64748b',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    fontSize: '0.6875rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontWeight: 700, color: envMode === 'docker' ? '#f97316' : '#cbd5e1' }}>Inside Docker Container</div>
                  <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>host.docker.internal:4101</div>
                </button>
                <button
                  type="button"
                  onClick={() => setEnvMode('host')}
                  style={{
                    background: envMode === 'host' ? 'rgba(249, 115, 22, 0.15)' : '#090b10',
                    border: `1px solid ${envMode === 'host' ? '#f97316' : '#1e2433'}`,
                    color: envMode === 'host' ? '#f8fafc' : '#64748b',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    fontSize: '0.6875rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontWeight: 700, color: envMode === 'host' ? '#f97316' : '#cbd5e1' }}>Host (IDE / Terminal)</div>
                  <div style={{ fontSize: '0.5625rem', color: '#64748b' }}>localhost:4101</div>
                </button>
              </div>
              <div style={{ fontSize: '0.625rem', color: '#64748b' }}>
                {envMode === 'docker'
                  ? '⚡ Containers must use host.docker.internal:4101 to reach outside to the host gateway.'
                  : '💻 Direct code running on your OS (dotnet run, python) connects via localhost:4101.'}
              </div>
            </div>

            {/* Client Integration Code Box */}
            <div style={{ background: '#0c0e14', border: '1px solid #1e2433', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748b' }}>
                  CLIENT INTEGRATION CODE
                </span>
                <button
                  onClick={() => handleCopy(getSnippet(), 'code')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    fontSize: '0.6875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {copiedCode ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: '3px', marginBottom: '8px' }}>
                {(['python', 'csharp', 'node', 'curl'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveCodeTab(tab)}
                    style={{
                      background: activeCodeTab === tab ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                      border: '1px solid',
                      borderColor: activeCodeTab === tab ? '#2b3345' : 'transparent',
                      color: activeCodeTab === tab ? '#f8fafc' : '#64748b',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.6875rem',
                      cursor: 'pointer'
                    }}
                  >
                    {tab === 'python' ? 'Python' : tab === 'csharp' ? 'C# (.NET 8)' : tab === 'node' ? 'Node.js' : 'cURL'}
                  </button>
                ))}
              </div>

              <pre style={{ margin: 0, padding: '8px', background: '#090b10', borderRadius: '4px', fontSize: '0.625rem', color: '#cbd5e1', lineHeight: 1.4, overflowX: 'auto' }}>
{getSnippet()}
              </pre>
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1c212d', paddingTop: '10px' }} className="font-mono">
              <button
                onClick={() => setAppToRotateKey(current)}
                className="mp-btn-ghost font-mono"
                style={{ fontSize: '0.6875rem', padding: '4px 10px' }}
              >
                Revoke Key
              </button>
              <button
                onClick={() => setAppToDelete(current)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fb7185',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Delete App
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Application Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(appToDelete)}
        title="Delete Application"
        message={`Are you sure you want to delete application "${appToDelete?.name}"?`}
        subMessage="Its virtual API key will be permanently revoked. Any client using this key will immediately receive 401 Unauthorized."
        confirmLabel="Delete Application"
        cancelLabel="Cancel"
        isDanger={true}
        loading={actionLoading}
        onConfirm={confirmDeleteApp}
        onClose={() => setAppToDelete(null)}
      />

      {/* Rotate Key Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(appToRotateKey)}
        title="Rotate Virtual API Key"
        message={`Generate a new Virtual API Key for "${appToRotateKey?.name}"?`}
        subMessage="The current key will be invalidated immediately. Remember to update your application config."
        confirmLabel="Rotate Key"
        cancelLabel="Cancel"
        isDanger={false}
        loading={actionLoading}
        onConfirm={confirmRotateKey}
        onClose={() => setAppToRotateKey(null)}
      />

      {/* Create App Modal */}
      <CreateAppModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          if (onApplicationsChange) onApplicationsChange();
        }}
        installedModels={installedModels}
      />
    </div>
  );
};
