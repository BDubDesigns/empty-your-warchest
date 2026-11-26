import type { Siege, SiegeObjective } from '../../../data';

/** What an objective can see of the round after each step. */
export interface ObjectiveView {
  rules: Pick<Siege, 'banner'>;
  /** The banner's middle height (metres), if the fort has one still standing in the world. */
  bannerHeight: number | undefined;
}

type Check<K extends SiegeObjective['kind']> = (
  objective: Extract<SiegeObjective, { kind: K }>,
  round: ObjectiveView,
) => boolean;

/** One small check per kind of objective: has it been met? */
const checks: { [K in SiegeObjective['kind']]: Check<K> } = {
  banner_down: (objective, round) =>
    round.bannerHeight !== undefined &&
    round.bannerHeight < (objective.height ?? round.rules.banner.winHeight),
};

/** Whether a fort's objective has been met: the siege is won. */
export function objectiveMet(objective: SiegeObjective, round: ObjectiveView): boolean {
  return checks[objective.kind](objective, round);
}
