import type { GameDataInput } from './schema';

export const stations = [
  { id: 'tree_line', name: 'Tree line', skill: 'woodcutting', mechanic: 'woodcutting' },
  { id: 'workbench', name: 'Workbench', skill: 'fletching', mechanic: 'rive' },
  { id: 'fire_pit', name: 'Fire pit', skill: 'fletching', mechanic: 'harden' },
  { id: 'war_tent', name: 'War tent', skill: 'command', mechanic: 'runner' },
] satisfies GameDataInput['stations'];
