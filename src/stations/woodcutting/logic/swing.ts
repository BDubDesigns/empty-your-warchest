import type { Rng } from '../../../core';
import type { WoodcuttingFeel } from '../../../data';

export type SwingResult = 'perfect' | 'good' | 'glancing';

/** The bar marker's position, 0–1, `seconds` after you start holding the axe back. Sweeps end to end. */
export function markerPosition(seconds: number, meterSpeed: number): number {
  const phase = (seconds * meterSpeed) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** A new spot for the yellow zone, kept far enough from the ends that the green fits around it. */
export function nextTarget(feel: WoodcuttingFeel, rng: Rng): number {
  const margin = feel.timingWindow / 2;
  return rng.range(margin, 1 - margin);
}

/** Judges a chop by how close the marker was to the yellow zone's center. */
export function judgeSwing(
  position: number,
  target: number,
  feel: WoodcuttingFeel,
): { result: SwingResult; points: number } {
  const offset = Math.abs(position - target);
  if (offset <= feel.perfectWindow / 2) return { result: 'perfect', points: feel.perfectPoints };
  if (offset <= feel.timingWindow / 2) return { result: 'good', points: feel.goodPoints };
  return { result: 'glancing', points: 0 };
}

/**
 * How far (radians) a chop knocks the fall direction off. Perfect chops keep the aim;
 * sloppier chops push it off by up to goodScatter or glancingScatter degrees, either way.
 */
export function swingScatter(result: SwingResult, feel: WoodcuttingFeel, rng: Rng): number {
  const degrees =
    result === 'perfect' ? 0 : result === 'good' ? feel.goodScatter : feel.glancingScatter;
  return (rng.range(-degrees, degrees) * Math.PI) / 180;
}
