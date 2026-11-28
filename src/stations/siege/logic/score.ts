import { starBonus } from '../../../core';
import type { Siege } from '../../../data';
import { recoveredSpears } from '../../../runner/sim';

/** How a siege went, as far as paying for it goes. */
export interface SiegeOutcome {
  /** Objectives done, of the round's. */
  done: number;
  objectives: number;
  /** The alarm bell rang. */
  rang: boolean;
  /** Spears thrown. */
  used: number;
  /** Parts broken or knocked down, and guards brought down. */
  partsDown: number;
  guardsDown: number;
}

/**
 * Why a round got its stars: every objective with the bell never rung (3), every objective but
 * the bell rang (2), some of them (1), none (0).
 */
export type StarsWhy = 'quiet' | 'bell' | 'some' | 'none';

/** Stars, and why: 3 for every objective with no bell, 2 for every objective, 1 for some. */
export function siegeStars(outcome: Pick<SiegeOutcome, 'done' | 'objectives' | 'rang'>): {
  stars: number;
  why: StarsWhy;
} {
  if (outcome.done <= 0) return { stars: 0, why: 'none' };
  if (outcome.done < outcome.objectives) return { stars: 1, why: 'some' };
  return outcome.rang ? { stars: 2, why: 'bell' } : { stars: 3, why: 'quiet' };
}

/** What a finished siege pays. */
export interface SiegeRewards {
  stars: number;
  /** Why it got them. */
  starsWhy: StarsWhy;
  /** Won: at least one objective done. */
  won: boolean;
  /** Command XP, the star bonus included. */
  xp: number;
  starXp: number;
  /** Spears back into the warchest, the star bonus included. */
  recovered: number;
  starSpears: number;
}

/**
 * A siege pays Command XP for every part broken or knocked down and guard brought down, for each
 * objective done, and a bonus for all of them. A win (any objective done) also gets back the share
 * of the spears thrown that every attack recovers. Stars add their bonus share to both, as at every
 * station. How the round ended doesn't change it: lost to reinforcements, out of spears or
 * withdrawn, it pays for what's done.
 */
export function siegeRewards(
  outcome: SiegeOutcome,
  rules: Pick<Siege, 'starBonus' | 'rewards'>,
  recoveryOnWin: number,
): SiegeRewards {
  const { stars, why } = siegeStars(outcome);
  const won = stars > 0;
  const { rewards } = rules;
  const xp =
    outcome.partsDown * rewards.xpPerPart +
    outcome.guardsDown * rewards.xpPerGuard +
    outcome.done * rewards.xpPerObjective +
    (outcome.done >= outcome.objectives ? rewards.winXp : 0);
  const recovered = recoveredSpears(outcome.used, won, recoveryOnWin);
  const starXp = starBonus(xp, stars, rules.starBonus);
  const starSpears = starBonus(recovered, stars, rules.starBonus);
  // Never back more than were thrown, however generous the bonus is tuned.
  const back = Math.min(recovered + starSpears, outcome.used);
  return {
    stars,
    starsWhy: why,
    won,
    xp: Math.round(xp) + starXp,
    starXp,
    recovered: back,
    starSpears: back - recovered,
  };
}
