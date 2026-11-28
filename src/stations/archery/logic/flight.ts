import type { Rng } from '../../../core';
import type { ArcheryFeel, ArrowKind } from '../../../data';

const DEG = Math.PI / 180;

/** A point on the field (field units: x across from the bow, y up from it). */
export interface FieldPoint {
  x: number;
  y: number;
}

/** What the flight rules need from the feel, fixed for a round. */
export type FlightFeel = Pick<ArcheryFeel, 'gravity' | 'arrowSpeed'>;

/** An arrow in the air: where its point is, how fast it's going, and its own sideways push. */
export interface ArrowFlight {
  kind: ArrowKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since it left the bow. */
  age: number;
  /** This shot's steady sideways push (field units a second, every second; + is to its left). */
  drift: number;
  /** Where in its wobble it started (radians). */
  phase: number;
}

/** The aim, clamped to the steepest and flattest shots allowed (degrees from the right). */
export function clampAim(angle: number, aim: { min: number; max: number }): number {
  return Math.min(Math.max(angle, aim.min), aim.max);
}

/**
 * An arrow leaving the bow at `angle` degrees (from the right; 90 straight up), drawn `draw` of
 * a full draw (its speed is that share of the kind's), from the bow at the field's origin. Its
 * drift and wobble start are rolled from `rng` (none for a kind that doesn't drift or wobble);
 * without one it flies the plain path, as the aim preview shows it.
 */
export function launch(
  kind: ArrowKind,
  feel: FlightFeel,
  angle: number,
  draw: number,
  rng?: Rng,
): ArrowFlight {
  const speed = kind.speed * feel.arrowSpeed * Math.min(Math.max(draw, 0), 1);
  return {
    kind,
    x: 0,
    y: 0,
    vx: Math.cos(angle * DEG) * speed,
    vy: Math.sin(angle * DEG) * speed,
    age: 0,
    drift: rng && kind.drift > 0 ? rng.range(-kind.drift, kind.drift) : 0,
    phase: rng && kind.wobble > 0 ? rng.range(0, Math.PI * 2) : 0,
  };
}

/** The arrow's wobble right now, from -1 to 1 (for its fishtail too). */
export function wobbleOf(arrow: ArrowFlight): number {
  const { kind } = arrow;
  if (kind.wobble <= 0) return 0;
  return Math.sin(Math.PI * 2 * kind.wobbleHz * arrow.age + arrow.phase);
}

/**
 * One step of `dt` seconds: gravity pulls it down, drag slows it, and its drift and wobble push it
 * sideways (square to where it's going). `plain` leaves out the drift and wobble.
 */
export function stepArrow(arrow: ArrowFlight, gravity: number, dt: number, plain = false): void {
  const { kind } = arrow;
  const speed = Math.hypot(arrow.vx, arrow.vy);
  let ax = -kind.drag * arrow.vx;
  let ay = -gravity - kind.drag * arrow.vy;
  if (!plain && speed > 1e-6) {
    const side = arrow.drift + kind.wobble * wobbleOf(arrow);
    // Its left, square to its flight.
    ax += (-arrow.vy / speed) * side;
    ay += (arrow.vx / speed) * side;
  }
  arrow.vx += ax * dt;
  arrow.vy += ay * dt;
  arrow.x += arrow.vx * dt;
  arrow.y += arrow.vy * dt;
  arrow.age += dt;
}

/**
 * The first `seconds` of the path a shot would take if it flew plain (no drift or wobble): the
 * aim preview. Points every `step` seconds, starting at the bow.
 */
export function previewPath(
  kind: ArrowKind,
  feel: FlightFeel,
  angle: number,
  draw: number,
  seconds: number,
  step: number,
): FieldPoint[] {
  const arrow = launch(kind, feel, angle, draw);
  const points: FieldPoint[] = [{ x: 0, y: 0 }];
  const steps = Math.max(Math.round(seconds / step), 0);
  for (let index = 0; index < steps; index++) {
    stepArrow(arrow, feel.gravity, step, true);
    points.push({ x: arrow.x, y: arrow.y });
  }
  return points;
}

/**
 * The highest a full-draw shot straight up climbs, flying plain (field units): how far each arrow
 * kind reaches, for checking the data and the logs.
 */
export function apex(kind: ArrowKind, feel: FlightFeel, step: number): number {
  const arrow = launch(kind, feel, 90, 1);
  let top = 0;
  for (let index = 0; index < 100_000 && arrow.vy > 0; index++) {
    stepArrow(arrow, feel.gravity, step, true);
    top = Math.max(top, arrow.y);
  }
  return top;
}
