import type { GameDataInput } from './schema';

// XP amounts are placeholder guesses, to be tuned from playtest logs (M9).
export const recipes = [
  {
    id: 'fell_tree',
    station: 'tree_line',
    inputs: [],
    outputs: [{ item: 'log', count: 1 }],
    xp: 25,
  },
  {
    id: 'rive_stave',
    station: 'workbench',
    inputs: [{ item: 'log', count: 1 }],
    outputs: [{ item: 'stave', count: 1 }],
    xp: 10,
  },
  {
    // The spear's quality tier comes from when the rack is pulled from the fire.
    id: 'harden_spear',
    station: 'fire_pit',
    inputs: [{ item: 'stave', count: 1 }],
    outputs: [{ item: 'spear', count: 1 }],
    xp: 15,
  },
] satisfies GameDataInput['recipes'];
