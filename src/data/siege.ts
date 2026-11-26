import type { GameDataInput } from './schema';

type Fort = GameDataInput['siege']['forts'][number];
type Piece = Fort['pieces'][number];

// The siege (M8 feel prototype). Every number is a first guess, meant to be tuned on a phone.
// Metres and seconds; the weapon starts at the origin and shoots toward −z.
//
// The ballista shoots flat and fast: at its highest tilt nothing it shoots ever gets much above
// 3 m, so a wall five stones high blocks every shot from in front of it (checked at startup), and
// the banner, up on the keep, can only come down with the keep.

/** How high a wall stone is: a wall's height is its courses of these. */
const STONE_HEIGHT = 0.6;

/** Three spots side by side at depth `z`, the middle one at x = 0. */
function spots(z: number): [number, number][] {
  return [
    [-3, z],
    [0, z],
    [3, z],
  ];
}

/**
 * A wall `courses` high from x = `from` to `to` at depth `z`, with a gate `width` across at
 * `gate`: two wall runs either side of it (each a whole number of stones long).
 */
function gatedWall(
  z: number,
  courses: number,
  material: string,
  span: { from: number; to: number },
  gate: { at: number; width: number },
): Piece[] {
  const left = gate.at - gate.width / 2;
  const right = gate.at + gate.width / 2;
  return [
    {
      kind: 'wall',
      at: [(span.from + left) / 2, z],
      length: left - span.from,
      courses,
      material,
    },
    {
      kind: 'gate',
      at: [gate.at, z],
      width: gate.width,
      height: courses * STONE_HEIGHT,
      material: 'wood',
    },
    { kind: 'wall', at: [(right + span.to) / 2, z], length: span.to - right, courses, material },
  ];
}

/**
 * The two forts share a plan: an outer wall with a gate in the middle, a courtyard, a high inner
 * wall with its gate off to one side (so no shot through both gates finds the keep), and the
 * keep. The weapon rolls in through the inner gate on its way to the keep.
 */
const OUTER = { z: -11, span: { from: -5.5, to: 5.5 }, gate: { at: 0, width: 3 } };
const INNER = { z: -27, span: { from: -6, to: 8 }, gate: { at: 4.5, width: 3 } };
const THROUGH_INNER_GATE: [number, number][] = [
  [4.5, -24],
  [4.5, -29.5],
];

