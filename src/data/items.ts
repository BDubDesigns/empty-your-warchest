import type { GameDataInput } from './schema';

export const items = [
  { id: 'log', name: 'Log' },
  { id: 'stave', name: 'Stave' },
  { id: 'spear', name: 'Spear' },
] satisfies GameDataInput['items'];
