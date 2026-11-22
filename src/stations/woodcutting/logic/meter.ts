import type { WoodcuttingFeel } from '../../../data';

export type ChopResult = 'perfect' | 'good' | 'miss';

/** Cursor position on the chop meter, 0–1, bouncing end to end. */
export function meterPosition(seconds: number, meterSpeed: number): number {
  const phase = (seconds * meterSpeed) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** Judges a chop by how far the cursor was from the middle of the meter. */
export function judgeChop(
  position: number,
  feel: WoodcuttingFeel,
): { result: ChopResult; points: number } {
  const offset = Math.abs(position - 0.5);
  if (offset <= feel.perfectWindow / 2) return { result: 'perfect', points: feel.perfectPoints };
  if (offset <= feel.timingWindow / 2) return { result: 'good', points: feel.goodPoints };
  return { result: 'miss', points: 0 };
}

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
