import type { Rng } from '../../../core';
import type { Siege, SiegeFeel } from '../../../data';

/** A point or a velocity in the siege's world (metres): x across, y up, z toward the ballista. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where the ballista stands on the ground. */
export interface Spot {
  x: number;
  z: number;
}

/** Which way the ballista points: turned `yaw` (radians, + right) and tilted `tilt` (+ up). */
export interface Aim {
  yaw: number;
  tilt: number;
}

/**
 * Aimed: a tight volley, for weak points and guards. Barrage: three times the spears, strewn
 * wide, the hammer for walls (and many miss).
 */
export type ThrowMode = 'aimed' | 'barrage';

/** One spear leaving the ballista. */
export interface Launch {
  position: Vec3;
  velocity: Vec3;
}

/** A spear of a shot: its wave and place in the wave, and how long after the shot it leaves (s). */
export interface ShotSpear extends Launch {
  wave: number;
  index: number;
  delay: number;
}

type Ballista = Pick<Siege, 'ballista'>;

const DEG = Math.PI / 180;

/** Spears in an aimed volley at a Command `level`: `start`, and `add` more every `everyLevels`. */
export function aimedVolley(rules: Ballista, level: number): number {
  const { start, everyLevels, add } = rules.ballista.aimed;
  return start + Math.floor(Math.max(level, 0) / everyLevels) * add;
}

/** Spears a shot in `mode` takes, with an aimed volley of `aimed`. */
export function volleySize(mode: ThrowMode, aimed: number, rules: Ballista): number {
  return mode === 'barrage' ? aimed * rules.ballista.barrageTimes : aimed;
}

/** Spears a shot actually takes with `left` in the warchest: never more than there are. */
export function spearsShot(mode: ThrowMode, aimed: number, left: number, rules: Ballista): number {
  return Math.max(Math.min(volleySize(mode, aimed, rules), Math.floor(left)), 0);
}

/** The aim the ballista starts at: straight ahead, at its starting tilt. */
export function startAim(rules: Ballista): Aim {
  return { yaw: 0, tilt: rules.ballista.tilt.start * DEG };
}

/**
 * The aim after a drag of `dx`, `dy` screen pixels (+y down the screen), from `from`. Like
 * pulling the back of the ballista: pull down to aim higher, left to aim right. Kept to its
 * turn and tilt.
 */
export function aimFromDrag(
  from: Aim,
  dx: number,
  dy: number,
  feel: SiegeFeel,
  rules: Ballista,
): Aim {
  const { tilt } = rules.ballista;
  const yaw = from.yaw - dx * feel.yawPerPx * DEG;
  const up = from.tilt + dy * feel.tiltPerPx * DEG;
  const max = feel.maxAim * DEG;
  return {
    yaw: Math.min(Math.max(yaw, -max), max),
    tilt: Math.min(Math.max(up, tilt.min * DEG), tilt.max * DEG),
  };
}

/** The bolt's direction for an aim (a unit vector). */
export function aimDirection(aim: Aim): Vec3 {
  return {
    x: Math.sin(aim.yaw) * Math.cos(aim.tilt),
    y: Math.sin(aim.tilt),
    z: -Math.cos(aim.yaw) * Math.cos(aim.tilt),
  };
}

/** Where the bolt's tip is, for the ballista at `spot` aimed `aim`: spears leave from here. */
export function muzzleAt(spot: Spot, aim: Aim, rules: Ballista): Vec3 {
  const { pivotHeight, muzzle } = rules.ballista;
  const way = aimDirection(aim);
  return {
    x: spot.x + way.x * muzzle,
    y: pivotHeight + way.y * muzzle,
    z: spot.z + way.z * muzzle,
  };
}

/** A spear leaving the muzzle at `speed`, `side` metres to the right of the bolt's line. */
function launchFrom(spot: Spot, aim: Aim, speed: number, side: number, rules: Ballista): Launch {
  const tip = muzzleAt(spot, aim, rules);
  const way = aimDirection(aim);
  return {
    position: {
      x: tip.x + Math.cos(aim.yaw) * side,
      y: tip.y,
      z: tip.z + Math.sin(aim.yaw) * side,
    },
    velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed },
  };
}

/**
 * The spears of one shot from `spot`: an aimed volley of `aimed` side by side (`spacing` apart,
 * `lineStagger` seconds apart), or a barrage of `barrageTimes` such waves, `barrageStagger`
 * apart. With fewer spears left than that, it shoots what there is. Each strays at random within
 * the mode's spread (drawn from `rng`, the round's seeded random numbers, so a replay shoots
 * exactly the same).
 */
export function shotSpears(
  mode: ThrowMode,
  aim: Aim,
  spot: Spot,
  aimed: number,
  left: number,
  rules: Ballista,
  feel: SiegeFeel,
  rng: Rng,
): ShotSpear[] {
  const count = spearsShot(mode, aimed, left, rules);
  const barrage = mode === 'barrage';
  const spread = (barrage ? feel.barrageSpread : feel.aimedSpread) * DEG;
  const tiltSpread = (barrage ? feel.barrageTiltSpread : feel.aimedTiltSpread) * DEG;
  const speedStray = barrage ? feel.barrageSpeedStray : feel.aimedSpeedStray;
  const { speed, spacing } = rules.ballista;
  return Array.from({ length: count }, (_, shot) => {
    const wave = Math.floor(shot / aimed);
    const index = shot % aimed;
    const strayed = {
      yaw: aim.yaw + rng.range(-1, 1) * spread,
      tilt: aim.tilt + rng.range(-1, 1) * tiltSpread,
    };
    const fast = speed * (1 + rng.range(-1, 1) * speedStray);
    const side = (index - (aimed - 1) / 2) * spacing;
    return {
      ...launchFrom(spot, strayed, fast, side, rules),
      wave,
      index,
      delay: wave * feel.barrageStagger + index * feel.lineStagger,
    };
  });
}

/**
 * The spears to draw dotted arcs for while aiming: the aim itself, and for a barrage its left
 * and right edges too, as its spears could go anywhere between.
 */
export function previewLaunches(
  mode: ThrowMode,
  aim: Aim,
  spot: Spot,
  rules: Ballista,
  feel: SiegeFeel,
): Launch[] {
  const strays = mode === 'barrage' ? [-feel.barrageSpread, 0, feel.barrageSpread] : [0];
  return strays.map((stray) =>
    launchFrom(spot, { ...aim, yaw: aim.yaw + stray * DEG }, rules.ballista.speed, 0, rules),
  );
}

/** Seconds until a spear leaving as `launch` comes down to the ground (y = 0), with only gravity. */
export function timeToGround(launch: Launch, gravity: number): number {
  const up = launch.velocity.y;
  const height = Math.max(launch.position.y, 0);
  return (up + Math.sqrt(up * up + 2 * gravity * height)) / gravity;
}

/**
 * Where a spear leaving as `launch` is over its first `seconds` of flight, at `points` evenly
 * spaced moments (the first just after it leaves). Only gravity acts on a spear in flight, so
 * this is where it really goes.
 */
export function flightPath(
  launch: Launch,
  gravity: number,
  seconds: number,
  points: number,
): Vec3[] {
  return Array.from({ length: points }, (_, index) => {
    const t = (seconds * (index + 1)) / points;
    return {
      x: launch.position.x + launch.velocity.x * t,
      y: launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t,
      z: launch.position.z + launch.velocity.z * t,
    };
  });
}
