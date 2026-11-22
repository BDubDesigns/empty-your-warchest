/** Placeholder look for the app shell. Kept in one place so CSS, Phaser and three.js match. */
export const theme = {
  font: 'system-ui, sans-serif',
  bg: '#1b1f1a',
  fg: '#f2ead3',
  fgHex: 0xf2ead3,
  muted: '#9c9a8c',
  mutedHex: 0x9c9a8c,
  gridHex: 0x33382f,
  accentHex: 0xc8873a,
  accentPressedHex: 0x9e6a2c,
} as const;

/** Where the Phaser screen's switch button sits, as a fraction of screen height. The e2e test taps here. */
export const SWITCH_BUTTON_Y = 0.62;
