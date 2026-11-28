import type { GameDataInput } from './schema';

// The siege (siege 2b), fought at the castle (castle.ts). Every number is a first guess, meant to
// be tuned on a phone. Metres and seconds, in the castle's world: its middle at the origin, its gate
// facing +z. You shoot from the castle's vantage points (the camera stands at each and turns), with
// the ballista just in front of and under the camera; a drag turns the view under the crosshair, and
// Fire allows for the drop.

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
    },
  ],
  weapon: 'ballista',
  // Just under the camera, out of its view: its spears come up from the bottom of the screen. At
  // the low ground (the camera 1.7 m up) it stands on the field.
  mount: { ahead: 0, below: 0.5 },
  // The knight's body (characters.body: 0.73 across, 1.81 up, 0.56 deep in his idle clip, without
  // his horns, pauldrons and scarf) and about 10% round it, as games make hit boxes a touch bigger
  // than what's drawn so a near miss feels fair. Every look of guard shares it, so none is harder
  // to hit. A direct hit brings him down.
  guard: { size: [0.8, 2, 0.62], density: 400, friction: 0.8, hp: 20, downTilt: 50, topple: 2 },
  // The same body as a guard's (his gold plate is what marks him out). He stands just inside his
  // window, and shows from its sill up (the kit's wide window opens about 1 m over its floor).
  captain: { scale: 1, hp: 20, sill: 1, inset: 0.15 },
  materials: [
    { id: 'stone', kind: 'stone', density: 1800, friction: 0.8, restitution: 0.05 },
    { id: 'timber', kind: 'wood', density: 600, friction: 0.7, restitution: 0.1 },
    // A roof's tiles on its rafters: a hollow shape, far lighter than its size.
    { id: 'tiles', kind: 'stone', density: 250, friction: 0.7, restitution: 0.05 },
    // What never breaks: the keep's lower storeys, the stretches of wall inside the towers.
    { id: 'solid_stone', kind: 'stone', density: 2200, friction: 0.85, restitution: 0.05 },
  ],
  // A spear at 90 m/s deals about 30: a wall chunk, a tower's wedge or a block of the gatehouse or
  // the keep's top storey takes three spears (an aimed volley that lands on one breaks it), a
  // battlement two, a merlon one; the gate goes at two spears, the spear rack at one. (Brandon,
  // Nov 28: "way less destructible than I thought itd be"; they were twice this.)
  parts: {
    wallChunk: { material: 'stone', hp: 90 },
    battlement: { material: 'stone', hp: 40 },
    towerChunk: { material: 'stone', hp: 90 },
    gatehouseChunk: { material: 'stone', hp: 90 },
    storeyChunk: { material: 'stone', hp: 90 },
    merlon: { material: 'stone', hp: 20 },
    gate: { material: 'timber', hp: 60 },
    towerRoof: { material: 'tiles', hp: 45 },
    roof: { material: 'tiles', hp: 70 },
    bell: { material: 'timber', hp: 30 },
    rack: { material: 'timber', hp: 25 },
  },
  // A tower stands on four of a row's six wedges: lose three in a row and all above comes down.
  bodies: { gap: 0.02, keepInset: 0.35, solid: 'solid_stone', towerHold: 4 },
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
  // A guard hears a spear or a crash near him through stone, but sees a comrade fall only if
  // nothing's in the way. Ducked, he's 0.8 m tall, under the parapet's 1 m. The first runner, and
  // one more if he's brought down.
  alarm: {
    sight: { shot: false, break: false, death: true },
    hideHeight: 0.8,
    runners: 2,
  },
  // Kenney's Castle Kit and the Quaternius characters (CC0): skins over the rules' boxes.
  skins: {
    // The spear is the ballista's bolt.
    bolt: {
      model: 'models/kenney/castle/siege-ballista.glb',
      fit: 'height',
      turn: 0,
      node: 'arrow',
    },
    // The guards wear the characters' guard looks (one each, from the round's seed), drawn so
    // their body fills the box less its margin. He staggers at a hit that leaves him standing.
    guard: {
      fill: 0.91,
      clips: {
        stand: 'idle',
        patrol: 'walk',
        hit: 'hit',
        down: 'die',
        panic: 'run',
        hide: 'cower',
        run: 'run',
        ring: 'alarm',
      },
    },
    // At his window he leans on its sill.
    captain: {
      character: 'captain',
      clips: { stand: 'lean', patrol: 'walk', hit: 'hit', down: 'die' },
    },
  },
  looks: {
    // As the stress test's blobs (opacity 0.45), stretched to each thing's footprint and a little
    // past it.
    blobShadows: { opacity: 0.45, spread: 1.3, lift: 0.04, fadeHeight: 1.5 },
    // The captain's gold, on every live objective's targets. The guards and captain glow less than
    // the rack: at the full glow every look turned the same gold from range.
    objective: { color: '#ffc64a', glow: 0.7, pulse: 0.5, pulseSeconds: 1.4, figureGlow: 0.4 },
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
  // A chunk dropping a storey (3.5 m, 8 m/s) takes about 140 and breaks as it lands; what it lands
  // on takes as much, so a falling block breaks the battlement, the rack or the gate under it and
  // all but breaks a wall chunk.
  damage: {
    spearMinSpeed: 10,
    spearPerSpeed: 0.375,
    crashMinSpeed: 2.5,
    crashPerSpeed: 25,
    knockSpeed: 3.5,
  },
  // Stars: 3 for every objective without the bell ringing, 2 for every objective, 1 for some. The
  // bonus is the same as woodcutting's, splitting's and firemaking's.
  starBonus: { two: 0.1, three: 0.25 },
  rewards: { xpPerPart: 2, xpPerGuard: 10, xpPerObjective: 40, winXp: 80 },
  feel: {
    aimPerPx: 1.4,
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
    // A spear thuds within about two guards' stretches of him; a part breaking is heard further
    // off; a comrade falling is seen from across his walk and the next tower. Half panic.
    alertSpearRadius: 6,
    alertBreakRadius: 10,
    alertDeathRadius: 14,
    // About a person's reaction time, and more than an aimed volley takes to land (0.2 s).
    reactSeconds: 0.6,
    panicShare: 0.5,
    panicSpeed: 2.5,
    // Ducked a few seconds, up for a second or two: long enough to aim at as he peeks.
    hideMinSeconds: 2.5,
    hideMaxSeconds: 5,
    peekMinSeconds: 1.5,
    peekMaxSeconds: 2.5,
    // From the front battlement to the rope is about 45 m (the left of the gate) to 70 m (the
    // right): 13 to 20 s at a run, time for a volley or two at him.
    runnerDelaySeconds: 1.5,
    runnerSpeed: 3.5,
    reinforcementSeconds: 120,
    // After the bell the captain shows at a window every 6 to 12 s, for 3 to 5 s.
    captainHideMinSeconds: 6,
    captainHideMaxSeconds: 12,
    captainShowMinSeconds: 3,
    captainShowMaxSeconds: 5,
    markSize: 1.6,
    followBack: 9,
    followRise: 2.2,
    followInSeconds: 0.18,
    followSlowMo: 0.55,
    followHoldSeconds: 0.6,
    followReturnSeconds: 0.5,
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
