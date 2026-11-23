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

/** How far a falling tree has tipped over, in radians from upright (0) to the ground (π/2). */
export function fallTilt(t: number, ease: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return (clamped ** ease * Math.PI) / 2;
}
