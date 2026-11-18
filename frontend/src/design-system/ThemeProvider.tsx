import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import {
  colors,
  spacing,
  typography,
  shadows,
  borderRadius,
  transitions,
  zIndex,
  breakpoints,
  containerMaxWidths,
} from './tokens';

interface ThemeContextValue {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  reducedMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Matches token references such as "neutral.950" or "brand.cyan.500/40"
const TOKEN_REF = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)(?:\/(\d{1,3}))?$/i;

function lookupTokenHex(path: string): string | null {
  let current: any = colors;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    current = current[segment];
  }
  return typeof current === 'string' ? current : null;
}

function resolveColorRef(value: string): string {
  const match = TOKEN_REF.exec(value.trim());
  if (!match) return value;

  const hex = lookupTokenHex(match[1]);
  if (!hex) return value;
  if (match[2] === undefined) return hex;

  const alphaPct = Math.min(100, parseInt(match[2], 10));
  const alphaHex = Math.round((alphaPct / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alphaHex}` : hex;
}

function resolveTokenValue(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const cssVar = `--${prefix}${key}`.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, resolveTokenValue(value, `${prefix}${key}-`));
    } else {
      result[cssVar] = typeof value === 'string' ? resolveColorRef(value) : String(value);
    }
  }
  return result;
}

function generateCSSVariables(): Record<string, string> {
  const vars: Record<string, string> = {};

  Object.assign(vars, resolveTokenValue(colors, 'color-'));
  Object.assign(vars, resolveTokenValue(spacing, 'spacing-'));
  Object.assign(vars, resolveTokenValue(typography.fontSize, 'font-size-'));
  Object.assign(vars, resolveTokenValue(typography.lineHeight, 'line-height-'));
  Object.assign(vars, resolveTokenValue(typography.letterSpacing, 'letter-spacing-'));
  Object.assign(vars, resolveTokenValue(typography.fontWeight, 'font-weight-'));
  Object.assign(vars, resolveTokenValue(borderRadius, 'radius-'));
  Object.assign(vars, resolveTokenValue(shadows.elevation, 'shadow-'));
  Object.assign(vars, resolveTokenValue(shadows.glow, 'shadow-glow-'));
  Object.assign(vars, resolveTokenValue(shadows.inner, 'shadow-inner-'));
  Object.assign(vars, resolveTokenValue(shadows.focus, 'shadow-focus-'));
  Object.assign(vars, { '--shadow-dropdown': shadows.dropdown });
  Object.assign(vars, { '--shadow-modal': shadows.modal });
  Object.assign(vars, { '--shadow-toast': shadows.toast });
  Object.assign(vars, { '--shadow-card-hover': shadows.cardHover });
  Object.assign(vars, resolveTokenValue(transitions.duration, 'duration-'));
  Object.assign(vars, resolveTokenValue(transitions.easing, 'easing-'));
  Object.assign(vars, resolveTokenValue(zIndex, 'z-'));
  Object.assign(vars, resolveTokenValue(breakpoints, 'bp-'));
  Object.assign(vars, resolveTokenValue(containerMaxWidths, 'container-max-widths-'));

  vars['--font-family-sans'] = typography.fontFamily.sans;
  vars['--font-family-mono'] = typography.fontFamily.mono;
  vars['--font-family-ui'] = typography.fontFamily.ui;

  return vars;
}

const cssVariables = generateCSSVariables();

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Dark remains the default for first-time users, but the toggle choice is
  // persisted so light mode survives reloads.
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
  const setTheme = (t: 'dark' | 'light') => setThemeState(t);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme, reducedMotion }), [theme, reducedMotion]);

  return (
    <ThemeContext.Provider value={value}>
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          color-scheme: dark;
          ${Object.entries(cssVariables).map(([k, v]) => `${k}: ${v};`).join('\n          ')}
          --accent-cyan: var(--color-brand-cyan-400);
          --accent-blue: var(--color-brand-blue-400);
          --accent-rose: var(--color-brand-rose-400);
          --text-primary: var(--color-semantic-text-primary);
          --text-secondary: var(--color-semantic-text-secondary);
          --text-muted: var(--color-semantic-text-muted);
          --border-subtle: var(--color-semantic-border-subtle);
          --border-color: var(--color-semantic-border-default);
          --bg-base: var(--color-semantic-bg-base);
          --bg-card: var(--color-semantic-bg-surface);
          --bg-card-subtle: var(--color-neutral-950);
          --bg-primary: var(--color-brand-cyan-500);
          --bg-secondary: var(--color-semantic-bg-hover);
        }
        [data-theme="light"] {
          color-scheme: light;
          --color-neutral-0: #ffffff;
          --color-neutral-50: #f8fafc;
          --color-neutral-100: #f1f5f9;
          --color-neutral-200: #e2e8f0;
          --color-neutral-300: #cbd5e1;
          --color-neutral-400: #94a3b8;
          --color-neutral-500: #64748b;
          --color-neutral-600: #475569;
          --color-neutral-700: #334155;
          --color-neutral-800: #1e293b;
          --color-neutral-900: #0f172a;
          --color-neutral-950: #080c14;
          --color-semantic-bg-base: var(--color-neutral-50);
          --color-semantic-bg-surface: var(--color-neutral-0);
          --color-semantic-bg-elevated: var(--color-neutral-0);
          --color-semantic-bg-hover: var(--color-neutral-200);
          --color-semantic-bg-overlay: #f8fafccc;
          --color-semantic-border-subtle: var(--color-neutral-200);
          --color-semantic-border-default: var(--color-neutral-300);
          --color-semantic-text-primary: var(--color-neutral-950);
          --color-semantic-text-secondary: var(--color-neutral-600);
          --color-semantic-text-muted: var(--color-neutral-500);
          --color-semantic-text-inverse: var(--color-neutral-50);
          --accent-cyan: var(--color-brand-cyan-600);
          --accent-blue: var(--color-brand-blue-600);
          --accent-rose: var(--color-brand-rose-600);
          --bg-card-subtle: var(--color-neutral-100);
        }
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      ` }} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useCSSVar(name: string) {
  return `var(${name})`;
}