import type { GameDataInput } from './schema';

export const items = [
  { id: 'log', name: 'Log', look: 'round' },
  { id: 'stave', name: 'Stave', look: 'split' },
  { id: 'spear', name: 'Spear', look: 'pointed' },
] satisfies GameDataInput['items'];