export const siege = {
  item: 'spear',
  weapons: [
    {
      // An aimed volley of 5 at Command 1, one more every 5 levels; a barrage is three times that.
      // A fire pit round (6 to 18 spears) is a volley or three. Fast and flat: a few degrees of
      // tilt either way is all it has.
      id: 'ballista',
      name: 'Ballista',
      skill: 'command',
      aimed: { start: 5, everyLevels: 5, add: 1 },
      barrageTimes: 3,
      speed: 38,
      tilt: { min: -4, max: 8, start: 1 },
      pivotHeight: 1.2,
      muzzle: 1,
      spacing: 0.08,
      size: [1.4, 1.1, 2.2],
    },
  ],
  weapon: 'ballista',
  // A soldier about as tall as a man: a direct hit brings him down.
  guard: { size: [0.45, 1.75, 0.35], density: 400, friction: 0.8, hp: 20, downTilt: 50, topple: 2 },
  parts: {
    stone: [1, STONE_HEIGHT, 0.7],
    halfStone: [0.5, STONE_HEIGHT, 0.7],
    merlon: [0.5, 0.4, 0.7],
    towerBlock: 1.6,
    post: 0.3,
    thinPost: 0.14,
    slab: 0.3,
    platform: 1.6,
    platformSlab: 0.2,
    gateDepth: 0.3,
    pole: [0.14, 1.4, 0.14],
    // A gate leaf goes at two hits (an aimed volley at it), a thin post at one.
    gateHp: 50,
    weakHp: 25,
    bannerHp: 100000,
  },
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
  // A spear at 38 m/s deals about 28: a guard or a thin post at one hit, a gate leaf or a wooden
  // beam at two, fieldstone three, dressed stone four or five (two aimed volleys).
  damage: { spearMinSpeed: 10, spearPerSpeed: 1, crashMinSpeed: 3, crashPerSpeed: 6 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05, hp: 120 },
    // Rough, loosely laid stone for the first fort: lighter and quicker to break.
    { id: 'fieldstone', kind: 'stone', density: 1500, friction: 0.75, restitution: 0.05, hp: 80 },
    { id: 'wood', kind: 'wood', density: 450, friction: 0.7, restitution: 0.1, hp: 50 },
    // The inner curtain wall: massive. It's what keeps the keep out of reach from the courtyard,
    // so no amount of spears should open it (the inner gate's the way through).
    { id: 'curtain', kind: 'stone', density: 2200, friction: 0.85, restitution: 0.05, hp: 600 },
  ],
  forts: [
    {
      // Par 8 shots: a gate and two guards behind it, three guards in the courtyard, the keep's
      // two thin posts. In aimed volleys of 5 that's about 40 spears (a scripted player takes
      // 25 to 45).
      id: 'outpost',
      name: 'Outpost',
      par: 8,
      rewards: { xpPerBlock: 2, xpPerGuard: 10, winXp: 80 },
      pieces: [
        // The outer wall and its gate, two guards behind the gate.
        ...gatedWall(OUTER.z, 5, 'fieldstone', OUTER.span, OUTER.gate),
        { kind: 'post', at: [-0.6, -12.5], guard: 0 },
        { kind: 'post', at: [0.6, -12.5], guard: 0 },
        // The courtyard: two guards ducking behind a low wall, one on a watch platform.
        { kind: 'cover', at: [0, -22], length: 6, material: 'fieldstone' },
        { kind: 'post', at: [-1.5, -23.2], guard: 1 },
        { kind: 'post', at: [1.2, -23.2], guard: 1 },
        { kind: 'platform', at: [4, -23], height: 1.4, guard: 1 },
        // The inner wall: high, so the banner is out of sight from the courtyard.
        ...gatedWall(INNER.z, 8, 'curtain', INNER.span, INNER.gate),
        // The keep, behind its own low wall.
        { kind: 'cover', at: [0, -37.5], length: 5, material: 'fieldstone' },
        { kind: 'keep', at: [0, -41], storeys: [1.2, 1.2, 1.4], weak: 1, width: 2.4, depth: 2 },
      ],
      positions: [
        { name: 'The outer gate', spots: spots(0), objective: { kind: 'guards_down' } },
        { name: 'The courtyard', spots: spots(-16), objective: { kind: 'guards_down' } },
        {
          name: 'The keep',
          spots: spots(-32),
          approach: THROUGH_INNER_GATE,
          objective: { kind: 'banner_down' },
        },
      ],
    },
    {
      // Harder: dressed stone, a gate, guards on towers you have to bring down from under them.
      // Par 12 shots, about 60 spears in aimed volleys (a scripted player takes 45 to 80).
      id: 'stronghold',
      name: 'Stronghold',
      par: 12,
      rewards: { xpPerBlock: 3, xpPerGuard: 12, winXp: 160 },
      pieces: [
        ...gatedWall(OUTER.z, 5, 'stone', OUTER.span, OUTER.gate),
        { kind: 'post', at: [-0.6, -12.5], guard: 0 },
        { kind: 'post', at: [0.6, -12.5], guard: 0 },
        // A tower behind the wall: its guard falls when the wall in front and under him goes.
        { kind: 'tower', at: [-4, -12.6], courses: 3, material: 'stone', guard: 0 },
        { kind: 'cover', at: [0, -22], length: 6, material: 'stone' },
        { kind: 'post', at: [-1.5, -23.2], guard: 1 },
        { kind: 'post', at: [1.2, -23.2], guard: 1 },
        { kind: 'tower', at: [4.2, -23], courses: 3, material: 'stone', guard: 1 },
        ...gatedWall(INNER.z, 8, 'curtain', INNER.span, INNER.gate),
        { kind: 'cover', at: [0, -37.5], length: 5, material: 'stone' },
        { kind: 'keep', at: [0, -41], storeys: [1.4, 1.4, 1.2], weak: 1, width: 3, depth: 2.4 },
      ],
      positions: [
        { name: 'The gatehouse', spots: spots(0), objective: { kind: 'guards_down' } },
        { name: 'The bailey', spots: spots(-16), objective: { kind: 'guards_down' } },
        {
          name: 'The keep',
          spots: spots(-32),
          approach: THROUGH_INNER_GATE,
          objective: { kind: 'banner_down' },
        },
      ],
    },
  ],
  feel: {
    crosshairSpeed: 0.6,
    maxAim: 30,
    aimedSpread: 1,
    aimedTiltSpread: 0.4,
    aimedSpeedStray: 0.015,
    barrageSpread: 7,
    barrageTiltSpread: 2,
    barrageSpeedStray: 0.07,
    barrageStagger: 0.15,
    lineStagger: 0.04,
    aimLineLength: 5,
    ghostWidth: 0.07,
    spearMass: 14,
    reloadSeconds: 0.9,
    spotSeconds: 0.6,
    advanceDelaySeconds: 1.2,
    advanceSeconds: 2.5,
    cameraHeight: 4.6,
    cameraBack: 8,
    cameraLookAhead: 15,
    cameraLookHeight: 1,
    cameraClearance: 0.5,
    cameraTurn: 0.6,
    sightBlend: 0,
    scoutHeight: 42,
    scoutBack: 14,
    scoutSeconds: 0.8,
    followSeconds: 0.7,
    follow: 0.5,
    followReturnSeconds: 0.8,
    hitStopMs: 45,
    heavyHitStopMs: 90,
    heavyHitSpeed: 38,
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
