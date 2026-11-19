import React, { useEffect, useMemo, useState } from 'react';
import { fetchGatewayConfig, getGatewayConnectionOptions, type GatewayTarget } from '../utils/gatewayConnection';
import { copyText } from '../utils/clipboard';
import { ChevronDownIcon, CopyIcon, CheckIcon } from './icons/Icons';

interface GatewayConnectionCardProps {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  label?: string;
}

export const GatewayConnectionCard: React.FC<GatewayConnectionCardProps> = ({
  value,
  onChange,
  compact = false,
  label = 'Gateway Base URL'
}) => {
  const [config, setConfig] = useState<{ publicBaseUrl: string | null; gatewayPort: number } | null>(null);
  const [selectedMode, setSelectedMode] = useState<GatewayTarget>('host');
  const [showDocker, setShowDocker] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const options = useMemo(
    () => getGatewayConnectionOptions(config?.gatewayPort),
    [config?.gatewayPort]
  );

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchGatewayConfig().then((cfg) => {
        if (active) setConfig(cfg);
      });
    };
    load();
    const interval = setInterval(load, 30 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const publicBaseUrl = config?.publicBaseUrl ?? null;
  const resolved = publicBaseUrl ?? options.find((o) => o.target === selectedMode)?.url ?? value;

  useEffect(() => {
    onChange(resolved);
  }, [resolved, onChange]);

  const copyUrl = async () => {
    const ok = await copyText(resolved);
    setCopyState(ok ? 'copied' : 'error');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const selectedOption = options.find((o) => o.target === selectedMode) ?? options[0];

  if (publicBaseUrl) {
    return (
      <div className={`mp-gateway-connection ${compact ? 'compact' : ''}`}>
        <div className="mp-field">
          <span className="mp-field-label">{label}</span>
          <div className="mp-gateway-url-row">
            <input
              type="text"
              readOnly
              value={resolved}
              className="mp-input font-mono"
              style={{ background: 'var(--mp-surface-input)', color: 'var(--mp-cyan)', fontSize: '0.8125rem' }}
            />
            <button
              type="button"
              className="mp-btn mp-btn-primary font-mono"
              onClick={copyUrl}
              style={{ padding: '0 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              {copyState === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              <span>{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy URL'}</span>
            </button>
          </div>
        </div>
        <div className="mp-gateway-connection-hint" style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginTop: '6px' }}>
          Configured by SLIR_PUBLIC_BASE_URL. This is the single endpoint for all clients.
        </div>
      </div>
    );
  }

  return (
    <div className={`mp-gateway-connection ${compact ? 'compact' : ''}`}>
      <div className="mp-field">
        <span className="mp-field-label">{label}</span>
        <div className="mp-gateway-url-row">
          <input
            type="text"
            readOnly
            value={resolved}
            className="mp-input font-mono"
            style={{ background: 'var(--mp-surface-input)', color: 'var(--mp-cyan)', fontSize: '0.8125rem' }}
          />
          <button
            type="button"
            className="mp-btn mp-btn-primary font-mono"
            onClick={copyUrl}
            style={{ padding: '0 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            {copyState === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            <span>{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy URL'}</span>
          </button>
        </div>
      </div>
      <div className="mp-gateway-connection-hint" style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)', marginTop: '6px' }}>
        {selectedOption.hint}
      </div>
      <button
        type="button"
        className="mp-gateway-docker-toggle"
        onClick={() => setShowDocker((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '8px',
          padding: '6px 10px',
          border: '1px solid var(--mp-border)',
          borderRadius: '6px',
          background: 'var(--mp-surface-input)',
          color: 'var(--mp-text-secondary)',
          fontSize: '0.6875rem',
          cursor: 'pointer'
        }}
      >
        <span>Connecting from Docker?</span>
        <ChevronDownIcon size={10} style={{ transition: 'transform 0.15s', transform: showDocker ? 'rotate(180deg)' : 'rotate(0)' }} />
      </button>
      {showDocker && (
        <div className="mp-gateway-options" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {options.map((option) => (
            <button
              key={option.target}
              type="button"
              onClick={() => setSelectedMode(option.target)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '8px 10px',
                border: `1px solid ${selectedMode === option.target ? 'var(--mp-orange)' : 'var(--mp-border)'}`,
                borderRadius: '6px',
                background: selectedMode === option.target ? 'rgba(249, 115, 22, 0.1)' : 'var(--mp-bg-card)',
                color: selectedMode === option.target ? 'var(--mp-text-primary)' : 'var(--mp-text-secondary)',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <strong>{option.label}</strong>
                <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-text-muted)' }}>{option.url}</span>
              </div>
              {selectedMode === option.target ? (
                <span style={{ color: 'var(--mp-green)', fontSize: '0.5625rem', fontWeight: 600 }}>Selected</span>
              ) : (
                <span style={{ color: 'var(--mp-orange)', fontSize: '0.5625rem', fontWeight: 600 }}>Use</span>
              )}
            </button>
          ))}
          <p style={{ fontSize: '0.5625rem', color: 'var(--mp-text-muted)', lineHeight: 1.4, marginTop: '4px' }}>
            Linux containers may need <code>extra_hosts: ["host.docker.internal:host-gateway"]</code>. If SLIR and your app are in the same Compose project, prefer the service URL.
          </p>
        </div>
      )}
    </div>
  );
};