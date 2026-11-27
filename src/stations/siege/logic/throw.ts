import type { Rng } from '../../../core';
import type { Siege, SiegeFeel, SiegeWeapon } from '../../../data';

/** A point or a velocity in the siege's world (metres): x across, y up, z toward the weapon. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where the weapon stands on the ground. */
export interface Spot {
  x: number;
  z: number;
}

/** Which way the weapon points: turned `yaw` (radians, + right) and tilted `tilt` (+ up). */
export interface Aim {
  yaw: number;
  tilt: number;
}

/**
 * Aimed: a tight volley, for weak points and guards. Barrage: three times the spears, strewn
 * wide, the hammer for walls (and many miss).
 */
export type ThrowMode = 'aimed' | 'barrage';

/** One spear leaving the weapon. */
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

const DEG = Math.PI / 180;

/** The weapon the siege shoots with. */
export function siegeWeapon(rules: Pick<Siege, 'weapons' | 'weapon'>): SiegeWeapon {
  const weapon = rules.weapons.find((entry) => entry.id === rules.weapon);
  if (!weapon) throw new Error(`Unknown weapon "${rules.weapon}"`);
  return weapon;
}

/** Spears in an aimed volley at a Command `level`: `start`, and `add` more every `everyLevels`. */
export function aimedVolley(weapon: SiegeWeapon, level: number): number {
  const { start, everyLevels, add } = weapon.aimed;
  return start + Math.floor(Math.max(level, 0) / everyLevels) * add;
}

/** Spears a shot in `mode` takes, with an aimed volley of `aimed`. */
export function volleySize(mode: ThrowMode, aimed: number, weapon: SiegeWeapon): number {
  return mode === 'barrage' ? aimed * weapon.barrageTimes : aimed;
}

/** Spears a shot actually takes with `left` in the warchest: never more than there are. */
export function spearsShot(
  mode: ThrowMode,
  aimed: number,
  left: number,
  weapon: SiegeWeapon,
): number {
  return Math.max(Math.min(volleySize(mode, aimed, weapon), Math.floor(left)), 0);
}

/** The aim a weapon starts at: straight ahead, at its starting tilt. */
export function startAim(weapon: SiegeWeapon): Aim {
  return { yaw: 0, tilt: weapon.tilt.start * DEG };
}

/** An aim kept to the weapon's turn (`maxAim` either way) and tilt. */
export function clampAim(aim: Aim, weapon: SiegeWeapon, feel: Pick<SiegeFeel, 'maxAim'>): Aim {
  const max = feel.maxAim * DEG;
  return {
    yaw: Math.min(Math.max(aim.yaw, -max), max),
    tilt: Math.min(Math.max(aim.tilt, weapon.tilt.min * DEG), weapon.tilt.max * DEG),
  };
}

/** Halvings of the tilt range that `solveAim` narrows its tilt down by (a hair's breadth). */
const SOLVE_HALVINGS = 30;

/**
 * The aim that sends a spear from the weapon at `spot` (at `speed`, the weapon's own by default)
 * through `point`, allowing for the drop: turned straight at it, and tilted so it comes down on
 * it. Out of the weapon's tilt range, the nearest tilt it has.
 */
export function solveAim(
  spot: Spot,
  point: Vec3,
  weapon: SiegeWeapon,
  gravity: number,
  speed = weapon.speed,
): Aim {
  const yaw = Math.atan2(point.x - spot.x, -(point.z - spot.z));
  // How far over (+) or under (-) the point the spear passes, at a tilt.
  const miss = (tilt: number) => {
    const launch = launchFrom(spot, { yaw, tilt }, speed, 0, weapon);
    const across = Math.hypot(launch.velocity.x, launch.velocity.z);
    const out = Math.hypot(point.x - launch.position.x, point.z - launch.position.z);
    const t = out / across;
    return launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t - point.y;
  };
  let low = weapon.tilt.min * DEG;
  let high = weapon.tilt.max * DEG;
  if (miss(low) >= 0) return { yaw, tilt: low };
  if (miss(high) <= 0) return { yaw, tilt: high };
  for (let half = 0; half < SOLVE_HALVINGS; half++) {
    const middle = (low + high) / 2;
    if (miss(middle) < 0) low = middle;
    else high = middle;
  }
  return { yaw, tilt: (low + high) / 2 };
}

/** The bolt's direction for an aim (a unit vector). */
export function aimDirection(aim: Aim): Vec3 {
  return {
    x: Math.sin(aim.yaw) * Math.cos(aim.tilt),
    y: Math.sin(aim.tilt),
    z: -Math.cos(aim.yaw) * Math.cos(aim.tilt),
  };
}

/** Where the bolt's tip is, for the weapon at `spot` aimed `aim`: spears leave from here. */
export function muzzleAt(spot: Spot, aim: Aim, weapon: SiegeWeapon): Vec3 {
  const way = aimDirection(aim);
  return {
    x: spot.x + way.x * weapon.muzzle,
    y: weapon.pivotHeight + way.y * weapon.muzzle,
    z: spot.z + way.z * weapon.muzzle,
  };
}

/** A spear leaving the muzzle at `speed`, `side` metres to the right of the bolt's line. */
export function launchFrom(
  spot: Spot,
  aim: Aim,
  speed: number,
  side: number,
  weapon: SiegeWeapon,
): Launch {
  const tip = muzzleAt(spot, aim, weapon);
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
  weapon: SiegeWeapon,
  feel: SiegeFeel,
  rng: Rng,
): ShotSpear[] {
  const count = spearsShot(mode, aimed, left, weapon);
  const barrage = mode === 'barrage';
  const spread = (barrage ? feel.barrageSpread : feel.aimedSpread) * DEG;
  const tiltSpread = (barrage ? feel.barrageTiltSpread : feel.aimedTiltSpread) * DEG;
  const speedStray = barrage ? feel.barrageSpeedStray : feel.aimedSpeedStray;
  return Array.from({ length: count }, (_, shot) => {
    const wave = Math.floor(shot / aimed);
    const index = shot % aimed;
    const strayed = {
      yaw: aim.yaw + rng.range(-1, 1) * spread,
      tilt: aim.tilt + rng.range(-1, 1) * tiltSpread,
    };
    const fast = weapon.speed * (1 + rng.range(-1, 1) * speedStray);
    const side = (index - (aimed - 1) / 2) * weapon.spacing;
    return {
      ...launchFrom(spot, strayed, fast, side, weapon),
      wave,
      index,
      delay: wave * feel.barrageStagger + index * feel.lineStagger,
    };
  });
}

/** Where a spear leaving as `launch` is `t` seconds later, with only gravity acting on it. */
export function flightAt(launch: Launch, gravity: number, t: number): Vec3 {
  return {
    x: launch.position.x + launch.velocity.x * t,
    y: launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t,
    z: launch.position.z + launch.velocity.z * t,
  };
}
