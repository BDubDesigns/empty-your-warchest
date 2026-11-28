import type { Rng } from '../../../core';
import {
  postSlots,
  type CastleLayout,
  type PostSlot,
  type Siege,
  type SiegeObjective,
} from '../../../data';

// A round's objectives: which of the data's pool it asks for, and where each one is (the
// captain's window, the spear rack's spot, which stretch of the battlement each guard keeps), all
// drawn from the round's own seeded random numbers, so a seed replays the same castle. Then how far
// along each is, one small check per kind.

/** A guard of a `guards` objective: his stretch (or lookout), where on it he starts, which way. */
export interface PlannedGuard {
  /** The objective (by index in the round's) he's part of. */
  objective: number;
  slot: PostSlot;
  /** How far along his stretch he starts (0 to 1), and which way he walks first. */
  start: number;
  heading: 1 | -1;
}

/** What a round asks for and where it all is. */
export interface RoundPlan {
  objectives: SiegeObjective[];
  /** The captain's window (index in the castle's), if the round has the captain. */
  captainWindow: number | undefined;
  /** The spear rack's prop, if the round has it. */
  rack: string | undefined;
  guards: PlannedGuard[];
}

/** `count` of `list`, picked at random, in their order in it. */
function pick<T>(list: readonly T[], count: number, rng: Rng): T[] {
  const order = list.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  return order
    .slice(0, count)
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const entry = list[index];
      return entry === undefined ? [] : [entry];
    });
}

/** Plans a round at the castle: its objectives, and where each is. */
export function planRound(siege: Siege, layout: CastleLayout, rng: Rng): RoundPlan {
  const objectives = pick(siege.objectives.pool, siege.objectives.count, rng);
  const windows = layout.anchors.captainWindows;
  const racks = layout.anchors.spearRacks;
  const captainWindow = objectives.some((objective) => objective.kind === 'captain')
    ? Math.floor(rng.next() * windows.length)
    : undefined;
  const rack = objectives.some((objective) => objective.kind === 'rack')
    ? racks[Math.floor(rng.next() * racks.length)]?.id
    : undefined;
  const guards: PlannedGuard[] = [];
  objectives.forEach((objective, index) => {
    if (objective.kind !== 'guards') return;
    const slots = objective.posts.flatMap((post) => postSlots(layout, post, objective.slot));
    for (const slot of pick(slots, objective.guards, rng)) {
      guards.push({
        objective: index,
        slot,
        start: rng.next(),
        heading: rng.next() < 0.5 ? -1 : 1,
      });
    }
  });
  return { objectives, captainWindow, rack, guards };
}

/** What an objective's check sees of the round. */
export interface ObjectiveView {
  /** The captain is down. */
  captainDown: boolean;
  /** The spear rack is broken. */
  rackBroken: boolean;
  /** Guards of this objective brought down. */
  guardsDown: number;
}

/** How far along an objective is: `done` of `needed`. */
export interface Progress {
  done: number;
  needed: number;
}

type Check<K extends SiegeObjective['kind']> = (
  objective: Extract<SiegeObjective, { kind: K }>,
  round: ObjectiveView,
) => Progress;

/** One small check per kind of objective. */
const checks: { [K in SiegeObjective['kind']]: Check<K> } = {
  captain: (_, round) => ({ done: round.captainDown ? 1 : 0, needed: 1 }),
  rack: (_, round) => ({ done: round.rackBroken ? 1 : 0, needed: 1 }),
  guards: (objective, round) => ({
    done: Math.min(round.guardsDown, objective.kill),
    needed: objective.kill,
  }),
};

/** How far along an objective is. */
export function objectiveProgress(objective: SiegeObjective, round: ObjectiveView): Progress {
  return (checks[objective.kind] as Check<SiegeObjective['kind']>)(objective, round);
}

/** Whether an objective is done. */
export function objectiveDone(objective: SiegeObjective, round: ObjectiveView): boolean {
  const { done, needed } = objectiveProgress(objective, round);
  return done >= needed;
}

/** An objective in words, for the screen. */
export function objectiveText(objective: SiegeObjective): string {
  switch (objective.kind) {
    case 'captain':
      return 'The captain, at a keep window';
    case 'rack':
      return 'The spear rack';
    case 'guards':
      return `${String(objective.kill)} of ${String(objective.guards)} guards on ${objective.name}`;
  }
}
