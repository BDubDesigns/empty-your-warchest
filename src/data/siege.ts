import type { GameDataInput } from './schema';

type Block = GameDataInput['siege']['forts'][number]['blocks'][number];
type Size = Block['size'];

// The siege (M8 feel prototype). Every number is a first guess, meant to be tuned on a phone.
// Metres and seconds; the line of throwers stands across the origin and throws toward −z.

/** Wall blocks: a full stone, the half stone that squares off every other course, a merlon. */
const STONE: Size = [1, 0.6, 0.7];
const HALF_STONE: Size = [0.5, 0.6, 0.7];
const MERLON: Size = [0.5, 0.4, 0.7];

/**
 * A wall of `material` `wide` stones across and `courses` high, centred on x = 0 at depth `z`, laid
 * like brickwork (every other course shifted half a stone, so the joints don't line up), with a
 * merlon on every stone of the top course. Only a shorthand for writing the blocks out: the fort is
 * the list it makes (checked at startup like any other).
 */
function wall(wide: number, courses: number, z: number, material: string): Block[] {
  const blocks: Block[] = [];
  const height = STONE[1];
  for (let course = 0; course < courses; course++) {
    const y = height / 2 + course * height;
    const shifted = course % 2 === 1;
    const stones = shifted ? wide - 1 : wide;
    for (let index = 0; index < stones; index++) {
      blocks.push({ material, size: STONE, at: [index - (stones - 1) / 2, y, z] });
    }
    if (shifted) {
      const end = wide / 2 - HALF_STONE[0] / 2;
      blocks.push({ material, size: HALF_STONE, at: [-end, y, z] });
      blocks.push({ material, size: HALF_STONE, at: [end, y, z] });
    }
  }
  const top = courses * height;
  const topStones = courses % 2 === 0 ? wide - 1 : wide;
  for (let index = 0; index < topStones; index++) {
    const x = index - (topStones - 1) / 2;
    blocks.push({ material, size: MERLON, at: [x, top + MERLON[1] / 2, z] });
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
 * banner's pole standing in the middle of the top one. The front posts (facing the thrower) of
 * storey `weak` are thin: the weak point. They're kept low enough that the wall shields them (no
 * throw clears the wall and comes down on them until it's breached), and the storeys above stand
 * clear over the battlements, so you see what you're bringing down: hit the thin posts and
 * everything over them tips forward, banner and all.
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
        // +z is the front, toward the thrower.
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

export const siege = {
  item: 'spear',
  // 5 throwers at Command 1 and one more every 5 levels: an aimed throw is 5 spears, a barrage 15,
  // so a fire pit round (6 to 18 spears) is about a throw or two.
  throwers: { skill: 'command', start: 5, everyLevels: 5, add: 1, spacing: 0.75, converge: 17 },
  barrage: 3,
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
    // Just right of the thrower's head, where it leaves the throwing hand.
    launch: [0.3, 1.8, -0.3],
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
  // A spear at a good pull (about 20 m/s) deals about 28: a stone takes four or five hits, a
  // wooden beam two, a thin post one.
  damage: { spearMinSpeed: 6, spearPerSpeed: 2, crashMinSpeed: 3, crashPerSpeed: 6 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05, hp: 120 },
    // Rough, loosely laid stone for the first fort: lighter and quicker to break.
    { id: 'fieldstone', kind: 'stone', density: 1500, friction: 0.75, restitution: 0.05, hp: 70 },
    { id: 'wood', kind: 'wood', density: 450, friction: 0.7, restitution: 0.1, hp: 45 },
  ],
  forts: [
    {
      // Par 3 throws: a barrage to breach the wall, an aimed throw or two at the posts. A scripted
      // player takes 15 to 25 spears with 5 throwers (1 to 3 throws). The wall is 3.4 m high: no
      // throw comes over it low enough to reach the thin posts (1.5 to 2.7 m), only the storey above.
      id: 'outpost',
      name: 'Outpost',
      objective: { kind: 'banner_down' },
      par: 3,
      rewards: { xpPerBlock: 3, winXp: 60 },
      blocks: [...wall(5, 5, -16, 'fieldstone'), ...keep([1.2, 1.2, 1.4], 1, 2.4, 2, 0.3, -19.5)],
    },
    {
      // Par 5: two barrages and an aimed throw or three. A scripted player takes 30 to 55 spears.
      id: 'stronghold',
      name: 'Stronghold',
      objective: { kind: 'banner_down' },
      par: 5,
      rewards: { xpPerBlock: 3, winXp: 120 },
      blocks: [...wall(7, 6, -17, 'stone'), ...keep([1.6, 1.6, 1.2], 1, 3, 2.4, 0.3, -21)],
    },
  ],
  feel: {
    minSpeed: 10,
    maxSpeed: 27,
    elevation: 12,
    maxAim: 25,
    aimScale: 0.6,
    pullPx: 220,
    deadPx: 18,
    aimedSpread: 1,
    aimedPowerJitter: 0.02,
    aimedPreviewSeconds: 0.35,
    barrageSpread: 7,
    barragePowerJitter: 0.1,
    barragePreviewSeconds: 0.15,
    barrageStagger: 0.15,
    lineStagger: 0.04,
    spearMass: 30,
    reloadSeconds: 0.9,
    cameraHeight: 5.2,
    cameraBack: 5.5,
    cameraLookAhead: 16,
    cameraLookHeight: 0,
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
    buzzBannerMs: 120,
  },
} satisfies GameDataInput['siege'];
