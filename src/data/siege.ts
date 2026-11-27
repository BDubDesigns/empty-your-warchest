import type { GameDataInput } from './schema';

type Fort = GameDataInput['siege']['forts'][number];
type Piece = Fort['pieces'][number];
type Window = Extract<Piece, { kind: 'wall' }>['windows'] extends (infer W)[] | undefined
  ? W
  : never;

/** A glazed window `width` stones across from stone `from`, `courses` high from course `sill`. */
function window(from: number, width: number, sill: number, courses: number): Window {
  return { from, width, sill, courses, glass: 'glass', lintel: 'lintel' };
}

// The siege (M8 feel prototype). Every number is a first guess, meant to be tuned on a phone.
// Metres and seconds; the weapon starts at the origin and shoots toward −z.
//
// The ballista shoots flat and fast: at its highest tilt nothing it shoots ever gets much above
// 3 m by the first wall, so a wall six stones high blocks every shot from in front of it (checked
// at startup), and the banner, up on the keep, can only come down with the keep. You look down
// its sights, so the drop over 20 m (about a metre) is yours to learn.

/** How high a wall stone is: a wall's height is its courses of these. */
const STONE_HEIGHT = 0.6;

/** Three spots 10 m apart at depth `z`, the middle one at x = 0. */
function spots(z: number): [number, number][] {
  return [
    [-10, z],
    [0, z],
    [10, z],
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
  windows: { left?: Window[]; right?: Window[] } = {},
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
      windows: windows.left ?? [],
    },
    {
      kind: 'gate',
      at: [gate.at, z],
      width: gate.width,
      height: courses * STONE_HEIGHT,
      material: 'wood',
    },
    {
      kind: 'wall',
      at: [(right + span.to) / 2, z],
      length: span.to - right,
      courses,
      material,
      windows: windows.right ?? [],
    },
  ];
}

/** The rolls in through a gate at `x` in a wall at depth `z`: up to it, then through. */
function throughGate(x: number, z: number): [number, number][] {
  return [
    [x, z + 3],
    [x, z - 3],
  ];
}

/**
 * The two forts share a plan, 29 m wide: an outer wall 20 m from where the weapon starts, its
 * gate off to one side; a courtyard whose guards stand on the far side from that gate, so no line
 * through it finds them; a high inner wall with its gate off to the other side; and the keep,
 * 20 m on from where the weapon stops inside. The Stronghold is the Outpost mirrored, in stone.
 */
const SPAN = { from: -14.5, to: 14.5 };
/** Where a walkway behind a wall at depth `z` stands: just clear of the wall's back. */
const behind = (z: number) => z - 0.9;
const OUTER_Z = -20;
const INNER_Z = -54;
const COURTYARD_Z = -26;
const KEEP_SPOTS_Z = -58;

