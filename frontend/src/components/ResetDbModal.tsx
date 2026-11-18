import React, { useState } from 'react';
import { clearDatabase } from '../api/client';
import { CloseIcon, AlertTriangleIcon, RotateCwIcon, CheckIcon } from './icons/Icons';

interface ResetDbModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: { deletedEvents: number; deletedApps: number; message: string; clearApps: boolean; reseedDefault: boolean }) => void;
  onResetSuccess?: (result: { deletedEvents: number; deletedApps: number; message: string; clearApps: boolean; reseedDefault: boolean }) => void;
  appsCount?: number;
  totalRequests?: number;
}

export const ResetDbModal: React.FC<ResetDbModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onResetSuccess,
  appsCount = 0,
  totalRequests = 0
}) => {
  const [clearApps, setClearApps] = useState<boolean>(true);
  const [reseedDefault, setReseedDefault] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirmReset = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await clearDatabase(clearApps, reseedDefault);

      const callback = onResetSuccess || onSuccess;
      if (callback) {
        callback({
          deletedEvents: res.deletedEvents ?? 0,
          deletedApps: res.deletedApps ?? 0,
          message: res.message || 'Database reset successfully',
          clearApps,
          reseedDefault
        });
      }
      onClose();
    } catch (err: any) {
      console.error('[RESET-DB] Error:', err);
      setError(err.message || 'Failed to reset database.');
    } finally {
      setLoading(false);
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
    }} onClick={onClose}>
      <div 
        style={{
          background: 'var(--mp-bg-card)',
          border: '1px solid var(--mp-border)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '520px',
          boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(225, 29, 72, 0.2)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--mp-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(225, 29, 72, 0.04)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--mp-red)' }}>
                <RotateCwIcon size={16} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--mp-text-primary)', letterSpacing: '-0.01em' }}>
                Reset Database & Telemetry
              </h3>
            </div>
            <p style={{ margin: '4px 0 0 24px', fontSize: '0.75rem', color: 'var(--mp-text-muted)' }}>
              Wipe recorded metrics, telemetry audit logs, and client applications
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="mp-modal-close" 
            disabled={loading}
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

        {/* Modal Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Warning Banner */}
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '6px',
            padding: '12px 14px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start'
          }}>
            <span style={{ color: 'var(--mp-red)', flexShrink: 0, marginTop: '1px' }}>
              <AlertTriangleIcon size={16} />
            </span>
            <div style={{ fontSize: '0.75rem', color: 'var(--mp-red)', lineHeight: '1.4' }}>
              <strong style={{ display: 'block', color: 'var(--mp-red)', marginBottom: '2px' }}>
                Permanent SQLite Data Reset
              </strong>
              This operation erases records from the local SQLite storage. All dashboard numbers will immediately reset to 0.
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: 'var(--mp-red)',
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '0.75rem'
            }}>
              {error}
            </div>
          )}

          {/* Reset Options List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--mp-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Reset Scope:
            </div>

            {/* Scope 1: Telemetry & Logs (Mandatory) */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'var(--mp-surface-input)',
              border: '1px solid var(--mp-border)',
              cursor: 'not-allowed'
            }}>
              <input
                type="checkbox"
                checked={true}
                disabled={true}
                style={{ marginTop: '3px', accentColor: 'var(--mp-cyan)' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--mp-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Wipe Usage Telemetry & Audit Logs</span>
                  <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-cyan)', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                    Required
                  </span>
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginTop: '2px', lineHeight: '1.3' }}>
                  Clears all logged requests, tokens, KV-cache durations, and cost tracking. All dashboard counters reset to 0.
                </div>
              </div>
            </label>

            {/* Scope 2: Clear Applications */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '6px',
              background: clearApps ? 'rgba(244, 63, 94, 0.06)' : 'var(--mp-surface-input)',
              border: `1px solid ${clearApps ? 'rgba(244, 63, 94, 0.3)' : 'var(--mp-border)'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}>
              <input
                type="checkbox"
                checked={clearApps}
                onChange={(e) => {
                  setClearApps(e.target.checked);
                  if (!e.target.checked) setReseedDefault(false);
                }}
                style={{ marginTop: '3px', accentColor: 'var(--mp-red)' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: clearApps ? 'var(--mp-red)' : 'var(--mp-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Delete All Registered Applications ({appsCount} {appsCount === 1 ? 'app' : 'apps'})</span>
                  {clearApps && (
                    <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-red)', background: 'rgba(251, 113, 133, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                      Wipe Apps
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginTop: '2px', lineHeight: '1.3' }}>
                  Deletes all registered client applications and invalidates all active virtual API keys.
                </div>
              </div>
            </label>

            {/* Scope 3: Re-seed default SensorReportBot */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '6px',
              background: reseedDefault ? 'rgba(16, 185, 129, 0.06)' : 'var(--mp-surface-input)',
              border: `1px solid ${reseedDefault ? 'rgba(16, 185, 129, 0.3)' : 'var(--mp-border)'}`,
              cursor: clearApps ? 'pointer' : 'not-allowed',
              opacity: clearApps ? 1 : 0.45,
              transition: 'all 0.15s ease'
            }}>
              <input
                type="checkbox"
                checked={reseedDefault}
                disabled={!clearApps}
                onChange={(e) => setReseedDefault(e.target.checked)}
                style={{ marginTop: '3px', accentColor: 'var(--mp-green)' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: reseedDefault ? 'var(--mp-green)' : 'var(--mp-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Re-create Clean SensorReportBot (.NET) App</span>
                  {reseedDefault && (
                    <span className="font-mono" style={{ fontSize: '0.625rem', color: 'var(--mp-green)', background: 'rgba(52, 211, 153, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                      Re-seed Starter
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--mp-text-muted)', marginTop: '2px', lineHeight: '1.3' }}>
                  Creates a single clean default application (<code>app_sensorbot</code>) with fresh key for industrial diagnostics.
                </div>
              </div>
            </label>
          </div>

          {/* Outcome preview */}
          <div style={{
            padding: '8px 12px',
            borderRadius: '6px',
            background: 'var(--mp-surface-input)',
            border: '1px solid var(--mp-border)',
            fontSize: '0.6875rem',
            color: 'var(--mp-text-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }} className="font-mono">
            <span>Resulting state:</span>
            <span style={{ color: 'var(--mp-cyan)' }}>
              Requests: 0 • Apps: {clearApps ? (reseedDefault ? '1 (Default)' : '0 (Empty)') : `${appsCount} (Kept)`}
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: '1px solid var(--mp-border)' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="mp-btn-ghost font-mono"
              style={{ padding: '8px 16px', fontSize: '0.75rem' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={loading}
              style={{
                background: '#e11d48',
                border: '1px solid #be123c',
                color: '#fff',
                borderRadius: '6px',
                padding: '8px 18px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontFamily: 'JetBrains Mono, monospace',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#be123c'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#e11d48'; }}
            >
              {loading ? (
                <>
                  <span className="mp-pulse-dot" style={{ background: '#fff' }} />
                  <span>Resetting Database...</span>
                </>
              ) : (
                <>
                  <RotateCwIcon size={13} />
                  <span>Confirm & Reset Database</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
