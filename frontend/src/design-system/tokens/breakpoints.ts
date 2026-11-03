export const breakpoints = {
  xs: '320px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const breakpointValues = {
  xs: 320,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export const mediaQueries = {
  xs: `@media (min-width: ${breakpoints.xs})`,
  sm: `@media (min-width: ${breakpoints.sm})`,
  md: `@media (min-width: ${breakpoints.md})`,
  lg: `@media (min-width: ${breakpoints.lg})`,
  xl: `@media (min-width: ${breakpoints.xl})`,
  '2xl': `@media (min-width: ${breakpoints['2xl']})`,
  maxXs: `@media (max-width: ${breakpointValues.xs - 1}px)`,
  maxSm: `@media (max-width: ${breakpointValues.sm - 1}px)`,
  maxMd: `@media (max-width: ${breakpointValues.md - 1}px)`,
  maxLg: `@media (max-width: ${breakpointValues.lg - 1}px)`,
  maxXl: `@media (max-width: ${breakpointValues.xl - 1}px)`,
  max2xl: `@media (max-width: ${breakpointValues['2xl'] - 1}px)`,
  hover: '@media (hover: hover)',
  noHover: '@media (hover: none)',
  pointer: '@media (pointer: fine)',
  coarse: '@media (pointer: coarse)',
  reducedMotion: '@media (prefers-reduced-motion: reduce)',
  dark: '@media (prefers-color-scheme: dark)',
  light: '@media (prefers-color-scheme: light)',
  highContrast: '@media (prefers-contrast: high)',
} as const;

export const containerMaxWidths = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1440px',
  full: '100%',
} as const;

export type Breakpoints = typeof breakpoints;
export type MediaQueries = typeof mediaQueries;