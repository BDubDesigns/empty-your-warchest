import type { GameDataInput } from './schema';

// Workers (M6). Every number is a first guess, meant to be tuned from playtest logs.
export const workers = {
  // You get workers from Command (Brandon, Nov 25): 3 at level 1, one more every 5 levels.
  skill: 'command',
  start: 3,
  everyLevels: 5,
  // Time away that counts, at most (upgradeable later). Time spent playing always counts.
  awayCapMinutes: 30,
  // The "while you were away" card only shows after at least this long away.
  cardMinutes: 1,
  // The minimum a player can keep back from the workers goes up and down in these steps.
  minimumStep: 5,
  // Collecting a station's pile pours it into the camp chest: at most `maxPieces` pieces fly,
  // `staggerSeconds` apart, each taking `flightSeconds`, with a buzz as each lands.
  pour: { maxPieces: 18, staggerSeconds: 0.07, flightSeconds: 0.6, buzzMs: 8 },
  // What one worker does at each station, a tenth or so of playing it: together, one on each
  // makes about one run's spears in 30 minutes. Worked out minute by minute in this order, down
  // the chain, so logs chopped can be split and staves hardened. `start` is the default crew.
  jobs: [
    { recipe: 'fell_tree', perMinute: 1, start: 1 },
    // One log split every 10 minutes, into 6 staves (about what a played log gives).
    { recipe: 'split_stave', perMinute: 0.1, yield: 6, start: 1 },
    // 2 staves hardened every 4 minutes, burning a log; a worker never chars one.
    {
      recipe: 'harden_spear',
      perMinute: 0.25,
      batches: 2,
      extra: [{ item: 'log', count: 1 }],
      start: 1,
    },
  ],
} satisfies GameDataInput['workers'];
