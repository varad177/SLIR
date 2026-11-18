import React, { useEffect } from 'react';
import { AlertTriangleIcon, CloseIcon } from './icons/Icons';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  subMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  subMessage,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDanger = true,
  loading = false,
  onConfirm,
  onClose
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'var(--mp-bg-card)',
          border: '1px solid var(--mp-border)',
          borderRadius: '10px',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 20px rgba(244, 63, 94, 0.08)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--mp-border-subtle)',
            background: 'rgba(18, 21, 30, 0.9)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: isDanger ? 'rgba(244, 63, 94, 0.15)' : 'rgba(249, 115, 22, 0.15)',
                color: isDanger ? 'var(--mp-red)' : 'var(--mp-orange)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <AlertTriangleIcon size={16} />
            </div>
            <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--mp-text-primary)' }}>
              {title}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--mp-text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'grid',
              placeItems: 'center',
              borderRadius: '4px'
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--mp-text-secondary)', lineHeight: 1.5 }}>
            {message}
          </p>
          {subMessage && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                background: 'rgba(244, 63, 94, 0.08)',
                border: '1px solid rgba(244, 63, 94, 0.25)',
                borderRadius: '6px',
                fontSize: '0.75rem',
                color: 'var(--mp-red)',
                lineHeight: 1.4
              }}
              className="font-mono"
            >
              {subMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            padding: '14px 20px',
            borderTop: '1px solid var(--mp-border-subtle)',
            background: 'rgba(15, 18, 25, 0.8)'
          }}
        >
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid var(--mp-border-strong)',
              color: 'var(--mp-text-secondary)',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              background: isDanger ? '#e11d48' : '#ea580c',
              border: 'none',
              color: '#ffffff',
              padding: '7px 18px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: isDanger
                ? '0 2px 10px rgba(225, 29, 72, 0.35)'
                : '0 2px 10px rgba(234, 88, 12, 0.35)'
            }}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

