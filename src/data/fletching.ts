import type { GameDataInput } from './schema';

// The fletcher's bench. Every number is a first guess, meant to be tuned from playtest logs. A
// round is one arrow's beats applied to a batch (Brandon, Nov 28): pick how many arrows, dip the
// one shaft shown in the tar and lift it in the green band, then tap as each of the three marks
// turns to the top to slap a feather on. Or, once it's tarred, shove it in the feather bucket
// (Brandon's shortcut), or leave it bare. The whole batch comes out the same.
export const fletching = {
  // The workers' recipe: checked against these numbers at startup, so the two never drift apart.
  recipe: 'fletch_arrows',
  // A stave splits into 2 shafts. A batch takes 1 stave per 2 arrows, rounded up: there's no
  // shaft item, and an odd spare shaft is simply used up (Brandon, Nov 28).
  stave: 'stave',
  arrowsPerStave: 2,
  feather: 'feather',
  // Careful fletching: 3 feathers an arrow. The bucket: twice that, at every angle.
  feathers: { careful: 3, bucket: 6 },
  // Three marks round the shaft, 120° apart, as real fletching is.
  marks: 3,
  // XP per arrow, more for fletched (the Fletching page); the bucket's dusters pay less each, and
  // bare arrows hardly anything.
  arrows: {
    fletched: { item: 'fletched_arrow', xp: 10 },
    duster: { item: 'duster_arrow', xp: 4 },
    bare: { item: 'bare_arrow', xp: 1 },
  },
  // How many arrows a batch can be, by Fletching level (Brandon, Nov 28): the picker offers 1 up
  // to the biggest size open. The hot streak multiplies it (feel.streakCap), so 6 × 3 = 18.
  batch: {
    sizes: [
      { arrows: 1, level: 1 },
      { arrows: 2, level: 5 },
      { arrows: 3, level: 10 },
      { arrows: 4, level: 15 },
      { arrows: 5, level: 20 },
      { arrows: 6, level: 30 },
    ],
  },
  // Stars from the round's beats. 3 stars is a fletched batch (tar in the band, every feather on
  // its mark). 2 is a near miss: the tar within `nearTar` of the band (a sixth of a second's rise
  // either side) and every feather within `nearTapMs` of its mark (twice the mark window).
  // Anything else finished is 1. The bucket and bare are the shortcuts, so they're a fixed 1 star:
  // they never build a streak.
  stars: { nearTar: 0.1, nearTapMs: 220, bucket: 1, bare: 1 },
  // 3 stars gives bonus fletched arrows: half as many again, like the bird hunt's bonus seeds.
  starBonus: { two: 0, three: 0.5 },
  looks: {
    // The camera fits a box `frameWidth` across (metres) to the screen's width, looking down
    // `pitch` degrees at the bench from `distance` away. While the feathers go on it moves in to
    // `closeDistance` from the shaft's back end, so the marks read on a phone.
    frameWidth: 0.52,
    pitch: 26,
    distance: 1.2,
    closeDistance: 0.36,
    // The shaft: `shaftLength` long, `shaftRadius` round (thicker than a real one, to read on a
    // phone). A full tar level (1) coats `tarLength` of it, from its back end up.
    shaftLength: 0.5,
    shaftRadius: 0.012,
    tarLength: 0.2,
    // Feathers: `featherLength` long; the duster's feathers poke out at every angle.
    featherLength: 0.13,
    // The forest edge behind the bench, as at the hunting stand next door.
    treeDistance: { min: 9, max: 18 },
    treeHeight: { min: 4, max: 7 },
    seed: 11,
    tiers: {
      high: {
        pixelRatio: 2,
        shadows: true,
        dusterFeathers: 34,
        bucketFeathers: 46,
        trees: 22,
        grass: true,
      },
      low: {
        pixelRatio: 1.5,
        shadows: false,
        dusterFeathers: 20,
        bucketFeathers: 22,
        trees: 10,
        grass: false,
      },
    },
  },
  feel: {
    // The tar: its level rises `tarFill` a second while the shaft's held in the pot (1 is the
    // whole tar length), and the green band runs from `tarLow` to `tarHigh`. Reaching the band
    // takes about 0.8 s, and it's about 0.45 s wide.
    tarFill: 0.6,
    tarLow: 0.48,
    tarHigh: 0.75,
    // Drag down this far (CSS px) to put the shaft in the pot.
    dipPx: 40,
    // The feathers: the shaft turns `turnSpeed` degrees a second, so a mark comes to the top every
    // 0.8 s; a tap within `markWindowMs` of a mark's being at the top puts the feather on it. The
    // first mark reaches the top `leadSeconds` after the shaft's in the jig.
    turnSpeed: 150,
    markWindowMs: 110,
    leadSeconds: 0.6,
    // The made batch goes off to the chest this long after it's finished, then the card shows.
    finishSeconds: 0.45,
    // The hot streak: a 3-star round raises the batch's multiplier a step (×1, ×2, ×3) up to
    // this; any round under 3 stars drops it one step, never below ×1 (Brandon, Nov 28).
    streakCap: 3,
    shakeStrength: 1,
    buzzDipMs: 12,
    buzzSlapMs: 22,
    buzzMissMs: 45,
    buzzBucketMs: 35,
  },
} satisfies GameDataInput['fletching'];
