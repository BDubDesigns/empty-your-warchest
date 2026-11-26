import { starBonus } from '../../../core';
import type { Siege, SiegeFort } from '../../../data';
import { recoveredSpears } from '../../../runner/sim';

/** How a siege went, as far as paying for it goes. */
export interface SiegeOutcome {
  won: boolean;
  /** Spears thrown. */
  used: number;
  /** Throws: shots of the ballista, aimed or barrage alike, over every position. */
  throws: number;
  blocksDown: number;
  guardsDown: number;
}

/** What stars are measured by, one small function per kind (the data picks one). */
const measures: Record<Siege['stars']['by'], (outcome: SiegeOutcome) => number> = {
  throws: (outcome) => outcome.throws,
};

/** 1–3 stars for a won siege, from its measure (throws) against the fort's par; 0 for a loss. */
export function siegeStars(outcome: SiegeOutcome, par: number, stars: Siege['stars']): number {
  if (!outcome.won) return 0;
  const measure = measures[stars.by](outcome);
  if (measure <= par * stars.three) return 3;
  if (measure <= par * stars.two) return 2;
  return 1;
}

/** What a finished siege pays. */
export interface SiegeRewards {
  stars: number;
  /** Command XP, the star bonus included. */
  xp: number;
  starXp: number;
  /** Spears back into the warchest, the star bonus included. */
  recovered: number;
  starSpears: number;
}

/**
 * A siege pays Command XP for every block knocked down and guard brought down, and the fort's win
 * bonus if you won. A win also gets back the share of the spears thrown that every attack
 * recovers. Stars add their bonus share to both, as at every station. A loss pays only for the
 * blocks and guards.
 */
export function siegeRewards(
  result: SiegeOutcome,
  fort: Pick<SiegeFort, 'par' | 'rewards'>,
  rules: Pick<Siege, 'stars' | 'starBonus'>,
  recoveryOnWin: number,
): SiegeRewards {
  const stars = siegeStars(result, fort.par, rules.stars);
  const { rewards } = fort;
  const xp =
    result.blocksDown * rewards.xpPerBlock +
    result.guardsDown * rewards.xpPerGuard +
    (result.won ? rewards.winXp : 0);
  const recovered = recoveredSpears(result.used, result.won, recoveryOnWin);
  const starXp = starBonus(xp, stars, rules.starBonus);
  const starSpears = starBonus(recovered, stars, rules.starBonus);
  // Never back more than were thrown, however generous the bonus is tuned.
  const back = Math.min(recovered + starSpears, result.used);
  return {
    stars,
    xp: Math.round(xp) + starXp,
    starXp,
    recovered: back,
    starSpears: back - recovered,
  };
}
