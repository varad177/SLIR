export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
  commandPalette: 90,
  max: 100,
} as const;

export const layerNames = {
  background: 'zIndex.base',
  content: 'zIndex.base',
  navigation: 'zIndex.sticky',
  header: 'zIndex.fixed',
  overlay: 'zIndex.modalBackdrop',
  dialog: 'zIndex.modal',
  popover: 'zIndex.popover',
  tooltip: 'zIndex.tooltip',
  notification: 'zIndex.toast',
  palette: 'zIndex.commandPalette',
} as const;

export type ZIndex = typeof zIndex;