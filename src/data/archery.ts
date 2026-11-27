import type { GameDataInput } from './schema';

// The bird hunt at the hunting stand (Archery, first slice). Every number is a first guess, meant
// to be tuned from playtest logs. Field units: the field is 20 across and 36 up from the bow.
export const archery = {
  field: { width: 20, height: 36, margin: 3 },
  // Room below the bow for the quiver, and above the field for the skill bar and the chest.
  frame: { bottom: 7, top: 6, side: 0.5 },
  step: 1 / 120,
  // Three flocks over about 45 s (Brandon, Nov 27); a flock takes about 6–10 s to cross.
  round: { seconds: 45, flockAt: [1.5, 15.5, 29.5], birdGap: { min: 0.35, max: 1.1 } },
  // Mostly finches to start; more jays and crows (and bigger flocks) as Archery goes up.
  flocks: [
    {
      level: 1,
      birds: { min: 3, max: 5 },
      mix: [
        { bird: 'finch', weight: 6 },
        { bird: 'blue_jay', weight: 3 },
        { bird: 'crow', weight: 1 },
      ],
    },
    {
      level: 10,
      birds: { min: 4, max: 6 },
      mix: [
        { bird: 'finch', weight: 4 },
        { bird: 'blue_jay', weight: 4 },
        { bird: 'crow', weight: 2 },
      ],
    },
    {
      level: 25,
      birds: { min: 5, max: 7 },
      mix: [
        { bird: 'finch', weight: 3 },
        { bird: 'blue_jay', weight: 4 },
        { bird: 'crow', weight: 3 },
      ],
    },
  ],
  // Told apart by colour, silhouette and flight (Brandon, Nov 27): the finch slow and straight
  // (bounding a little, as finches do), the jay swooping, the crow fast and high. Harder birds pay
  // more XP: about 8 hits a round is about 110 XP a minute, like the other stations.
  birds: [
    {
      id: 'finch',
      name: 'Finch',
      seed: 'sunflower_seed',
      seeds: { min: 1, max: 2 },
      xp: 8,
      radius: 0.9,
      speed: { min: 3.5, max: 4.5 },
      altitude: { min: 11, max: 22 },
      path: { kind: 'straight', amplitude: 0.8, hz: 1.1 },
      look: {
        shape: 'finch',
        body: '#e9b824',
        wing: '#2b2622',
        belly: '#f6dc6a',
        beak: '#e08a2c',
        flapHz: 9,
      },
    },
    {
      id: 'blue_jay',
      name: 'Blue jay',
      seed: 'woad_seed',
      seeds: { min: 1, max: 2 },
      xp: 10,
      radius: 1,
      speed: { min: 4.5, max: 6 },
      altitude: { min: 16, max: 27 },
      path: { kind: 'swoop', amplitude: 6, hz: 0.22 },
      look: {
        shape: 'jay',
        body: '#3f7fd0',
        wing: '#2c5aa4',
        belly: '#e8eef4',
        beak: '#2a2a2a',
        flapHz: 6,
      },
    },
    {
      id: 'crow',
      name: 'Crow',
      seed: 'mushroom_spores',
      seeds: { min: 1, max: 3 },
      xp: 14,
      radius: 1.15,
      speed: { min: 7, max: 8.5 },
      altitude: { min: 26, max: 33 },
      path: { kind: 'straight', amplitude: 0.5, hz: 0.5 },
      look: {
        shape: 'crow',
        body: '#24242b',
        wing: '#18181d',
        belly: '#30303a',
        beak: '#45454e',
        flapHz: 4,
      },
    },
  ],
  // Birds drop 2–4 feathers (the Archery page's pick, Nov 27).
  feathers: { item: 'feather', count: { min: 2, max: 4 } },
  // The near miss (Brandon's joke): one seed, and the bird flaps off half as fast again.
  scare: { seeds: 1, speedUp: 1.5 },
  // Fletched flies true and far; bare wobbles, drifts and drops sooner (Brandon likes that): at a
  // full draw straight up a fletched arrow tops out past the field, a bare one about crow height.
  arrows: [
    {
      item: 'fletched_arrow',
      speed: 42,
      drag: 0.04,
      drift: 0,
      wobble: 0,
      wobbleHz: 0,
      fishtail: 0,
      breakChance: 0.1,
    },
    {
      item: 'bare_arrow',
      speed: 38,
      drag: 0.2,
      drift: 3,
      wobble: 10,
      wobbleHz: 2.2,
      fishtail: 10,
      breakChance: 0.2,
    },
  ],
  aim: { min: 8, max: 172 },
  arrowSeconds: 6,
  // Birds hit per arrow, and at least 3 hits for any star (Brandon, Nov 27).
  stars: { minHits: 3, one: 0.25, two: 0.4, three: 0.6 },
  // 3 stars gives bonus seeds (the Archery page): half as many again.
  starBonus: { two: 0, three: 0.5 },
  looks: {
    eyeHeight: 1.6,
    pitch: 18,
    distance: 34,
    bowDistance: 1.25,
    bowSize: 0.62,
    treeDistance: { min: 46, max: 80 },
    treeHeight: { min: 7, max: 13 },
    seed: 7,
    tiers: {
      high: { pixelRatio: 2, clouds: 9, trees: 46, featherPuff: 14 },
      low: { pixelRatio: 1.5, clouds: 4, trees: 22, featherPuff: 6 },
    },
  },
  feel: {
    gravity: 20,
    arrowSpeed: 1,
    birdSpeed: 1,
    hitRadius: 1,
    nearMiss: 2.6,
    fullDrawPx: 150,
    minDraw: 0.15,
    previewSeconds: 0.3,
    hitStopMs: 70,
    shakeStrength: 1,
    buzzDrawMs: 6,
    buzzReleaseMs: 18,
    buzzHitMs: 35,
    buzzPoopMs: 20,
  },
} satisfies GameDataInput['archery'];
