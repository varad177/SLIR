export const spacing = {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  7: '1.75rem',   // 28px
  8: '2rem',      // 32px
  9: '2.25rem',   // 36px
  10: '2.5rem',   // 40px
  11: '2.75rem',  // 44px
  12: '3rem',     // 48px
  14: '3.5rem',   // 56px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem',     // 96px
  28: '7rem',     // 112px
  32: '8rem',     // 128px
  36: '9rem',     // 144px
  40: '10rem',    // 160px
  44: '11rem',    // 176px
  48: '12rem',    // 192px
  52: '13rem',    // 208px
  56: '14rem',    // 224px
  60: '15rem',    // 240px
  64: '16rem',    // 256px
  72: '18rem',    // 288px
  80: '20rem',    // 320px
  96: '24rem',    // 384px
} as const;

export const componentSpacing = {
  card: {
    padding: 'spacing.5',
    paddingSm: 'spacing.4',
    paddingLg: 'spacing.6',
    gap: 'spacing.4',
  },
  button: {
    paddingX: { sm: 'spacing.3', md: 'spacing.4', lg: 'spacing.5' },
    paddingY: { sm: 'spacing.1.5', md: 'spacing.2', lg: 'spacing.3' },
    gap: 'spacing.2',
  },
  input: {
    paddingX: 'spacing.3',
    paddingY: 'spacing.2',
    gap: 'spacing.1.5',
  },
  modal: {
    padding: 'spacing.6',
    gap: 'spacing.4',
  },
  table: {
    cellPaddingX: 'spacing.3.5',
    cellPaddingY: 'spacing.3',
    headerPaddingX: 'spacing.3.5',
    headerPaddingY: 'spacing.2.5',
  },
  sidebar: {
    width: '15rem', // 240px
    collapsedWidth: '4.5rem', // 72px
    padding: 'spacing.4.5',
    itemGap: 'spacing.1',
  },
  topbar: {
    height: '3.5rem', // 56px
    paddingX: 'spacing.7',
  },
  page: {
    paddingX: 'spacing.7',
    paddingY: 'spacing.6',
    maxWidth: '90rem', // 1440px
  },
  kpi: {
    gap: 'spacing.4',
    cardPadding: 'spacing.4.5',
  },
  grid: {
    gap: 'spacing.5',
    gapSm: 'spacing.4',
  },
  section: {
    headerGap: 'spacing.4',
    titleGap: 'spacing.2',
  },
} as const;

export type Spacing = typeof spacing;
export type ComponentSpacing = typeof componentSpacing;