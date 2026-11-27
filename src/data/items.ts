import type { GameDataInput } from './schema';

export const items = [
  { id: 'log', name: 'Log', look: 'round' },
  { id: 'stave', name: 'Stave', look: 'split' },
  { id: 'spear', name: 'Spear', look: 'pointed' },
  // Brewed at a station of its own one day; for now, from the debug menu.
  { id: 'sense_potion', name: 'Sense potion', look: 'bottle' },
] satisfies GameDataInput['items'];
