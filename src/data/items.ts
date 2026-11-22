import type { GameDataInput } from './schema';

export const items = [
  { id: 'log', name: 'Log', tiered: false },
  { id: 'stave', name: 'Stave', tiered: false },
  { id: 'spear', name: 'Spear', tiered: true },
] satisfies GameDataInput['items'];
