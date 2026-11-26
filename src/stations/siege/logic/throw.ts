import type { Rng } from '../../../core';
import type { Siege, SiegeFeel } from '../../../data';

/** A point or a velocity in the siege's world (metres): x across, y up, z toward the thrower. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A throw: how hard (0 the lightest counted pull, 1 a full one) and which way (radians, + right). */
export interface Aim {
  power: number;
  yaw: number;
}

/**
 * Aimed: one spear each, tightly grouped, for weak points. Barrage: several each, strewn wide,
 * the hammer for walls (and many miss).
 */
export type ThrowMode = 'aimed' | 'barrage';

/** One spear leaving a hand. */
export interface Launch {
  position: Vec3;
  velocity: Vec3;
}

/** A spear of a throw: which thrower throws it, and how long after the throw it leaves (s). */
export interface ThrownSpear extends Launch {
  thrower: number;
  delay: number;
}

type ThrowRules = Pick<Siege, 'throwers' | 'barrage' | 'projectile'>;

const DEG = Math.PI / 180;

/** Throwers in the line at a Command `level`: `start`, and `add` more every `everyLevels`. */
export function throwerCount(rules: Pick<Siege, 'throwers'>, level: number): number {
  const { start, everyLevels, add } = rules.throwers;
  return start + Math.floor(Math.max(level, 0) / everyLevels) * add;
}

/** Spears each thrower throws in `mode`. */
export function spearsEach(mode: ThrowMode, rules: Pick<Siege, 'barrage'>): number {
  return mode === 'barrage' ? rules.barrage : 1;
}

/** Spears a whole line's throw in `mode` takes. */
export function throwCost(
  mode: ThrowMode,
  throwers: number,
  rules: Pick<Siege, 'barrage'>,
): number {
  return throwers * spearsEach(mode, rules);
}

/** Spears a throw actually takes with `left` in the warchest: a thrower with none does nothing. */
export function spearsThrown(
  mode: ThrowMode,
  throwers: number,
  left: number,
  rules: Pick<Siege, 'barrage'>,
): number {
  return Math.max(Math.min(throwCost(mode, throwers, rules), Math.floor(left)), 0);
}

/** Where each thrower stands across the line (x, metres), left to right, centred on 0. */
export function throwerSpots(throwers: number, rules: Pick<Siege, 'throwers'>): number[] {
  return Array.from(
    { length: throwers },
    (_, index) => (index - (throwers - 1) / 2) * rules.throwers.spacing,
  );
}

/**
 * The throw a drag makes, `dx`, `dy` screen pixels from where the finger went down (+y down the
 * screen). Like a slingshot, you pull back (down) to throw forward: the longer the pull the
 * harder, and pulling to one side throws to the other. Undefined for a drag too short to count
 * (it cancels) or one that isn't pulling back at all.
 */
export function aimFromDrag(dx: number, dy: number, feel: SiegeFeel): Aim | undefined {
  const length = Math.hypot(dx, dy);
  if (dy <= 0 || length < feel.deadPx) return undefined;
  const power = Math.min((length - feel.deadPx) / (feel.pullPx - feel.deadPx), 1);
  const max = feel.maxAim * DEG;
  const yaw = Math.min(Math.max(Math.atan2(-dx, dy) * feel.aimScale, -max), max);
  return { power, yaw };
}

/** How fast a throw of `power` leaves the hand (m/s). */
export function throwSpeed(power: number, feel: SiegeFeel): number {
  return feel.minSpeed + Math.min(Math.max(power, 0), 1) * (feel.maxSpeed - feel.minSpeed);
}

/**
 * A spear from the thrower standing at `spot`, aimed at the point `converge` metres out along the
 * aim (so the line's spears group), turned a further `stray` radians and thrown at `power`.
 */
function launchFrom(
  spot: number,
  aim: Aim,
  power: number,
  stray: number,
  rules: ThrowRules,
  feel: SiegeFeel,
): Launch {
  const [hx, y, hz] = rules.projectile.launch;
  const position = { x: spot + hx, y, z: hz };
  const reach = rules.throwers.converge;
  const target = { x: Math.sin(aim.yaw) * reach, z: -Math.cos(aim.yaw) * reach };
  const yaw = Math.atan2(target.x - position.x, position.z - target.z) + stray;
  const speed = throwSpeed(power, feel);
  const elevation = feel.elevation * DEG;
  return {
    position,
    velocity: {
      x: speed * Math.sin(yaw) * Math.cos(elevation),
      y: speed * Math.sin(elevation),
      z: -speed * Math.cos(yaw) * Math.cos(elevation),
    },
  };
}

/**
 * The spears of one throw: the whole line throws together, one each (aimed) or `barrage` each,
 * `barrageStagger` apart, neighbours `lineStagger` apart. With fewer spears than that, the middle
 * throwers throw first. Each spear strays at random within the mode's spread (drawn from `rng`,
 * the round's seeded random numbers, so a replay throws exactly the same).
 */
export function throwSpears(
  mode: ThrowMode,
  aim: Aim,
  throwers: number,
  left: number,
  rules: ThrowRules,
  feel: SiegeFeel,
  rng: Rng,
): ThrownSpear[] {
  const spots = throwerSpots(throwers, rules);
  // Middle first, then out from it.
  const order = spots
    .map((spot, index) => ({ spot, index }))
    .sort((a, b) => Math.abs(a.spot) - Math.abs(b.spot) || a.index - b.index);
  const count = spearsThrown(mode, throwers, left, rules);
  const spread = (mode === 'barrage' ? feel.barrageSpread : feel.aimedSpread) * DEG;
  const jitter = mode === 'barrage' ? feel.barragePowerJitter : feel.aimedPowerJitter;
  return Array.from({ length: count }, (_, shot) => {
    const thrower = order[shot % throwers];
    const round = Math.floor(shot / throwers);
    const index = thrower?.index ?? 0;
    const stray = rng.range(-1, 1) * spread;
    const power = Math.min(Math.max(aim.power + rng.range(-1, 1) * jitter, 0), 1);
    return {
      ...launchFrom(thrower?.spot ?? 0, aim, power, stray, rules, feel),
      thrower: index,
      delay: round * feel.barrageStagger + index * feel.lineStagger,
    };
  });
}

/**
 * The dotted arcs while aiming. Aimed: each thrower's spear as it would go with no stray, the
 * line grouping on the aim. Barrage: the middle of it and its two edges, shorter, as the spears
 * could go anywhere between.
 */
export function previewLaunches(
  mode: ThrowMode,
  aim: Aim,
  throwers: number,
  rules: ThrowRules,
  feel: SiegeFeel,
): Launch[] {
  if (mode === 'aimed') {
    return throwerSpots(throwers, rules).map((spot) =>
      launchFrom(spot, aim, aim.power, 0, rules, feel),
    );
  }
  const spread = feel.barrageSpread * DEG;
  return [-spread, 0, spread].map((stray) => launchFrom(0, aim, aim.power, stray, rules, feel));
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