export const siege = {
  item: 'spear',
  potion: 'sense_potion',
  weapons: [
    {
      // An aimed volley of 5 at Command 1, one more every 5 levels; a barrage is three times that.
      // A fire pit round (6 to 18 spears) is a volley or three. Fast and flat: a few degrees of
      // tilt either way is all it has. At 90 m/s a spear drops about 0.2 m over the 19 m to the
      // first wall, and Fire allows for that: aimed, it hits what the crosshair is on.
      id: 'ballista',
      name: 'Ballista',
      skill: 'command',
      aimed: { start: 5, everyLevels: 5, add: 1 },
      barrageTimes: 3,
      speed: 90,
      tilt: { min: -3, max: 10, start: 1 },
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
    walkway: 2,
    walkwayWidth: 1,
    pane: 0.12,
    // A gate leaf or a thin post under the keep goes at two hits (an aimed volley at it).
    gateHp: 50,
    weakHp: 50,
    // The keep's other posts and the wall behind its thin ones, as good as unbreakable: with the
    // thin posts gone the keep tips forward over that wall, and the banner comes down with it.
    keepPostHp: 1000,
    bannerHp: 100000,
  },
  // Walking the walkway, a guard crosses a 12 m one in about 15 s; alerted, he dashes from cover
  // to cover, out of sight a moment and out for a shot a moment.
  guardMoves: {
    patrolSpeed: 0.8,
    patrolPause: 1.2,
    alertSpeed: 2,
    alertPause: 1.4,
    alertLean: 0.9,
    duck: 0.8,
    wakeSeconds: 1.2,
  },
  // The first shot alerts the guards on the wall in front (20-odd metres off), but not sleepers.
  // Smashing stone wakes everything near it; a clean hit on a guard is all but silent.
  noise: {
    fire: 25,
    hit: { stone: 12, wood: 8, glass: 10, guard: 3 },
    // Glass shattering is loud: it wakes everyone near it.
    break: { stone: 22, wood: 16, glass: 24 },
    crashShare: 0.5,
    sleepShare: 0.4,
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
    afterHit: 0.15,
  },
  settle: { speed: 0.15, spin: 0.3, seconds: 1, winSeconds: 4 },
  down: { drop: 0.25, tilt: 25 },
  // Lying on the ground, or on rubble no higher than a stone or two.
  banner: { winHeight: 1.2, fallTilt: 35 },
  stars: { by: 'throws', three: 1, two: 1.5 },
  // The same as woodcutting's, splitting's and firemaking's.
  starBonus: { two: 0.1, three: 0.25 },
  // A spear at 90 m/s deals about 30: a guard at one hit, a gate leaf or a wooden beam at two,
  // fieldstone at three, dressed stone at four (an aimed volley or two).
  damage: { spearMinSpeed: 10, spearPerSpeed: 0.375, crashMinSpeed: 3, crashPerSpeed: 6 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05, hp: 120 },
    // Rough, loosely laid stone for the first fort: lighter and quicker to break.
    { id: 'fieldstone', kind: 'stone', density: 1500, friction: 0.75, restitution: 0.05, hp: 80 },
    { id: 'wood', kind: 'wood', density: 450, friction: 0.7, restitution: 0.1, hp: 50 },
    // The inner curtain wall: massive. It's what keeps the keep out of reach from the courtyard,
    // so no amount of spears should open it (the inner gate's the way through).
    { id: 'curtain', kind: 'stone', density: 2200, friction: 0.85, restitution: 0.05, hp: 600 },
    // A window's pane: a touch shatters it, and a spear goes on through.
    { id: 'glass', kind: 'glass', density: 2500, friction: 0.4, restitution: 0.05, hp: 1 },
    // A window's lintel: a stout beam, so the wall over a window stands when the glass goes.
    { id: 'lintel', kind: 'wood', density: 700, friction: 0.7, restitution: 0.1, hp: 200 },
  ],
  forts: [
    {
      // The first fort, and the easiest: every guard is in sight from the start (a walker standing
      // tall on his walkway, one behind a window, one on a platform), and par is loose.
      id: 'outpost',
      name: 'Outpost',
      par: 9,
      guardsVisible: 'all',
      rewards: { xpPerBlock: 2, xpPerGuard: 10, winXp: 80 },
      pieces: [
        // The outer wall, its gate to the left: a guard walking the walkway behind the wall to
        // the right of it, high, so he's well above the battlements; one behind a window to the
        // left of the gate.
        ...gatedWall(
          OUTER_Z,
          6,
          'fieldstone',
          SPAN,
          { at: -5, width: 3 },
          { left: [window(2, 2, 1, 3)] },
        ),
        {
          kind: 'walkway',
          at: [6, behind(OUTER_Z)],
          segments: 6,
          height: 3.2,
          guard: 0,
          watch: 'patrol',
        },
        { kind: 'post', at: [-11.5, -21], guard: 0 },
        // The courtyard, over to the right: a low wall, and a guard asleep on a watch platform.
        { kind: 'cover', at: [8, -44], length: 8, material: 'fieldstone' },
        { kind: 'platform', at: [12.8, -46], height: 1.4, guard: 1, watch: 'sleep' },
        // The inner wall, its gate to the left: high, so the keep is out of sight from the
        // courtyard.
        ...gatedWall(INNER_Z, 8, 'curtain', SPAN, { at: -9, width: 3 }),
        // The keep, behind its own low wall.
        { kind: 'cover', at: [3, -75], length: 6, material: 'fieldstone' },
        {
          kind: 'keep',
          at: [3, -78],
          storeys: [1.2, 1.2, 1.4],
          weak: 1,
          back: 'fieldstone',
          width: 2.4,
          depth: 2,
        },
      ],
      positions: [
        { name: 'The outer gate', spots: spots(0), objective: { kind: 'guards_down' } },
        {
          name: 'The courtyard',
          spots: spots(COURTYARD_Z),
          approach: throughGate(-5, OUTER_Z),
          objective: { kind: 'guards_down' },
        },
        {
          name: 'The keep',
          spots: spots(KEEP_SPOTS_Z),
          approach: throughGate(-9, INNER_Z),
          objective: { kind: 'banner_down' },
        },
      ],
    },
    {
      // Harder: dressed stone, and guards on towers you have to bring down from under them. A
      // scripted player at Command 17 takes 8 to 10 shots, 60 to 100 spears.
      id: 'stronghold',
      name: 'Stronghold',
      par: 10,
      rewards: { xpPerBlock: 3, xpPerGuard: 12, winXp: 160 },
      pieces: [
        ...gatedWall(OUTER_Z, 6, 'stone', SPAN, { at: 5, width: 3 }),
        // A guard walking the long walkway to the left of the gate, one asleep on the short one
        // to the right, and one asleep behind the gate.
        {
          kind: 'walkway',
          at: [-7, behind(OUTER_Z)],
          segments: 6,
          height: 2.7,
          guard: 0,
          watch: 'patrol',
        },
        {
          kind: 'walkway',
          at: [10.5, behind(OUTER_Z)],
          segments: 3,
          height: 2.7,
          guard: 0,
          watch: 'sleep',
        },
        { kind: 'post', at: [5, -21.6], guard: 0, watch: 'sleep' },
        // The bailey: a room behind a wall with a window, a guard at the window and one asleep
        // out of sight beside it.
        {
          kind: 'wall',
          at: [-8, -44],
          length: 8,
          courses: 4,
          material: 'stone',
          merlons: false,
          windows: [window(4, 2, 1, 2)],
        },
        { kind: 'post', at: [-7, -45.2], guard: 1 },
        { kind: 'post', at: [-9.5, -45.2], guard: 1, watch: 'sleep' },
        { kind: 'tower', at: [-12.6, -46.4], courses: 2, material: 'stone', guard: 1 },
        ...gatedWall(INNER_Z, 8, 'curtain', SPAN, { at: 9, width: 3 }),
        { kind: 'cover', at: [-3, -75], length: 6, material: 'stone' },
        {
          kind: 'keep',
          at: [-3, -78],
          storeys: [1.4, 1.4, 1.2],
          weak: 1,
          back: 'stone',
          width: 3,
          depth: 2.4,
        },
      ],
      positions: [
        { name: 'The gatehouse', spots: spots(0), objective: { kind: 'guards_down' } },
        {
          name: 'The bailey',
          spots: spots(COURTYARD_Z),
          approach: throughGate(5, OUTER_Z),
          objective: { kind: 'guards_down' },
        },
        {
          name: 'The keep',
          spots: spots(KEEP_SPOTS_Z),
          approach: throughGate(9, INNER_Z),
          objective: { kind: 'banner_down' },
        },
      ],
    },
  ],
  feel: {
    lookYawPerPx: 0.12,
    lookTiltPerPx: 0.05,
    maxAim: 40,
    aimFallback: 60,
    reticleSize: 64,
    aimedSpread: 0.3,
    aimedTiltSpread: 0.15,
    aimedSpeedStray: 0.015,
    barrageSpread: 10,
    barrageTiltSpread: 2,
    barrageSpeedStray: 0.07,
    barrageStagger: 0.15,
    lineStagger: 0.04,
    ghostWidth: 0.07,
    spearMass: 6,
    reloadSeconds: 0.9,
    spotSeconds: 0.6,
    advanceDelaySeconds: 1.2,
    advanceSeconds: 2.5,
    sightFov: 55,
    sightBack: 0.5,
    sightNear: 0.8,
    kickBack: 0.3,
    kickTilt: 1.5,
    kickSeconds: 0.22,
    cameraClearance: 0.5,
    zzzSize: 0.9,
    zzzRise: 1.2,
    zzzSeconds: 2.4,
    zzzDrift: 0.25,
    senseSeconds: 10,
    ghostPx: 4,
    markSize: 1,
    markSeconds: 1.6,
    flyoverSeconds: 7,
    flyoverHeight: 12,
    flyoverBack: 14,
    scoutHeight: 90,
    scoutBack: 35,
    scoutSeconds: 0.8,
    boltCamBack: 2.2,
    boltCamRise: 0.45,
    boltCamInSeconds: 0.12,
    boltCamHoldSeconds: 0.35,
    boltCamReturnSeconds: 0.45,
    killCamSeconds: 1,
    killCamSlowMo: 0.3,
    killCamStopMs: 90,
    killCamDistance: 4,
    collapseCamDistance: 10,
    killCamRise: 1.2,
    collapseBlocks: 6,
    collapseWindowSeconds: 0.6,
    buzzKillMs: 70,
    hitStopMs: 45,
    heavyHitStopMs: 90,
    heavyHitSpeed: 85,
    shakeStrength: 1,
    thudSpeed: 2.5,
    thudGapSeconds: 0.25,
    dust: 6,
    slowMo: 0.3,
    slowMoSeconds: 1.6,
    buzzThrowMs: 30,
    buzzBarrageMs: 35,
    buzzHitMs: 20,
    buzzThudMs: 12,
    buzzBreakMs: 45,
    buzzGuardMs: 40,
    buzzBannerMs: 120,
  },
} satisfies GameDataInput['siege'];
