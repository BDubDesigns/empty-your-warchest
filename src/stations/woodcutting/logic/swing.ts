import type { WoodcuttingFeel } from '../../../data';
import type { Rng } from '../../../core';

export type SwingResult = 'perfect' | 'good' | 'glancing';

/** How far the axe is wound up, 0–1, from how far the finger is from the tree (screen pixels). */
export function pullAmount(distance: number, deadZone: number, maxPull: number): number {
  return Math.min(Math.max((distance - deadZone) / maxPull, 0), 1);
}

/** Judges a swing by how close the wind-up was to the gold band's center. */
export function judgeSwing(
  pull: number,
  feel: WoodcuttingFeel,
): { result: SwingResult; points: number } {
  const offset = Math.abs(pull - feel.swingTarget);
  if (offset <= feel.perfectWindow / 2) return { result: 'perfect', points: feel.perfectPoints };
  if (offset <= feel.timingWindow / 2) return { result: 'good', points: feel.goodPoints };
  return { result: 'glancing', points: 0 };
}

/**
 * How far (radians) a swing knocks the fall direction off. Perfect swings keep the aim;
 * sloppier swings push it off by up to goodScatter or glancingScatter degrees, either way.
 */
export function swingScatter(result: SwingResult, feel: WoodcuttingFeel, rng: Rng): number {
  const degrees =
    result === 'perfect' ? 0 : result === 'good' ? feel.goodScatter : feel.glancingScatter;
  return (rng.range(-degrees, degrees) * Math.PI) / 180;
}
