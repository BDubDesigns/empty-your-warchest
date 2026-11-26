import type { GameDataInput } from './schema';

type Block = GameDataInput['siege']['forts'][number]['blocks'][number];
type Size = Block['size'];

// The siege (M8 feel prototype). Every number is a first guess, meant to be tuned on a phone.
// Metres and seconds; the ballista starts at the origin and shoots toward −z.

/** Wall blocks: a full stone, the half stone that squares off every other course, a merlon. */
const STONE: Size = [1, 0.6, 0.7];
const HALF_STONE: Size = [0.5, 0.6, 0.7];
const MERLON: Size = [0.5, 0.4, 0.7];

/**
 * A wall of `material` `wide` stones across and `courses` high, centred on `x` at depth `z`, laid
 * like brickwork (every other course shifted half a stone, so the joints don't line up), with a
 * merlon on every stone of the top course unless `merlons` is false. Only a shorthand for writing
 * the blocks out: the fort is the list it makes (checked at startup like any other).
 */
function wall(
  wide: number,
  courses: number,
  at: { x: number; z: number },
  material: string,
  merlons = true,
): Block[] {
  const blocks: Block[] = [];
  const height = STONE[1];
  const { x, z } = at;
  for (let course = 0; course < courses; course++) {
    const y = height / 2 + course * height;
    const shifted = course % 2 === 1;
    const stones = shifted ? wide - 1 : wide;
    for (let index = 0; index < stones; index++) {
      blocks.push({ material, size: STONE, at: [x + index - (stones - 1) / 2, y, z] });
    }
    if (shifted) {
      const end = wide / 2 - HALF_STONE[0] / 2;
      blocks.push({ material, size: HALF_STONE, at: [x - end, y, z] });
      blocks.push({ material, size: HALF_STONE, at: [x + end, y, z] });
    }
  }
  if (!merlons) return blocks;
  const top = courses * height;
  const topStones = courses % 2 === 0 ? wide - 1 : wide;
  for (let index = 0; index < topStones; index++) {
    const across = x + index - (topStones - 1) / 2;
    blocks.push({ material, size: MERLON, at: [across, top + MERLON[1] / 2, z] });
  }
  return blocks;
}

/** Keep parts: a corner post and the thin post that's a weak point (each as wide as deep), the pole. */
const POST = 0.3;
const THIN_POST = 0.14;
const POLE: Size = [0.14, 1.4, 0.14];
/** A weak post breaks at a single good hit. The banner never breaks: it has to be brought down. */
const WEAK_HP = 15;
const BANNER_HP = 100000;

/**
 * A wooden keep at depth `z`, a storey for each of `storeys` (its posts' height): a post at every
 * corner of a `width` × `depth` floor, and the floor (a plank slab `slab` thick) on top, with the
 * banner's pole standing in the middle of the top one. The front posts (facing the ballista) of
 * storey `weak` are thin: the weak point. Hit them and everything over them tips forward, banner
 * and all.
 */
function keep(
  storeys: number[],
  weak: number,
  width: number,
  depth: number,
  slab: number,
  z: number,
): Block[] {
  const blocks: Block[] = [];
  const inset = 0.25;
  let floor = 0;
  storeys.forEach((height, storey) => {
    for (const x of [-1, 1]) {
      for (const side of [-1, 1]) {
        // +z is the front, toward the ballista.
        const thin = storey === weak && side === 1;
        const across = thin ? THIN_POST : POST;
        blocks.push({
          material: 'wood',
          size: [across, height, across],
          at: [x * (width / 2 - inset), floor + height / 2, z + side * (depth / 2 - inset)],
          ...(thin && { weak: true, hp: WEAK_HP }),
        });
      }
    }
    floor += height;
    blocks.push({ material: 'wood', size: [width, slab, depth], at: [0, floor + slab / 2, z] });
    floor += slab;
  });
  blocks.push({
    material: 'wood',
    size: POLE,
    at: [0, floor + POLE[1] / 2, z],
    banner: true,
    hp: BANNER_HP,
  });
  return blocks;
}

