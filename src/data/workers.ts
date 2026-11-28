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
    // A hunt of three birds every 3 minutes: a bird a minute, about a tenth of the 9 or so a
    // minute of playing (Brandon, Nov 27: playing must stay the main way to get seeds). It spends
    // fletched arrows; none start here.
    { recipe: 'hunt_flock', perMinute: 1 / 3, start: 0 },
    // A stave's 2 fletched arrows every 2 minutes (the bench's 1 stave per 2 arrows): an arrow a
    // minute, about a tenth of playing at level 1, where a round of one arrow's beats takes about
    // 7 s with its card (more with a streak or a bigger bench). That's what the hunt's worker
    // shoots, and its 3 feathers a minute, so a worker at each keeps the other going.
    { recipe: 'fletch_arrows', perMinute: 0.5, start: 0 },
    // A plot tended every 15 minutes: harvested onto the farm's pile, replanted with a seed from
    // the warchest and watered at 1 star. Played, four woad plots at 3 stars give about 2.4 woad a
    // minute of growing; a worker about a tenth of that (0.25 a minute). None start here.
    { plots: 'farm', perMinute: 1 / 15, start: 0 },
  ],
} satisfies GameDataInput['workers'];
