export const transitions = {
  duration: {
    instant: '0ms',
    fast: '120ms',
    normal: '200ms',
    slow: '300ms',
    slower: '400ms',
    slowest: '500ms',
  },
  easing: {
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
  presets: {
    fade: {
      duration: 'duration.fast',
      easing: 'easing.easeOut',
      property: 'opacity',
    },
    slideUp: {
      duration: 'duration.normal',
      easing: 'easing.easeOut',
      property: 'transform, opacity',
    },
    slideDown: {
      duration: 'duration.normal',
      easing: 'easing.easeOut',
      property: 'transform, opacity',
    },
    slideLeft: {
      duration: 'duration.normal',
      easing: 'easing.easeOut',
      property: 'transform, opacity',
    },
    slideRight: {
      duration: 'duration.normal',
      easing: 'easing.easeOut',
      property: 'transform, opacity',
    },
    scale: {
      duration: 'duration.fast',
      easing: 'easing.spring',
      property: 'transform, opacity',
    },
    scaleIn: {
      duration: 'duration.normal',
      easing: 'easing.spring',
      property: 'transform, opacity',
    },
    collapse: {
      duration: 'duration.normal',
      easing: 'easing.easeInOut',
      property: 'height, opacity',
    },
    expand: {
      duration: 'duration.normal',
      easing: 'easing.easeInOut',
      property: 'height, opacity',
    },
    color: {
      duration: 'duration.fast',
      easing: 'easing.easeOut',
      property: 'color, background-color, border-color, fill, stroke',
    },
    shadow: {
      duration: 'duration.normal',
      easing: 'easing.easeOut',
      property: 'box-shadow',
    },
    all: {
      duration: 'duration.fast',
      easing: 'easing.easeOut',
      property: 'all',
    },
  },
  motion: {
    reduced: {
      duration: 'duration.instant',
      easing: 'easing.linear',
    },
  },
} as const;

export type Transitions = typeof transitions;