/**
 * A wooden watch platform: four posts `height` tall round a `size` square at (`x`, `z`), and a
 * floor on them for a guard to stand on.
 */
function platform(x: number, z: number, size: number, height: number): Block[] {
  const half = size / 2 - POST / 2;
  return [
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz): Block => ({
        material: 'wood',
        size: [POST, height, POST],
        at: [x + sx * half, height / 2, z + sz * half],
      })),
    ),
    { material: 'wood', size: [size, 0.2, size], at: [x, height + 0.1, z] },
  ];
}

/** Three spots side by side at depth `z`, the middle one at x = 0. */
function spots(z: number): [number, number][] {
  return [
    [-3, z],
    [0, z],
    [3, z],
  ];
}

// The Outpost, taken in three positions. Spears leave at 15 m/s, so nothing reaches past about
// 27 m (a barrage's fastest, tilted best): the keep is over 30 m from the courtyard, so the banner
// can only come down from in front of the keep (checked at startup).
const OUTER_WALL_Z = -12;
const COURTYARD_Z = -26;
const KEEP_Z = -50;

export const siege = {
  item: 'spear',
  // An aimed volley of 5 at Command 1, one more every 5 levels; a barrage is three times that. A
  // fire pit round (6 to 18 spears) is a volley or three.
  ballista: {
    skill: 'command',
    aimed: { start: 5, everyLevels: 5, add: 1 },
    barrageTimes: 3,
    speed: 15,
    // Low enough to skim the ground, high enough to lob over cover.
    tilt: { min: 3, max: 40, start: 10 },
    pivotHeight: 1.2,
    muzzle: 1,
    spacing: 0.08,
    size: [1.4, 1.1, 2.2],
  },
  // A soldier about as tall as a man, heavy enough to stand a glancing blow; one good spear (or a
  // stone on the head) brings him down.
  guard: { size: [0.45, 1.75, 0.35], density: 400, friction: 0.8, hp: 20, downTilt: 50, topple: 2 },
  // 60 steps a second keeps a phone's frame budget; the spears use continuous collision
  // detection, so even the fastest can't skip through a block between two steps.
  physics: {
    timestep: 1 / 60,
    gravity: 9.81,
    solverIterations: 8,
    maxStepsPerFrame: 4,
    groundFriction: 0.9,
    groundReach: 150,
  },
  projectile: {
    length: 2,
    radius: 0.05,
    friction: 0.7,
    restitution: 0.1,
    landedDamping: 0.6,
    landedSpinDamping: 8,
  },
  settle: { speed: 0.15, spin: 0.3, seconds: 1, winSeconds: 4 },
  down: { drop: 0.25, tilt: 25 },
  // Lying on the ground, or on rubble no higher than a stone or two.
  banner: { winHeight: 1.2, fallTilt: 35 },
  stars: { by: 'throws', three: 1, two: 1.5 },
  // The same as woodcutting's, splitting's and firemaking's.
  starBonus: { two: 0.1, three: 0.25 },
  // A spear at 15 m/s deals about 22: a guard or a thin post goes down at one hit, a wooden beam
  // takes two, fieldstone three or four, dressed stone six.
  damage: { spearMinSpeed: 6, spearPerSpeed: 2.5, crashMinSpeed: 3, crashPerSpeed: 6 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05, hp: 120 },
    // Rough, loosely laid stone for the first fort: lighter and quicker to break.
    { id: 'fieldstone', kind: 'stone', density: 1500, friction: 0.75, restitution: 0.05, hp: 70 },
    { id: 'wood', kind: 'wood', density: 450, friction: 0.7, restitution: 0.1, hp: 45 },
  ],
  forts: [
    {
      // Par 7 shots: about 2 at the wall, 3 in the courtyard, 2 at the keep; 35 spears in aimed
      // volleys of 5, more with a barrage or two (a scripted player takes 25 to 45).
      id: 'outpost',
      name: 'Outpost',
      par: 7,
      rewards: { xpPerBlock: 2, xpPerGuard: 10, winXp: 80 },
      blocks: [
        // The outer wall, either side of the gate, a guard in a crenel on each half.
        ...wall(3, 3, { x: -2.5, z: OUTER_WALL_Z }, 'fieldstone'),
        ...wall(3, 3, { x: 2.5, z: OUTER_WALL_Z }, 'fieldstone'),
        // The courtyard: a low wall two guards duck behind, and a watch platform.
        ...wall(6, 2, { x: 0, z: COURTYARD_Z }, 'fieldstone', false),
        ...platform(4, COURTYARD_Z - 1, 1.6, 2),
        // The keep, behind its own low wall.
        ...wall(5, 2, { x: 0, z: KEEP_Z + 4 }, 'fieldstone', false),
        ...keep([1.2, 1.2, 1.4], 1, 2.4, 2, 0.3, KEEP_Z),
      ],
      positions: [
        {
          name: 'The outer wall',
          spots: spots(0),
          guards: [{ at: [-2, 1.8, OUTER_WALL_Z] }, { at: [2, 1.8, OUTER_WALL_Z] }],
          objective: { kind: 'guards_down' },
        },
        {
          name: 'The courtyard',
          spots: spots(-18),
          guards: [
            { at: [-1.5, 0, COURTYARD_Z - 1.2] },
            { at: [1, 0, COURTYARD_Z - 1.2] },
            { at: [4, 2.2, COURTYARD_Z - 1] },
          ],
          objective: { kind: 'guards_down' },
        },
        {
          name: 'The keep',
          spots: spots(KEEP_Z + 11),
          objective: { kind: 'banner_down' },
        },
      ],
    },
    {
      // One position for now (its redesign is next): a dressed stone wall to batter through.
      id: 'stronghold',
      name: 'Stronghold',
      par: 6,
      rewards: { xpPerBlock: 3, xpPerGuard: 10, winXp: 120 },
      blocks: [
        ...wall(7, 6, { x: 0, z: -17 }, 'stone'),
        ...keep([1.6, 1.6, 1.2], 1, 3, 2.4, 0.3, -21),
      ],
      positions: [{ name: 'The stronghold', spots: spots(0), objective: { kind: 'banner_down' } }],
    },
  ],
  feel: {
    yawPerPx: 0.12,
    tiltPerPx: 0.1,
    maxAim: 30,
    deadPx: 12,
    aimedSpread: 1,
    aimedTiltSpread: 0.5,
    aimedSpeedStray: 0.015,
    barrageSpread: 7,
    barrageTiltSpread: 3,
    barrageSpeedStray: 0.07,
    barrageStagger: 0.15,
    lineStagger: 0.04,
    previewShare: 0.35,
    spearMass: 30,
    reloadSeconds: 0.9,
    spotSeconds: 0.6,
    advanceDelaySeconds: 1.2,
    advanceSeconds: 2.5,
    cameraHeight: 4.6,
    cameraBack: 8,
    cameraLookAhead: 15,
    cameraLookHeight: 1,
    cameraTurn: 0.6,
    sightBlend: 0,
    followSeconds: 0.7,
    follow: 0.5,
    followReturnSeconds: 0.8,
    hitStopMs: 45,
    heavyHitStopMs: 90,
    heavyHitSpeed: 18,
    shakeStrength: 1,
    thudSpeed: 2.5,
    thudGapSeconds: 0.25,
    dust: 6,
    slowMo: 0.3,
    slowMoSeconds: 1.6,
    buzzThrowMs: 15,
    buzzBarrageMs: 35,
    buzzHitMs: 20,
    buzzThudMs: 12,
    buzzBreakMs: 45,
    buzzGuardMs: 40,
    buzzBannerMs: 120,
  },
} satisfies GameDataInput['siege'];
