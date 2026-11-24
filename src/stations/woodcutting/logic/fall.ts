/**
 * How far a falling tree's top has swung toward the ground, 0–1, at `t` (0–1) of its fall.
 * The tilt angle grows as t^ease, so it starts slow and speeds up like a real tree;
 * seen from above, the top's reach is the sine of that angle.
 */
export function fallProgress(t: number, ease: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return Math.sin((clamped ** ease * Math.PI) / 2);
}

/** When (0–1 of the fall) the top of a falling tree reaches `along` of its `height`. */
export function fallTimeToReach(along: number, height: number, ease: number): number {
  const reach = Math.min(Math.max(along / height, 0), 1);
  return ((2 * Math.asin(reach)) / Math.PI) ** (1 / ease);
}

/**
 * Seconds a rolling boulder takes to cover `distance` of a roll that's `natural` long with nothing
 * in the way: it sets off at `speed` (units per second) and slows evenly to a stop.
 */
export function rollTime(distance: number, natural: number, speed: number): number {
  if (natural <= 0) return 0;
  const seconds = (2 * natural) / speed;
  const share = Math.min(Math.max(distance / natural, 0), 1);
  return seconds * (1 - Math.sqrt(1 - share));
}

/** How far along its roll a boulder is `elapsed` seconds in (see rollTime), up to `stopAt`. */
export function rollDistance(
  elapsed: number,
  natural: number,
  speed: number,
  stopAt: number,
): number {
  if (natural <= 0) return 0;
  const seconds = (2 * natural) / speed;
  const t = Math.min(Math.max(elapsed / seconds, 0), 1);
  return Math.min(natural * (1 - (1 - t) ** 2), stopAt);
}

/** When (0–1 of the fall) a falling tree has tipped `tilt` radians from upright. */
export function fallTimeToTilt(tilt: number, ease: number): number {
  const share = Math.min(Math.max(tilt / (Math.PI / 2), 0), 1);
  return share ** (1 / ease);
}

/** How far a falling tree has tipped over, in radians from upright (0) to the ground (π/2). */
export function fallTilt(t: number, ease: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return (clamped ** ease * Math.PI) / 2;
}
