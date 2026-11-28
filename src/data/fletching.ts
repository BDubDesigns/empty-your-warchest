import type { GameDataInput } from './schema';

// The fletcher's bench (Fletching, first slice). Every number is a first guess, meant to be tuned
// from playtest logs. Each arrow is two beats: dip the shaft's back end in the tar and lift it in
// the green band, then tap as each of the three marks turns to the top to slap a feather on. Or,
// once it's tarred, shove it in the feather bucket (Brandon's shortcut).
export const fletching = {
  // The workers' recipe: checked against these numbers at startup, so the two never drift apart.
  recipe: 'fletch_arrows',
  // A stave splits into 2 shafts (the Fletching page); a spare one waits in the warchest.
  stave: 'stave',
  shaft: 'arrow_shaft',
  shaftsPerStave: 2,
  feather: 'feather',
  // Careful fletching: 3 feathers. The bucket: twice that, at every angle.
  feathers: { careful: 3, bucket: 6 },
  // Three marks round the shaft, 120° apart, as real fletching is.
  marks: 3,
  // More XP for fletched (the Fletching page). About 9 careful arrows a 40 s round, most of them
  // fletched, is about 110 XP a minute, like the other stations; the bucket's quick dusters pay
  // less each, and bare arrows (no tar, no feathers, so the quickest) hardly anything.
  arrows: {
    fletched: { item: 'fletched_arrow', xp: 10 },
    duster: { item: 'duster_arrow', xp: 4 },
    bare: { item: 'bare_arrow', xp: 1 },
  },
  round: { seconds: 40 },
  // Stars from fletched arrows made in the round: 2, 4 and 6 (of about 9 a careful round can make).
  stars: { one: 2, two: 4, three: 6 },
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
    // A finished arrow goes off to the chest, and the next shaft's ready, after this long.
    finishSeconds: 0.45,
    shakeStrength: 1,
    buzzDipMs: 12,
    buzzSlapMs: 22,
    buzzMissMs: 45,
    buzzBucketMs: 35,
  },
} satisfies GameDataInput['fletching'];
