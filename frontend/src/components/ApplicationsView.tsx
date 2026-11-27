import React, { useState, useEffect } from 'react';
import { ApplicationItem } from '../types/analytics';
import { fetchApplications, deleteApplication, regenerateAppKey, updateApplication } from '../api/client';
import { CreateAppModal } from './CreateAppModal';
import { ConfirmModal } from './ConfirmModal';
import { GatewayConnectionCard } from './GatewayConnectionCard';
import { InfoTip } from './InfoTip';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import { copyText } from '../utils/clipboard';
import {
  AlertTriangleIcon,
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
  onInspectAppLogs?: (appId: string) => void;
  installedModels?: string[];
}

export const ApplicationsView: React.FC<ApplicationsViewProps> = ({
  applications,
  onApplicationsChange,
  onSelectAppForPlayground,
  onInspectAppLogs,
  installedModels = ['active-model', 'qwen2.5:3b']
}) => {
  const [apps, setApps] = useState<ApplicationItem[]>(applications || []);
  const [selectedApp, setSelectedApp] = useState<ApplicationItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [revealedKey, setRevealedKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'python' | 'anthropic' | 'csharp' | 'node' | 'curl'>('python');
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(getBrowserGatewayBaseUrl());

  // Confirmation Modals State
  const [appToDelete, setAppToDelete] = useState<ApplicationItem | null>(null);
  const [appToRotateKey, setAppToRotateKey] = useState<ApplicationItem | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [routingSaving, setRoutingSaving] = useState<boolean>(false);
  const [routingFeedback, setRoutingFeedback] = useState<string | null>(null);

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

  const handleCopy = async (text: string, type: 'key' | 'url' | 'code') => {
    if (!(await copyText(text))) return;
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
      setActionError(null);
      await deleteApplication(appToDelete.id);
      const remaining = apps.filter(a => a.id !== appToDelete.id);
      setApps(remaining);
      setSelectedApp(remaining.length > 0 ? remaining[0] : null);
      if (onApplicationsChange) onApplicationsChange();
    } catch (err: any) {
      setActionError(`Failed to delete application: ${err.message}`);
    } finally {
      setActionLoading(false);
      setAppToDelete(null);
    }
  };

  const confirmRotateKey = async () => {
    if (!appToRotateKey) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const res = await regenerateAppKey(appToRotateKey.id);
      if (res.success && res.apiKey) {
        const updated = apps.map(a => a.id === appToRotateKey.id ? { ...a, apiKey: res.apiKey, maskedApiKey: res.maskedApiKey } : a);
        setApps(updated);
        setSelectedApp(prev => prev && prev.id === appToRotateKey.id ? { ...prev, apiKey: res.apiKey, maskedApiKey: res.maskedApiKey } : prev);
        if (onApplicationsChange) onApplicationsChange();
      }
    } catch (err: any) {
      setActionError(`Failed to rotate key: ${err.message}`);
    } finally {
      setActionLoading(false);
      setAppToRotateKey(null);
    }
  };

  const handleRoutingChange = async (app: ApplicationItem, defaultModel: string) => {
    setRoutingSaving(true);
    setRoutingFeedback(null);
    try {
      await updateApplication(app.id, { defaultModel });
      const updated = apps.map((candidate) => candidate.id === app.id
        ? { ...candidate, defaultModel, routingMode: defaultModel === 'active-model' ? 'global' as const : 'pinned' as const }
        : candidate);
      setApps(updated);
      setSelectedApp((prev) => prev && prev.id === app.id ? { ...prev, defaultModel } : prev);
      setRoutingFeedback(defaultModel === 'active-model'
        ? `${app.name} now follows the global model.`
        : `${app.name} pinned to ${defaultModel}.`);
      onApplicationsChange?.();
      setTimeout(() => setRoutingFeedback(null), 4000);
    } catch (err: any) {
      setRoutingFeedback(err.message || 'Failed to update routing.');
    } finally {
      setRoutingSaving(false);
    }
  };

  const current = selectedApp || (apps.length > 0 ? apps[0] : null);
  const currentKey = current?.apiKey && revealedKey ? current.apiKey : '<your-application-key>';
  const currentBaseUrl = gatewayBaseUrl;
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

      case 'anthropic': {
        const anthropicRoot = currentBaseUrl.replace(/\/v1\/?$/, '');
        return `# Official Anthropic SDK (/v1/messages)
from anthropic import Anthropic

client = Anthropic(
    base_url="${anthropicRoot}",
    api_key="${currentKey}"
)

msg = client.messages.create(
    model="${currentModel}",
    max_tokens=512,
    messages=[{"role": "user", "content": "Hello gateway!"}]
)
print(msg.content[0].text)`;
      }

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
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--mp-text-primary)' }}>
              Applications & API Clients
            </h2>
            <span
              className="font-mono"
              style={{
                fontSize: '0.6875rem',
                background: 'var(--mp-hover-bg)',
                border: '1px solid var(--mp-border)',
                padding: '2px 7px',
                borderRadius: '4px',
                color: 'var(--mp-text-secondary)'
              }}
            >
              {apps.length} listed
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--mp-text-muted)' }}>
            Manage registered client apps, virtual gateway keys, and SDK routing policies.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} className="font-mono">
          <span className="mp-muted" style={{ fontSize: '0.6875rem' }}>
            {apps.filter(a => a.defaultModel === 'active-model').length} {apps.filter(a => a.defaultModel === 'active-model').length === 1 ? 'follows' : 'follow'} global · {apps.filter(a => a.defaultModel !== 'active-model').length} pinned
          </span>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              background: 'var(--mp-orange)',
              color: 'var(--mp-btn-primary-text, #0c0e14)',
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
      {actionError && (
        <div className="mp-alert error">
          <AlertTriangleIcon size={14} />
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="mp-4stat-grid">
        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
              REGISTERED CLIENTS
            </span>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-green)' }} />
          </div>
          <div style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--mp-text-primary)', margin: '6px 0 2px 0' }} className="font-mono">
            {apps.length} <span style={{ fontSize: '0.8125rem', color: 'var(--mp-green)', fontWeight: 600 }}>Active</span>
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)' }} className="font-mono">
            {apps.filter(a => a.failoverEnabled).length} with failover enabled
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
              GATEWAY BASE URL
            </span>
            <button
              onClick={() => handleCopy(gatewayBaseUrl, 'url')}
              style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-muted)', cursor: 'pointer', padding: 0 }}
              title="Copy Base URL"
            >
              {copiedUrl ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--mp-text-primary)', margin: '6px 0 2px 0' }} className="font-mono">
            {gatewayBaseUrl}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)' }} className="font-mono">
            OpenAI &amp; Anthropic /v1 API
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
              TOTAL GATEWAY REQS
            </span>
            <span style={{ fontSize: '0.6875rem', color: 'var(--mp-green)' }} className="font-mono">
              {totalAppsReqs > 0 ? 'Active' : 'Idle'}
            </span>
          </div>
          <div style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--mp-text-primary)', margin: '6px 0 2px 0' }} className="font-mono">
            {totalAppsReqs.toLocaleString()} <span style={{ fontSize: '0.8125rem', color: 'var(--mp-text-secondary)' }}>reqs</span>
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)' }} className="font-mono">
            {totalAppsTokens > 0 ? `${totalAppsTokens.toLocaleString()} tokens total` : 'Ready for traffic'}
          </div>
        </div>

        <div className="mp-stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mp-label-with-tip" style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
              <span>SELECTED APP ROUTING</span>
              <InfoTip
                title="Global vs Pinned Routing"
                text="SLIR ignores any model configured in your SDK and always routes via SLIR's selected model. Global follows the shared Global Fallback; Pinned locks this app to one specific model."
              />
            </span>
            <InfoTip
              title={currentModel === 'active-model' ? 'Global routing' : 'Pinned routing'}
              text={
                currentModel === 'active-model'
                  ? 'Follows the shared Global Fallback model. Changing the global model updates this app automatically.'
                  : `Locked ("pinned") to ${currentModel}. Global model changes do not affect this app.`
              }
            >
              <span
                style={{
                  fontSize: '0.625rem',
                  background: 'var(--mp-hover-bg)',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  color: 'var(--mp-text-secondary)'
                }}
                className="font-mono"
              >
                {currentModel === 'active-model' ? 'Global' : 'Pinned'}
              </span>
            </InfoTip>
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--mp-text-primary)', margin: '6px 0 2px 0' }} className="font-mono">
            {currentModel}
          </div>
          <div style={{ fontSize: '0.6875rem', color: currentModel === 'active-model' ? 'var(--mp-cyan)' : 'var(--mp-orange)' }} className="font-mono">
            {currentModel === 'active-model' ? 'Follows the global fallback' : 'Pinned to a specific model'}
          </div>
        </div>
      </div>

      {/* 3. 2-Column Main Workspace */}
      <div className="mp-apps-grid">
        {/* Left Column: Active Deployments List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--mp-text-primary)' }}>
              Active Deployments
            </span>
            <span className="font-mono" style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)' }}>
              Newest first
            </span>
          </div>

          {apps.length === 0 ? (
            <div className="mp-card" style={{ padding: '36px 16px', textAlign: 'center' }}>
              <div style={{ color: 'var(--mp-text-primary)', fontWeight: 600, fontSize: '0.875rem' }}>No client applications registered</div>
              <p style={{ margin: '4px 0 12px 0', fontSize: '0.75rem', color: 'var(--mp-text-muted)' }}>
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
                  onClick={() => {
                    setSelectedApp(app);
                    setRevealedKey(false);
                  }}
                  className="mp-card"
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'var(--mp-bg-subtle)' : 'var(--mp-bg-card)',
                    borderColor: isSelected ? 'var(--mp-orange)' : 'var(--mp-border)',
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
                          color: 'var(--mp-orange)',
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
                          <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--mp-text-primary)' }}>
                            {app.name}
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.625rem',
                              color: 'var(--mp-green)',
                              background: 'rgba(16, 185, 129, 0.12)',
                              padding: '1px 5px',
                              borderRadius: '3px'
                            }}
                          >
                            ● Active
                          </span>
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>
                          {app.id} · Created {new Date(app.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="font-mono" style={{ fontSize: '0.6875rem', color: isSelected ? 'var(--mp-orange)' : 'var(--mp-text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
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
                      background: 'var(--mp-surface-input)',
                      border: '1px solid var(--mp-border-subtle)',
                      borderRadius: '6px',
                      padding: '8px 10px'
                    }}
                    className="font-mono"
                  >
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>MODEL ALIAS</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-secondary)', fontWeight: 600, marginTop: '1px' }}>
                        {app.defaultModel}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>24H REQS</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-primary)', fontWeight: 700, marginTop: '1px' }}>
                        {app.totalRequests ? app.totalRequests.toLocaleString() : '0'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: app.failedRequests && app.failedRequests > 0 ? 'var(--mp-red)' : 'var(--mp-green)' }}>
                        {app.totalRequests > 0
                          ? `${Math.round(((app.totalRequests - (app.failedRequests || 0)) / app.totalRequests) * 100)}% ok`
                          : 'No Traffic'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>TOKENS</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-primary)', fontWeight: 700, marginTop: '1px' }}>
                        {app.totalTokens ? app.totalTokens.toLocaleString() : '0'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>
                        {app.lastActive ? new Date(app.lastActive).toLocaleDateString() : 'No reqs yet'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>ROUTED COST</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--mp-green)', fontWeight: 700, marginTop: '1px' }}>
                        ${app.totalCost ? app.totalCost.toFixed(4) : '0.0000'}
                      </div>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>
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
              color: 'var(--mp-text-muted)'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--mp-green)' }} />
              All clients authenticate with virtual API keys. Telemetry is tracked per application.
            </span>
            <button
              type="button"
              onClick={() => onInspectAppLogs?.(current?.id || '')}
              className="mp-link-btn"
              style={{ fontSize: '0.6875rem' }}
            >
              Audit Gateway Logs ↗
            </button>
          </div>
        </div>

        {/* Right Column: Client Inspector */}
        {current && (
          <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Inspector Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--mp-border-subtle)', paddingBottom: '10px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-orange)' }} />
                  <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--mp-text-primary)' }}>
                    Client Inspector
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--mp-text-primary)', marginTop: '4px' }}>
                  {current.name}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-secondary)', marginTop: '2px' }}>
                  {current.description || 'Registered client application connected to SLIR gateway'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }} className="font-mono">
                <span
                  style={{
                    fontSize: '0.625rem',
                    background: 'var(--mp-hover-bg)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    color: 'var(--mp-text-secondary)'
                  }}
                >
                  {current.id}
                </span>
                <div style={{ fontSize: '0.625rem', color: 'var(--mp-green)', marginTop: '4px' }}>
                  Live Routing
                </div>
              </div>
            </div>

            {/* Virtual Gateway Key Card */}
            <div style={{ background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="mp-label-with-tip" style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
                  <span>VIRTUAL GATEWAY KEY</span>
                  <InfoTip
                    title="Virtual Gateway Key"
                    text="Send this Bearer token in your app's Authorization header (or OpenAI SDK api_key). SLIR uses it to identify the app, track usage/costs, and apply routing & failover rules."
                  />
                </span>
                <span style={{ fontSize: '0.625rem', color: 'var(--mp-text-secondary)' }}>
                  Hidden until revealed
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--mp-bg-card)', border: '1px solid var(--mp-border-subtle)', padding: '6px 8px', borderRadius: '4px' }}>
                <span style={{ flex: 1, fontSize: '0.75rem', color: 'var(--mp-green)', fontWeight: 600, wordBreak: 'break-all' }}>
                  {revealedKey ? current.apiKey : current.maskedApiKey}
                </span>
                <button
                  onClick={() => setRevealedKey(!revealedKey)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-secondary)', cursor: 'pointer', padding: 0 }}
                  title={revealedKey ? 'Hide key' : 'Reveal key'}
                >
                  {revealedKey ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                </button>
                <button
                  onClick={() => handleCopy(current.apiKey, 'key')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-secondary)', cursor: 'pointer', padding: 0 }}
                  title="Copy Key"
                >
                  {copiedKey ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>
                <span>Created: {new Date(current.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => setAppToRotateKey(current)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <RotateCwIcon size={11} /> Rotate Key
                </button>
              </div>
            </div>

            {/* Model routing for this application */}
            <div style={{ background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="mp-label-with-tip" style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
                  <span>MODEL ROUTING</span>
                  <InfoTip
                    title="Application Default Model"
                    text="'Follow global fallback' lets you switch models from the Models tab for all unpinned apps at once. 'Pin to <model>' locks this app to one model regardless of global changes."
                  />
                </span>
                <InfoTip
                  title={current.defaultModel === 'active-model' ? 'Global fallback' : 'Pinned model'}
                  text={
                    current.defaultModel === 'active-model'
                      ? 'All requests from this app follow the shared Global Fallback, ignoring any model configured in the SDK.'
                      : `All requests from this app are locked to ${current.defaultModel}, ignoring any model configured in the SDK.`
                  }
                >
                  <span className={`mp-badge ${current.defaultModel === 'active-model' ? 'neutral' : 'warn'}`}>
                    {current.defaultModel === 'active-model' ? 'Global fallback' : 'Pinned'}
                  </span>
                </InfoTip>
              </div>
              <select
                className="mp-select font-mono"
                value={current.defaultModel}
                onChange={(e) => handleRoutingChange(current, e.target.value)}
                disabled={routingSaving}
                style={{ width: '100%', fontSize: '0.75rem', padding: '5px 8px' }}
              >
                <option value="active-model">Follow global fallback</option>
                {installedModels.filter((model) => model !== 'active-model').map((model) => (
                  <option key={model} value={model}>Pin to {model}</option>
                ))}
                {current.defaultModel !== 'active-model' && !installedModels.includes(current.defaultModel) && (
                  <option value={current.defaultModel}>{current.defaultModel} (unavailable)</option>
                )}
              </select>
              <div style={{ marginTop: '6px', fontSize: '0.625rem', color: routingFeedback ? 'var(--mp-text-secondary)' : 'var(--mp-text-muted)' }}>
                {routingFeedback || (current.defaultModel === 'active-model'
                  ? 'All SDK requests for this app resolve to the global fallback (SDK model is ignored).'
                  : `All SDK requests for this app resolve to ${current.defaultModel} (SDK model is ignored).`)}
              </div>
            </div>

            <GatewayConnectionCard value={gatewayBaseUrl} onChange={setGatewayBaseUrl} compact />

            {/* Client Integration Code Box */}
            <div style={{ background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', padding: '10px' }} className="font-mono">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--mp-text-muted)' }}>
                  CLIENT INTEGRATION CODE
                </span>
                <button
                  onClick={() => handleCopy(getSnippet(), 'code')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mp-orange)',
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
              <div style={{ display: 'flex', gap: '3px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {(['python', 'anthropic', 'csharp', 'node', 'curl'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveCodeTab(tab)}
                    style={{
                      background: activeCodeTab === tab ? 'var(--mp-surface-hover)' : 'transparent',
                      border: '1px solid',
                      borderColor: activeCodeTab === tab ? 'var(--mp-border-strong)' : 'transparent',
                      color: activeCodeTab === tab ? 'var(--mp-text-primary)' : 'var(--mp-text-muted)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.6875rem',
                      cursor: 'pointer'
                    }}
                  >
                    {tab === 'python'
                      ? 'Python (OpenAI)'
                      : tab === 'anthropic'
                        ? 'Python (Anthropic)'
                        : tab === 'csharp'
                          ? 'C# (.NET 8)'
                          : tab === 'node'
                            ? 'Node.js'
                            : 'cURL'}
                  </button>
                ))}
              </div>

              {!revealedKey && (
                <div style={{ marginBottom: '6px', fontSize: '0.5625rem', color: 'var(--mp-text-muted)' }}>
                  Reveal the virtual key above to embed it in this snippet.
                </div>
              )}

              <pre style={{ margin: 0, padding: '8px', background: 'var(--mp-surface-input)', borderRadius: '4px', fontSize: '0.625rem', color: 'var(--mp-text-secondary)', lineHeight: 1.4, overflowX: 'auto' }}>
{getSnippet()}
              </pre>
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--mp-border-subtle)', paddingTop: '10px' }} className="font-mono">
              <button
                onClick={() => setAppToRotateKey(current)}
                className="mp-btn-ghost font-mono"
                style={{ fontSize: '0.6875rem', padding: '4px 10px' }}
              >
                Rotate key
              </button>
              <button
                onClick={() => setAppToDelete(current)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--mp-red)',
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
