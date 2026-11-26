import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InfoIcon } from './icons/Icons';

export interface InfoTipProps {
  title?: string;
  text: string;
  example?: string;
  label?: string;
  children?: React.ReactNode;
  className?: string;
  iconSize?: number;
}

interface PopoverCoords {
  top: number;
  left: number;
  arrowLeft: number;
  placement: 'top' | 'bottom';
  ready: boolean;
}

export const InfoTip: React.FC<InfoTipProps> = ({
  title,
  text,
  example,
  label,
  children,
  className = '',
  iconSize = 12
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords>({
    top: 0,
    left: 0,
    arrowLeft: 0,
    placement: 'top',
    ready: false
  });
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const tooltipId = useId();

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const show = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 60);
  }, []);

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const gap = 8;
    const margin = 10;

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const placement: 'top' | 'bottom' =
      spaceAbove >= popRect.height + gap + margin || spaceAbove >= spaceBelow ? 'top' : 'bottom';

    const rawTop =
      placement === 'top'
        ? triggerRect.top - popRect.height - gap
        : triggerRect.bottom + gap;
    const top = Math.max(margin, Math.min(rawTop, window.innerHeight - popRect.height - margin));

    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const rawLeft = triggerCenterX - popRect.width / 2;
    const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - popRect.width - margin));
    const arrowLeft = Math.max(12, Math.min(triggerCenterX - left, popRect.width - 12));

    setCoords({ top, left, arrowLeft, placement, ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    updatePosition();
  }, [open, title, text, example, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, updatePosition]);

  const handleClick = (event: React.MouseEvent) => {
    if (!children) {
      event.preventDefault();
      event.stopPropagation();
      setOpen((prev) => !prev);
    }
  };

  const popoverNode =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            id={tooltipId}
            role="tooltip"
            className={`mp-infotip-popover ${coords.placement} ${coords.ready ? 'ready' : ''}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <span
              className="mp-infotip-arrow"
              style={{ left: `${coords.arrowLeft}px` }}
              aria-hidden="true"
            />
            {title && <div className="mp-infotip-title">{title}</div>}
            <div className="mp-infotip-body">{text}</div>
            {example && <div className="mp-infotip-example">{example}</div>}
          </div>,
          document.body
        )
      : null;

  if (children) {
    return (
      <>
        <span
          ref={(el) => {
            triggerRef.current = el;
          }}
          className={`mp-infotip-wrap ${className}`.trim()}
          aria-describedby={open ? tooltipId : undefined}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </span>
        {popoverNode}
      </>
    );
  }

  return (
    <>
      <button
        ref={(el) => {
          triggerRef.current = el;
        }}
        type="button"
        className={`mp-infotip-trigger ${className}`.trim()}
        aria-label={label || title || 'More information'}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={handleClick}
      >
        <InfoIcon size={iconSize} />
      </button>
      {popoverNode}
    </>
  );
};
