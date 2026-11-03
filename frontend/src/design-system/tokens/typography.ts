export const typography = {
  fontFamily: {
    sans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
    ui: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },
  fontSize: {
    xs: 'clamp(0.6875rem, 0.65rem + 0.15vw, 0.75rem)',      // 11-12px
    sm: 'clamp(0.75rem, 0.7rem + 0.2vw, 0.8125rem)',        // 12-13px
    base: 'clamp(0.8125rem, 0.75rem + 0.25vw, 0.875rem)',   // 13-14px
    lg: 'clamp(0.875rem, 0.8rem + 0.3vw, 1rem)',            // 14-16px
    xl: 'clamp(1rem, 0.9rem + 0.4vw, 1.125rem)',            // 16-18px
    '2xl': 'clamp(1.125rem, 1rem + 0.5vw, 1.25rem)',        // 18-20px
    '3xl': 'clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)',        // 20-24px
    '4xl': 'clamp(1.5rem, 1.3rem + 0.8vw, 1.875rem)',       // 24-30px
    '5xl': 'clamp(2rem, 1.7rem + 1.2vw, 2.5rem)',           // 32-40px
    '6xl': 'clamp(2.5rem, 2.1rem + 1.6vw, 3.5rem)',         // 40-56px
  },
  lineHeight: {
    none: 1,
    tight: 1.1,
    snug: 1.25,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.02em',
    normal: '0',
    wide: '0.02em',
    wider: '0.05em',
    widest: '0.1em',
  },
  textStyles: {
    display: {
      fontSize: 'fontSize.5xl',
      fontWeight: 'fontWeight.extrabold',
      lineHeight: 'lineHeight.tight',
      letterSpacing: 'letterSpacing.tighter',
    },
    h1: {
      fontSize: 'fontSize.4xl',
      fontWeight: 'fontWeight.extrabold',
      lineHeight: 'lineHeight.tight',
      letterSpacing: 'letterSpacing.tighter',
    },
    h2: {
      fontSize: 'fontSize.3xl',
      fontWeight: 'fontWeight.bold',
      lineHeight: 'lineHeight.snug',
      letterSpacing: 'letterSpacing.tight',
    },
    h3: {
      fontSize: 'fontSize.2xl',
      fontWeight: 'fontWeight.bold',
      lineHeight: 'lineHeight.snug',
      letterSpacing: 'letterSpacing.tight',
    },
    h4: {
      fontSize: 'fontSize.xl',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    h5: {
      fontSize: 'fontSize.lg',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    h6: {
      fontSize: 'fontSize.base',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    body: {
      fontSize: 'fontSize.base',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    bodySm: {
      fontSize: 'fontSize.sm',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    bodyXs: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    label: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.wide',
      textTransform: 'uppercase',
    },
    caption: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    code: {
      fontSize: 'fontSize.sm',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      fontFamily: 'fontFamily.mono',
    },
    codeSm: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      fontFamily: 'fontFamily.mono',
    },
    button: {
      fontSize: 'fontSize.sm',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    buttonSm: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.semibold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    buttonLg: {
      fontSize: 'fontSize.base',
      fontWeight: 'fontWeight.bold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.normal',
    },
    kpiValue: {
      fontSize: 'clamp(1.5rem, 1.25rem + 1vw, 2rem)',
      fontWeight: 'fontWeight.extrabold',
      lineHeight: 'lineHeight.tight',
      letterSpacing: 'letterSpacing.tight',
      fontFamily: 'fontFamily.mono',
    },
    kpiTitle: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.bold',
      lineHeight: 'lineHeight.normal',
      letterSpacing: 'letterSpacing.widest',
      textTransform: 'uppercase',
    },
    mono: {
      fontSize: 'fontSize.sm',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      fontFamily: 'fontFamily.mono',
    },
    monoSm: {
      fontSize: 'fontSize.xs',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      fontFamily: 'fontFamily.mono',
    },
    monoLg: {
      fontSize: 'fontSize.base',
      fontWeight: 'fontWeight.normal',
      lineHeight: 'lineHeight.normal',
      fontFamily: 'fontFamily.mono',
    },
  },
} as const;

export type Typography = typeof typography;