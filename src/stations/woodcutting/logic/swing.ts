import type { Rng } from '../../../core';
import type { WoodcuttingFeel } from '../../../data';

export type SwingResult = 'perfect' | 'good' | 'glancing';

/** Position 0–1 on the bar for a marker that has swept `phase` passes, bouncing end to end. */
export function markerPosition(phase: number): number {
  const wrapped = phase % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

/** Width of the yellow zone for a pull: wide for a light pull, narrow for a hard one. */
export function yellowWidth(pull: number, feel: WoodcuttingFeel): number {
  const clamped = Math.min(Math.max(pull, 0), 1);
  return feel.perfectWindowLight + (feel.perfectWindow - feel.perfectWindowLight) * clamped;
}

/** A new spot for the yellow zone, kept far enough from the ends that the green fits around it. */
export function nextTarget(feel: WoodcuttingFeel, rng: Rng): number {
  const margin = feel.timingWindow / 2;
  return rng.range(margin, 1 - margin);
}

/** How clean a chop was: where the marker stopped relative to the yellow zone for this pull. */
export function judgeSwing(
  position: number,
  target: number,
  pull: number,
  feel: WoodcuttingFeel,
): SwingResult {
  const offset = Math.abs(position - target);
  if (offset <= yellowWidth(pull, feel) / 2) return 'perfect';
  if (offset <= feel.timingWindow / 2) return 'good';
  return 'glancing';
}

/**
 * Damage from one chop: the pull sets the power (a full pull deals fullPullPoints, a partial
 * pull its share, at least 1); yellow adds perfectBonus; a glancing chop deals half.
 */
export function chopDamage(pull: number, result: SwingResult, feel: WoodcuttingFeel): number {
  const power = Math.max(1, Math.round(pull * feel.fullPullPoints));
  if (result === 'perfect') return power + feel.perfectBonus;
  if (result === 'good') return power;
  return Math.floor(power / 2);
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
