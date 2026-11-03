export const shadows = {
  elevation: {
    0: 'none',
    1: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    2: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    3: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    4: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    5: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  glow: {
    cyan: '0 0 0 1px rgb(6 182 212 / 0.3), 0 0 20px -4px rgb(6 182 212 / 0.2)',
    cyanStrong: '0 0 0 1px rgb(6 182 212 / 0.5), 0 0 30px -2px rgb(6 182 212 / 0.3)',
    emerald: '0 0 0 1px rgb(16 185 129 / 0.3), 0 0 20px -4px rgb(16 185 129 / 0.2)',
    purple: '0 0 0 1px rgb(168 85 247 / 0.3), 0 0 20px -4px rgb(168 85 247 / 0.2)',
    amber: '0 0 0 1px rgb(245 158 11 / 0.3), 0 0 20px -4px rgb(245 158 11 / 0.2)',
    rose: '0 0 0 1px rgb(244 63 94 / 0.3), 0 0 20px -4px rgb(244 63 94 / 0.2)',
    blue: '0 0 0 1px rgb(59 130 246 / 0.3), 0 0 20px -4px rgb(59 130 246 / 0.2)',
  },
  inner: {
    sm: 'inset 0 1px 2px 0 rgb(0 0 0 / 0.05)',
    default: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
    lg: 'inset 0 4px 6px 0 rgb(0 0 0 / 0.05)',
  },
  focus: {
    default: '0 0 0 2px rgb(6 182 212 / 0.5), 0 0 0 4px rgb(8 12 20)',
    inset: 'inset 0 0 0 2px rgb(6 182 212 / 0.5)',
  },
  dropdown: '0 10px 40px -10px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.05)',
  modal: '0 25px 50px -12px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.05)',
  toast: '0 10px 40px -10px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.05)',
  cardHover: '0 8px 30px -8px rgb(6 182 212 / 0.1), 0 0 0 1px rgb(51 65 85 / 0.9)',
} as const;

export type Shadows = typeof shadows;