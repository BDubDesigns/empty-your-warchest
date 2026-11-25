import type { GameDataInput } from './schema';

// XP amounts are placeholder guesses, to be tuned from playtest logs (M9).
export const recipes = [
  {
    id: 'fell_tree',
    station: 'tree_line',
    inputs: [],
    outputs: [{ item: 'log', count: 1 }],
    // A round banks about 45 logs: level 10 in about 5 rounds, 20 in about 20, 40 in about 165.
    xp: 5,
  },
  {
    // Splitting one log: its yield is the staves it's worth (staves × grains), and XP is per stave
    // split. About 6 staves a 15 s log is about 120 XP a minute, like woodcutting.
    id: 'split_stave',
    station: 'workbench',
    inputs: [{ item: 'log', count: 1 }],
    outputs: [{ item: 'stave', count: 1 }],
    xp: 5,
  },
  {
    // Fire-hardening one stave into a spear (M5). XP is a placeholder until rack sizes are tuned.
    id: 'harden_spear',
    station: 'fire_pit',
    inputs: [{ item: 'stave', count: 1 }],
    outputs: [{ item: 'spear', count: 1 }],
    xp: 15,
  },
] satisfies GameDataInput['recipes'];
