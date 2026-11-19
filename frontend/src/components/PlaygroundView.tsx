import React, { useState } from 'react';
import { TestPromptResult, ApplicationItem } from '../types/analytics';
import { runTestPromptBenchmark } from '../api/client';
import { copyText } from '../utils/clipboard';
import { getBrowserGatewayBaseUrl } from '../utils/gatewayConnection';
import {
  CopyIcon,
  CheckIcon,
  PlayIcon,
  RotateCwIcon
} from './icons/Icons';

interface PlaygroundViewProps {
  installedModels?: string[];
  applications?: ApplicationItem[];
  activeModel?: string;
  gatewayPort?: number;
  onBenchmarkComplete?: () => void;
}

const PRESETS = [
  {
    id: 'diag',
    label: 'System Diagnosis',
    system: 'You are an elite Postgres query optimizer and systems architect. Return concise JSON remediation with root causes and optimized index DDL.',
    prompt: `EXPLAIN (ANALYZE, BUFFERS)\nSELECT o.id, o.tenant_id, COUNT(i.id) AS item_count, SUM(i.price_cents) AS total_val\nFROM orders o\nJOIN order_items i ON o.id = i.order_id\nWHERE o.tenant_id = 'org_99x81' AND o.created_at >= NOW() - INTERVAL '48 hours'\nGROUP BY o.id, o.tenant_id\nORDER BY total_val DESC`
  },
  {
    id: 'json',
    label: 'JSON Structured',
    system: 'You must respond strictly in JSON format matching keys: equipment, status, risk_level, recommendations.',
    prompt: 'Sensor motor bearing vibration measured 6.8 mm/s RMS on drive-end with high-frequency peak at 2.4 kHz. Analyze severity.'
  },
  {
    id: 'code',
    label: 'Code Explanation',
    system: 'You are a high-speed systems engineer.',
    prompt: 'Explain the difference between SQLite WAL mode and traditional rollback journal in 3 concise bullet points.'
  },
  {
    id: 'speed',
    label: 'Speed Benchmark',
    system: 'You are a high-throughput LLM benchmark worker.',
    prompt: 'Write an asynchronous Python function to stream tokens from the local gateway with exponential backoff.'
  }
];

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  installedModels = ['active-model', 'qwen2.5:3b'],
  applications = [],
  activeModel = 'qwen2.5:3b',
  gatewayPort,
  onBenchmarkComplete
}) => {
  const [mode, setMode] = useState<'single' | 'compare'>('compare');
  const [modelA, setModelA] = useState<string>('active-model');
  const [modelB, setModelB] = useState<string>(installedModels.find(m => m.includes('groq') || m.includes('llama') || m !== 'active-model') || 'qwen2.5:3b');
  const [systemContext, setSystemContext] = useState<string>(PRESETS[0].system);
  const [userPrompt, setUserPrompt] = useState<string>(PRESETS[0].prompt);
  const [temperature, setTemperature] = useState<number>(0.2);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  const [isStreamOn, setIsStreamOn] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [resultA, setResultA] = useState<TestPromptResult | null>(null);
  const [resultB, setResultB] = useState<TestPromptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);
  const [copiedOutputA, setCopiedOutputA] = useState<boolean>(false);
  const [copiedOutputB, setCopiedOutputB] = useState<boolean>(false);

  const sysTokens = Math.max(1, Math.round(systemContext.length / 4));
  const userTokens = Math.max(1, Math.round(userPrompt.length / 4));
  const totalTokens = sysTokens + userTokens;

  const handleSelectPreset = (p: typeof PRESETS[0]) => {
    setSystemContext(p.system);
    setUserPrompt(p.prompt);
  };

  const handleRunInference = async () => {
    if (!userPrompt.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      const fullPrompt = systemContext ? `System: ${systemContext}\n\nUser: ${userPrompt}` : userPrompt;
      const inferenceOptions = { temperature, maxTokens, stream: isStreamOn };

      if (mode === 'single') {
        const res = await runTestPromptBenchmark(modelA, fullPrompt, inferenceOptions);
        setResultA(res);
      } else {
        const [resA, resB] = await Promise.all([
          runTestPromptBenchmark(modelA, fullPrompt, inferenceOptions).catch(err => ({
            success: false,
            model: modelA,
            content: `Inference failed: ${err.message}`,
            latencyMs: 0,
            tokensPerSec: 0,
            usage: { promptTokens: totalTokens, completionTokens: 0, totalTokens }
          } as TestPromptResult)),
          runTestPromptBenchmark(modelB, fullPrompt, inferenceOptions).catch(err => ({
            success: false,
            model: modelB,
            content: `Inference failed: ${err.message}`,
            latencyMs: 0,
            tokensPerSec: 0,
            usage: { promptTokens: totalTokens, completionTokens: 0, totalTokens }
          } as TestPromptResult))
        ]);
        setResultA(resA);
        setResultB(resB);
      }

      if (onBenchmarkComplete) onBenchmarkComplete();
    } catch (err: any) {
      setError(err.message || 'Execution failed');
    } finally {
      setRunning(false);
    }
  };

  const copyCurl = async () => {
    const curl = `curl ${getBrowserGatewayBaseUrl(gatewayPort)}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $SLIR_APP_KEY" \\\n  -d '{\n    "model": "${modelA}",\n    "messages": [\n      {"role": "system", "content": ${JSON.stringify(systemContext)}},\n      {"role": "user", "content": ${JSON.stringify(userPrompt)}}\n    ],\n    "temperature": ${temperature},
    "max_tokens": ${maxTokens}\n  }'`;
    if (!(await copyText(curl))) return;
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const copyContent = async (content: string | undefined, setter: (value: boolean) => void) => {
    if (!(await copyText(content || ''))) return;
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. Header & Controls Bar */}
      <div
        className="mp-card"
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Single / Compare Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--mp-surface-input)',
              border: '1px solid var(--mp-border)',
              borderRadius: '6px',
              padding: '2px'
            }}
            className="font-mono"
          >
            <button
              onClick={() => setMode('single')}
              style={{
                background: mode === 'single' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                color: mode === 'single' ? 'var(--mp-text-primary)' : 'var(--mp-text-muted)',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                fontWeight: mode === 'single' ? 600 : 400
              }}
            >
              Single Model
            </button>
            <button
              onClick={() => setMode('compare')}
              style={{
                background: mode === 'compare' ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
                border: 'none',
                color: mode === 'compare' ? 'var(--mp-orange)' : 'var(--mp-text-muted)',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                fontWeight: mode === 'compare' ? 700 : 400
              }}
            >
              Compare Models A/B
            </button>
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)', fontWeight: 600 }}>PRESETS:</span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--mp-border)',
                  color: 'var(--mp-text-secondary)',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                  cursor: 'pointer'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders & Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }} className="font-mono">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.6875rem' }}>
            <span style={{ color: 'var(--mp-text-muted)' }}>TEMP</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ width: '60px', accentColor: 'var(--mp-orange)', cursor: 'pointer' }}
            />
            <span style={{ color: 'var(--mp-orange)', minWidth: '24px' }}>{temperature.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.6875rem' }}>
            <span style={{ color: 'var(--mp-text-muted)' }}>MAX TOKENS</span>
            <input
              type="number"
              min={1}
              max={8192}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: '70px', background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', color: 'var(--mp-text-primary)', fontSize: '0.6875rem', padding: '2px 6px' }}
            />
          </div>

          <button
            onClick={() => setIsStreamOn(!isStreamOn)}
            style={{
              background: isStreamOn ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
              border: `1px solid ${isStreamOn ? 'rgba(16, 185, 129, 0.3)' : 'var(--mp-border)'}`,
              color: isStreamOn ? 'var(--mp-green)' : 'var(--mp-text-muted)',
              padding: '2px 7px',
              borderRadius: '4px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isStreamOn ? 'var(--mp-green)' : 'var(--mp-text-muted)' }} />
            STREAM REQUEST {isStreamOn ? 'ON' : 'OFF'}
          </button>

          <span style={{ fontSize: '0.625rem', color: 'var(--mp-green)' }}>
            Prompts stay in memory
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.25)', color: 'var(--mp-red)', padding: '8px 14px', borderRadius: '6px', fontSize: '0.75rem' }}>
          {error}
        </div>
      )}

      {/* 2. Main Dual Matrix Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '16px' }}>
        {/* Left Pane: Payload Construction */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--mp-text-primary)' }}>
                Payload Construction
              </span>
              <span className="font-mono" style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)' }}>
                ~{totalTokens} est. tokens
              </span>
            </div>

            {/* System Context */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }} className="font-mono">
                <span style={{ fontSize: '0.625rem', color: 'var(--mp-text-secondary)', fontWeight: 600 }}>● SYSTEM CONTEXT</span>
                <span style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>~{sysTokens} tok</span>
              </div>
              <textarea
                value={systemContext}
                onChange={(e) => setSystemContext(e.target.value)}
                rows={4}
                className="font-mono"
                style={{
                  width: '100%',
                  background: 'var(--mp-surface-input)',
                  border: '1px solid var(--mp-border)',
                  borderRadius: '6px',
                  color: 'var(--mp-text-secondary)',
                  fontSize: '0.6875rem',
                  padding: '8px',
                  resize: 'vertical',
                  outline: 'none'
                }}
              />
            </div>

            {/* User Prompt */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }} className="font-mono">
                <span style={{ fontSize: '0.625rem', color: 'var(--mp-orange)', fontWeight: 600 }}>● USER PROMPT / PAYLOAD</span>
                <span style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>~{userTokens} tok</span>
              </div>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={9}
                className="font-mono"
                style={{
                  width: '100%',
                  background: 'var(--mp-surface-input)',
                  border: '1px solid var(--mp-border)',
                  borderRadius: '6px',
                  color: 'var(--mp-text-secondary)',
                  fontSize: '0.6875rem',
                  padding: '8px',
                  resize: 'vertical',
                  outline: 'none',
                  lineHeight: 1.4
                }}
              />
            </div>
          </div>

          {/* Action Row */}
          <div>
            <div
              className="font-mono"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.625rem',
                color: 'var(--mp-text-muted)',
                padding: '8px 0',
                borderTop: '1px solid var(--mp-border-subtle)',
                marginTop: '10px'
              }}
            >
              <span>Endpoint: /v1/chat/completions</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} className="font-mono">
              <button
                onClick={handleRunInference}
                disabled={running}
                style={{
                  flex: 1,
                  background: 'var(--mp-orange)',
                  color: '#0c0e14',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: running ? 'not-allowed' : 'pointer',
                  opacity: running ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <PlayIcon size={12} />
                <span>{running ? 'Running...' : 'Run Inference ↵'}</span>
              </button>

              <button
                onClick={() => {
                  setSystemContext(PRESETS[0].system);
                  setUserPrompt(PRESETS[0].prompt);
                  setResultA(null);
                  setResultB(null);
                }}
                className="mp-btn-ghost font-mono"
                style={{ fontSize: '0.75rem', padding: '7px 10px' }}
                title="Reset Prompt"
              >
                Reset
              </button>

              <button
                onClick={copyCurl}
                className="mp-btn-ghost font-mono"
                style={{ fontSize: '0.75rem', padding: '7px 10px' }}
                title="Copy as cURL"
              >
                {copiedCurl ? <CheckIcon size={12} /> : <span>cURL</span>}
              </button>
            </div>
          </div>
        </div>

        {/* Right Pane: Dual/Single Inference Matrix */}
        <div className="mp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Top Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-green)' }} />
                <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--mp-text-primary)' }}>
                  {mode === 'compare' ? 'Dual Inference Matrix' : 'Single Inference Trace'}
                </span>
                <span className="font-mono" style={{ fontSize: '0.6875rem', color: 'var(--mp-green)' }}>
                  ● Direct Model Response
                </span>
              </div>

            </div>

            {/* Model Columns Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: mode === 'compare' ? '1fr 1fr' : '1fr', gap: '12px' }}>
              {/* Column A */}
              <div style={{ background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', overflow: 'hidden' }}>
                {/* Column A Header */}
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--mp-border-subtle)', background: 'var(--mp-bg-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-orange)' }} />
                      <select
                        value={modelA}
                        onChange={(e) => setModelA(e.target.value)}
                        className="mp-select font-mono"
                        style={{ fontSize: '0.75rem', padding: '2px 6px', fontWeight: 700 }}
                      >
                        <option value="active-model">active-model (Current Target)</option>
                        {installedModels.filter(m => m !== 'active-model').map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-text-secondary)', background: 'rgba(148, 163, 184, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                      TARGET A
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--mp-text-muted)', flexWrap: 'wrap', gap: '6px' }} className="font-mono">
                    <span>COLD: <strong style={{ color: resultA?.loadMs && resultA.loadMs > 1000 ? 'var(--mp-red)' : 'var(--mp-text-primary)' }}>{resultA ? (resultA.loadMs ? `${(resultA.loadMs / 1000).toFixed(1)}s` : '0ms') : '--'}</strong></span>
                    <span>KV: <strong style={{ color: 'var(--mp-cyan)' }}>{resultA?.promptEvalMs ? `${Math.round(resultA.promptEvalMs)}ms` : '--'}</strong></span>
                    <span>GEN: <strong style={{ color: 'var(--mp-green)' }}>{resultA?.evalMs ? `${Math.round(resultA.evalMs)}ms` : '--'}</strong></span>
                    <span>SPEED: <strong style={{ color: 'var(--mp-text-primary)' }}>{resultA?.tokensPerSec ? `${Math.round(resultA.tokensPerSec * 10) / 10} t/s` : '--'}</strong></span>
                    <span>TOTAL: <strong style={{ color: 'var(--mp-text-primary)' }}>{resultA?.latencyMs ? (resultA.latencyMs >= 1000 ? `${(resultA.latencyMs / 1000).toFixed(1)}s` : `${Math.round(resultA.latencyMs)}ms`) : '--'}</strong></span>
                  </div>
                </div>

                {/* Column A Output Terminal */}
                <div style={{ padding: '10px', height: '220px', overflowY: 'auto' }} className="font-mono">
                  <div style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginBottom: '6px' }}>
                    {resultA ? `--- [INFERENCE COMPLETED IN ${Math.round(resultA.latencyMs)}ms] ---` : '--- [READY FOR INFERENCE] ---'}
                  </div>
                  <pre style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--mp-text-secondary)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
{resultA?.content || 'Click "Run Inference" to execute prompt against this model...'}
                  </pre>
                </div>

                {/* Column A Footer */}
                <div style={{ padding: '6px 10px', borderTop: '1px solid var(--mp-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.625rem', color: 'var(--mp-text-muted)' }} className="font-mono">
                  <span>Target: {modelA}</span>
                  <button
                    onClick={() => {
                      copyContent(resultA?.content, setCopiedOutputA);
                      setCopiedOutputA(true);
                      setTimeout(() => setCopiedOutputA(false), 2000);
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                  >
                    {copiedOutputA ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                    <span>{copiedOutputA ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Column B (When in Compare Mode) */}
              {mode === 'compare' && (
                <div style={{ background: 'var(--mp-surface-input)', border: '1px solid var(--mp-border)', borderRadius: '6px', overflow: 'hidden' }}>
                  {/* Column B Header */}
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--mp-border-subtle)', background: 'var(--mp-bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mp-green)' }} />
                        <select
                          value={modelB}
                          onChange={(e) => setModelB(e.target.value)}
                          className="mp-select font-mono"
                          style={{ fontSize: '0.75rem', padding: '2px 6px', fontWeight: 700 }}
                        >
                          {installedModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-text-secondary)', background: 'rgba(148, 163, 184, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                        TARGET B
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--mp-text-muted)', flexWrap: 'wrap', gap: '6px' }} className="font-mono">
                      <span>COLD: <strong style={{ color: resultB?.loadMs && resultB.loadMs > 1000 ? 'var(--mp-red)' : 'var(--mp-text-primary)' }}>{resultB ? (resultB.loadMs ? `${(resultB.loadMs / 1000).toFixed(1)}s` : '0ms') : '--'}</strong></span>
                      <span>KV: <strong style={{ color: 'var(--mp-cyan)' }}>{resultB?.promptEvalMs ? `${Math.round(resultB.promptEvalMs)}ms` : '--'}</strong></span>
                      <span>GEN: <strong style={{ color: 'var(--mp-green)' }}>{resultB?.evalMs ? `${Math.round(resultB.evalMs)}ms` : '--'}</strong></span>
                      <span>SPEED: <strong style={{ color: 'var(--mp-text-primary)' }}>{resultB?.tokensPerSec ? `${Math.round(resultB.tokensPerSec * 10) / 10} t/s` : '--'}</strong></span>
                      <span>TOTAL: <strong style={{ color: 'var(--mp-text-primary)' }}>{resultB?.latencyMs ? (resultB.latencyMs >= 1000 ? `${(resultB.latencyMs / 1000).toFixed(1)}s` : `${Math.round(resultB.latencyMs)}ms`) : '--'}</strong></span>
                    </div>
                  </div>

                  {/* Column B Output Terminal */}
                  <div style={{ padding: '10px', height: '220px', overflowY: 'auto' }} className="font-mono">
                    <div style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginBottom: '6px' }}>
                      {resultB ? `--- [INFERENCE COMPLETED IN ${Math.round(resultB.latencyMs)}ms] ---` : '--- [READY FOR INFERENCE] ---'}
                    </div>
                    <pre style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--mp-text-secondary)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
{resultB?.content || 'Click "Run Inference" to execute prompt against this model...'}
                    </pre>
                  </div>

                  {/* Column B Footer */}
                  <div style={{ padding: '6px 10px', borderTop: '1px solid var(--mp-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.625rem', color: 'var(--mp-text-muted)' }} className="font-mono">
                    <span>Target: {modelB}</span>
                    <button
                      onClick={() => {
                        copyContent(resultB?.content, setCopiedOutputB);
                        setCopiedOutputB(true);
                        setTimeout(() => setCopiedOutputB(false), 2000);
                      }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--mp-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      {copiedOutputB ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                      <span>{copiedOutputB ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Diagnostics Strip */}
          <div style={{ marginTop: '14px', borderTop: '1px solid var(--mp-border-subtle)', paddingTop: '10px' }} className="font-mono">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6875rem', marginBottom: '6px' }}>
              <span style={{ color: 'var(--mp-text-secondary)', fontWeight: 600 }}>Latency vs Throughput Differential</span>
              <span style={{ color: 'var(--mp-green)' }}>
                {resultA && resultB 
                  ? (resultA.latencyMs < resultB.latencyMs 
                      ? `${modelA} is ${(resultB.latencyMs / (resultA.latencyMs || 1)).toFixed(1)}x faster` 
                      : `${modelB} is ${(resultA.latencyMs / (resultB.latencyMs || 1)).toFixed(1)}x faster`)
                  : 'Run A/B inference to compare model speed and latency'}
              </span>
            </div>

            {/* Differential Dual Progress Bars */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginBottom: '2px' }}>
                  <span>{modelA}</span>
                  <span style={{ color: 'var(--mp-orange)' }}>
                    {resultA ? `${resultA.tokensPerSec ? Math.round(resultA.tokensPerSec) : 0} t/s (${Math.round(resultA.latencyMs)}ms)` : '--'}
                  </span>
                </div>
                <div style={{ height: '4px', background: 'var(--mp-border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.max(5, (resultA?.tokensPerSec || 0) / 2))}%`, height: '100%', background: 'var(--mp-orange)' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginBottom: '2px' }}>
                  <span>{modelB}</span>
                  <span style={{ color: 'var(--mp-green)' }}>
                    {resultB ? `${resultB.tokensPerSec ? Math.round(resultB.tokensPerSec) : 0} t/s (${Math.round(resultB.latencyMs)}ms)` : '--'}
                  </span>
                </div>
                <div style={{ height: '4px', background: 'var(--mp-border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.max(5, (resultB?.tokensPerSec || 0) / 2))}%`, height: '100%', background: 'var(--mp-green)' }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>
              <span>
                Payload: ~{totalTokens} est. tokens · Response A: {resultA?.usage?.completionTokens || 0} tokens · Response B: {resultB?.usage?.completionTokens || 0} tokens
              </span>
              <span>Only telemetry is stored</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
