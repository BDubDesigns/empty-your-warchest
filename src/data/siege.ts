import type { GameDataInput } from './schema';

// The siege (siege 2a), fought at the castle (castle.ts). Every number is a first guess, meant to
// be tuned on a phone. Metres and seconds, in the castle's world: its middle at the origin, its gate
// facing +z. You shoot from the castle's vantage points (a camera fixed at each), with the ballista
// just in front of and under the camera; a drag moves the crosshair, and Fire allows for the drop.

export const siege = {
  item: 'spear',
  potion: 'sense_potion',
  weapons: [
    {
      // An aimed volley of 5 at Command 1, one more every 5 levels; a barrage is three times that.
      // A fire pit round (6 to 18 spears) is a volley or three. Fast and flat: at 90 m/s a spear
      // drops about 2 m over the 60 m from the hill, and Fire allows for that. It tilts down far
      // enough to shoot from the hill and the siege tower into the castle.
      id: 'ballista',
      name: 'Ballista',
      skill: 'command',
      aimed: { start: 5, everyLevels: 5, add: 1 },
      barrageTimes: 3,
      speed: 90,
      tilt: { min: -40, max: 15 },
      pivotHeight: 1.2,
      muzzle: 1,
      spacing: 0.08,
      size: [1.4, 1.1, 2.2],
    },
  ],
  weapon: 'ballista',
  // Just ahead of the camera and under it: at the low ground (the camera 1.7 m up) it stands on
  // the field.
  mount: { ahead: 2.5, below: 0.5 },
  // Kenney's chibi soldier, 1.5 m tall and nearly as wide: a big target, seen at range. A direct
  // hit brings him down.
  guard: { size: [1.1, 1.5, 0.8], density: 400, friction: 0.8, hp: 20, downTilt: 50, topple: 2 },
  // A size bigger, in gold. He stands just inside his window, and shows from its sill up (the
  // kit's wide window opens about 1 m over its floor).
  captain: { scale: 1.2, tint: '#ffc64a', hp: 20, sill: 1, inset: 0.15 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05 },
    { id: 'timber', kind: 'wood', density: 600, friction: 0.7, restitution: 0.1 },
    // A roof's tiles on its rafters: a hollow shape, far lighter than its size.
    { id: 'tiles', kind: 'stone', density: 250, friction: 0.7, restitution: 0.05 },
    // What never breaks: the gatehouse, the keep, the stretches of wall inside the towers.
    { id: 'solid_stone', kind: 'stone', density: 2200, friction: 0.85, restitution: 0.05 },
  ],
  // A spear at 90 m/s deals about 30: a wall chunk or a tower's wedge takes two aimed volleys on
  // it, a battlement one, a merlon a spear or two; the gate goes at about four spears, the spear
  // rack at one.
  parts: {
    wallChunk: { material: 'stone', hp: 260 },
    battlement: { material: 'stone', hp: 80 },
    towerChunk: { material: 'stone', hp: 260 },
    merlon: { material: 'stone', hp: 35 },
    gate: { material: 'timber', hp: 120 },
    towerRoof: { material: 'tiles', hp: 90 },
    roof: { material: 'tiles', hp: 140 },
    bell: { material: 'timber', hp: 60 },
    rack: { material: 'timber', hp: 25 },
  },
  bodies: { gap: 0.02, keepInset: 0.35, solid: 'solid_stone' },
  // Every round has all three, placed at random: the captain at one of the keep's windows, the
  // spear rack at one of its spots, and five guards on the front battlement (its two walks and the
  // front towers' tops), three of whom must come down.
  objectives: {
    count: 3,
    pool: [
      { kind: 'captain' },
      { kind: 'rack' },
      {
        kind: 'guards',
        name: 'the front battlement',
        guards: 5,
        kill: 3,
        posts: ['front_left_walk', 'front_right_walk', 'south_west_top', 'south_east_top'],
        slot: 2.4,
      },
    ],
  },
  // A guard walks his stretch of the walk (2.4 m) in about 3 s.
  guardMoves: { patrolSpeed: 0.8, patrolPause: 1.2 },
  // Kenney's Castle Kit and Mini Characters (CC0): skins over the rules' boxes.
  skins: {
    ballista: { model: 'models/kenney/castle/siege-ballista.glb', fit: 'box', turn: 90 },
    bolt: {
      model: 'models/kenney/castle/siege-ballista.glb',
      fit: 'height',
      turn: 0,
      node: 'arrow',
    },
    guard: {
      model: 'models/kenney/mini/character-soldier.glb',
      fit: 'height',
      turn: 0,
      clips: { stand: 'idle', patrol: 'walk', down: 'die' },
    },
  },
  looks: {
    // As the stress test's blobs (opacity 0.45), stretched to each thing's footprint and a little
    // past it.
    blobShadows: { opacity: 0.45, spread: 1.3, lift: 0.04, fadeHeight: 1.5 },
    tiers: {
      high: {
        shadows: 'map',
        debrisPieces: 4,
        maxDebris: 60,
        debrisSeconds: 1.3,
        dustShare: 1,
        maxPuffs: 160,
      },
      // As the old siege's low tier (to tune from phone logs, siege.perf): no shadow pass (the
      // castle's low tier has none either), half the debris and gone sooner, and half the dust.
      low: {
        shadows: 'blob',
        debrisPieces: 2,
        maxDebris: 20,
        debrisSeconds: 0.9,
        dustShare: 0.5,
        maxPuffs: 60,
      },
    },
  },
  // 60 steps a second keeps a phone's frame budget; flying spears use continuous collision
  // detection, so even the fastest can't skip through a part between two steps.
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
    inGuard: 0.1,
  },
  // A landed spear stops being a body half a second after it's still; a loose chunk is fixed
  // where it lies a second after.
  settle: { speed: 0.15, spin: 0.3, seconds: 1, winSeconds: 4, spearSeconds: 0.5, partSeconds: 1 },
  down: { drop: 0.25, tilt: 25 },
  // A chunk dropping a storey (3.5 m, 8 m/s) takes about 100 and lands whole; one falling the
  // wall's height (7 m, 12 m/s) takes about 180.
  damage: {
    spearMinSpeed: 10,
    spearPerSpeed: 0.375,
    crashMinSpeed: 3,
    crashPerSpeed: 20,
    knockSpeed: 4,
  },
  par: 8,
  // The same as woodcutting's, splitting's and firemaking's.
  starBonus: { two: 0.1, three: 0.25 },
  rewards: { xpPerPart: 2, xpPerGuard: 10, xpPerObjective: 40, winXp: 80 },
  feel: {
    aimPerPx: 1,
    aimEdge: 24,
    aimFallback: 160,
    reticleSize: 64,
    aimedSpread: 0.3,
    aimedTiltSpread: 0.15,
    aimedSpeedStray: 0.015,
    barrageSpread: 6,
    barrageTiltSpread: 1.5,
    barrageSpeedStray: 0.07,
    barrageStagger: 0.15,
    lineStagger: 0.04,
    ghostWidth: 0.07,
    ghostPx: 4,
    spearMass: 6,
    reloadSeconds: 0.9,
    kickBack: 0.3,
    kickTilt: 1.5,
    kickSeconds: 0.22,
    senseSeconds: 10,
    markSize: 1,
    killCamSeconds: 1,
    killCamSlowMo: 0.3,
    killCamStopMs: 90,
    killCamZoom: 0.45,
    killCamInSeconds: 0.15,
    killCamOutSeconds: 0.45,
    collapseParts: 4,
    collapseWindowSeconds: 0.8,
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
    buzzObjectiveMs: 60,
    buzzWinMs: 120,
  },
} satisfies GameDataInput['siege'];
