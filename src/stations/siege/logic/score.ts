import { starBonus } from '../../../core';
import type { Siege } from '../../../data';
import { recoveredSpears } from '../../../runner/sim';

/** How a siege went, as far as paying for it goes. */
export interface SiegeOutcome {
  /** Objectives done, of the round's. */
  done: number;
  objectives: number;
  /** Throws: shots of the ballista, aimed or barrage alike. */
  throws: number;
  /** Spears thrown. */
  used: number;
  /** Parts broken or knocked down, and guards brought down. */
  partsDown: number;
  guardsDown: number;
}

/**
 * Stars: 3 for every objective in par throws or fewer, 2 for every objective, 1 for some, none
 * for none (a loss). Par stands in for "no alarm bell" until the bell arrives (siege 2b).
 */
export function siegeStars(
  outcome: Pick<SiegeOutcome, 'done' | 'objectives' | 'throws'>,
  par: number,
): number {
  if (outcome.done <= 0) return 0;
  if (outcome.done < outcome.objectives) return 1;
  return outcome.throws <= par ? 3 : 2;
}

/** What a finished siege pays. */
export interface SiegeRewards {
  stars: number;
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
 * station.
 */
export function siegeRewards(
  outcome: SiegeOutcome,
  rules: Pick<Siege, 'par' | 'starBonus' | 'rewards'>,
  recoveryOnWin: number,
): SiegeRewards {
  const stars = siegeStars(outcome, rules.par);
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
    won,
    xp: Math.round(xp) + starXp,
    starXp,
    recovered: back,
    starSpears: back - recovered,
  };
}
