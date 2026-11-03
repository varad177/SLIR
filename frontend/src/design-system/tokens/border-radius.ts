export const borderRadius = {
  none: '0',
  xs: '0.125rem',   // 2px
  sm: '0.25rem',    // 4px
  default: '0.375rem', // 6px
  md: '0.5rem',     // 8px
  lg: '0.75rem',    // 12px
  xl: '1rem',       // 16px
  '2xl': '1.5rem',  // 24px
  '3xl': '2rem',    // 32px
  full: '9999px',
  pill: '9999px',
} as const;

export const componentRadius = {
  button: {
    sm: 'radius.sm',
    md: 'radius.default',
    lg: 'radius.md',
  },
  input: {
    sm: 'radius.sm',
    md: 'radius.default',
    lg: 'radius.md',
  },
  card: {
    sm: 'radius.md',
    md: 'radius.lg',
    lg: 'radius.xl',
  },
  badge: {
    sm: 'radius.xs',
    md: 'radius.sm',
    lg: 'radius.default',
  },
  modal: 'radius.xl',
  dropdown: 'radius.lg',
  tooltip: 'radius.sm',
  avatar: 'radius.full',
  table: 'radius.md',
  kpiCard: 'radius.lg',
  progress: 'radius.full',
  toggle: 'radius.full',
} as const;

export type BorderRadius = typeof borderRadius;
export type ComponentRadius = typeof componentRadius;