import type { Siege, SiegeObjective } from '../../../data';

/** What an objective can see of the round after each step. */
export interface ObjectiveView {
  rules: Pick<Siege, 'banner'>;
  /** The banner's middle height (metres), if the fort has one still standing in the world. */
  bannerHeight: number | undefined;
  /** Guards at the current position not yet down. */
  guardsLeft: number;
}

type Check<K extends SiegeObjective['kind']> = (
  objective: Extract<SiegeObjective, { kind: K }>,
  round: ObjectiveView,
) => boolean;

/** One small check per kind of objective: has it been met? */
const checks: { [K in SiegeObjective['kind']]: Check<K> } = {
  guards_down: (_, round) => round.guardsLeft === 0,
  banner_down: (objective, round) =>
    round.bannerHeight !== undefined &&
    round.bannerHeight < (objective.height ?? round.rules.banner.winHeight),
};

/** Whether a position's objective has been met. */
export function objectiveMet(objective: SiegeObjective, round: ObjectiveView): boolean {
  return (checks[objective.kind] as Check<SiegeObjective['kind']>)(objective, round);
}
