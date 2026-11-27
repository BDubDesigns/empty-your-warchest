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
    // Fire-hardening one stave into a spear, XP per spear hardened. About 6 spears a 20 s rack is
    // about 100 XP a minute, like the other stations; a guess until rack sizes are tuned.
    id: 'harden_spear',
    station: 'fire_pit',
    inputs: [{ item: 'stave', count: 1 }],
    outputs: [{ item: 'spear', count: 1 }],
    xp: 5,
  },
  {
    // Bottling a Sense potion at the cauldron. Its ingredients are whatever went into the pot, so
    // the recipe takes nothing itself; the brew's stars say how many potions it makes. XP per brew
    // (yield counts potions, XP counts the brew): a 45 s brew, about the other stations' 100 a
    // minute. A guess until brews are tuned.
    id: 'brew_sense',
    station: 'cauldron',
    inputs: [],
    outputs: [{ item: 'sense_potion', count: 1 }],
    xp: 75,
  },
] satisfies GameDataInput['recipes'];
