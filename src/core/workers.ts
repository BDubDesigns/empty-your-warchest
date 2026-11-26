import { byId, type GameData, type WorkerJob } from '../data';
import type { Inventory, Stack } from './inventory';
import { craft } from './recipes';

/** Where the workers are and what they're owed: saved with the game. */
export interface WorkState {
  /** Workers at each station, by station id. */
  crew: Record<string, number>;
  /** Jobs owed but not yet done, by recipe: the fractions carried from one stretch to the next. */
  carry: Record<string, number>;
  /** Items the workers never use below, by item id. */
  minimums: Record<string, number>;
}

/** What one station's workers did over a stretch of time. */
export interface StationWork {
  station: string;
  skill: string;
  workers: number;
  made: Stack[];
  used: Stack[];
  xp: number;
  /** An item they ran short of (or hit the minimum of), holding them up. */
  short?: string;
}

export interface WorkResult {
  minutes: number;
  stations: StationWork[];
  carry: Record<string, number>;
}

/** Workers you have at a level of the workers' skill. */
export function workerCount(data: Pick<GameData, 'workers'>, level: number): number {
  const { start, everyLevels } = data.workers;
  // One more at every `everyLevels`th level (5, 10, 15 …).
  return start + Math.floor(Math.max(level, 0) / everyLevels);
}

/** The station a job is done at. */
export function jobStation(data: Pick<GameData, 'recipes'>, job: WorkerJob): string {
  return byId(data.recipes, job.recipe).station;
}

/** A new game's crew: each job's `start` workers. */
export function startingCrew(data: Pick<GameData, 'workers' | 'recipes'>): Record<string, number> {
  return Object.fromEntries(data.workers.jobs.map((job) => [jobStation(data, job), job.start]));
}

/** What one worker at a station makes a minute: the job's first output. */
export function workerRate(
  data: Pick<GameData, 'workers' | 'recipes'>,
  station: string,
): Stack | undefined {
  const job = data.workers.jobs.find((entry) => jobStation(data, entry) === station);
  const output = job && byId(data.recipes, job.recipe).outputs[0];
  if (!job || !output) return undefined;
  return { item: output.item, count: job.perMinute * job.batches * job.yield * output.count };
}

/** Items some worker uses up: the ones a minimum can be kept back of. */
export function workerInputs(data: Pick<GameData, 'workers' | 'recipes'>): string[] {
  const items = new Set<string>();
  for (const job of data.workers.jobs) {
    for (const input of byId(data.recipes, job.recipe).inputs) items.add(input.item);
    for (const extra of job.extra) items.add(extra.item);
  }
  return [...items];
}

/**
 * The workers' work over `minutes`, done to `inventory`: minute by minute, each station in the
 * data's order (down the chain), its workers run their job `perMinute` times a minute each. Whole
 * jobs are done as they come due, as far as the inputs above the minimums go; the fraction of a
 * job still owed carries over, but a job held up for want of inputs is dropped, not saved up.
 */
export function doWork(
  data: GameData,
  inventory: Inventory,
  state: WorkState,
  minutes: number,
): WorkResult {
  const carry = { ...state.carry };
  const stations = data.workers.jobs.map((job): StationWork => {
    const station = byId(data.stations, jobStation(data, job));
    return {
      station: station.id,
      skill: station.skill,
      workers: state.crew[station.id] ?? 0,
      made: [],
      used: [],
      xp: 0,
    };
  });
  let left = Math.max(minutes, 0);
  while (left > 1e-9) {
    const step = Math.min(left, 1);
    left -= step;
    data.workers.jobs.forEach((job, index) => {
      const work = stations[index];
      if (!work || work.workers <= 0) return;
      const owed = (carry[job.recipe] ?? 0) + job.perMinute * work.workers * step;
      const due = Math.floor(owed + 1e-9);
      carry[job.recipe] = Math.max(owed - due, 0);
      if (due === 0) return;
      const recipe = byId(data.recipes, job.recipe);
      const needs = [
        ...recipe.inputs.map((input) => ({ item: input.item, count: input.count * job.batches })),
        ...job.extra,
      ];
      let jobs = due;
      for (const need of needs) {
        const spare = inventory.count(need.item) - (state.minimums[need.item] ?? 0);
        const can = Math.max(Math.floor(spare / need.count), 0);
        if (can < jobs) {
          jobs = can;
          work.short = need.item;
        }
      }
      if (jobs === 0) return;
      const result = craft(inventory, recipe, { batches: job.batches * jobs, yield: job.yield });
      for (const extra of job.extra) inventory.remove(extra.item, extra.count * jobs);
      addStacks(work.made, result.produced);
      addStacks(work.used, [
        ...result.consumed,
        ...job.extra.map((extra) => ({ item: extra.item, count: extra.count * jobs })),
      ]);
      work.xp += result.xp;
    });
  }
  return { minutes: Math.max(minutes, 0), stations, carry };
}

function addStacks(into: Stack[], stacks: readonly Stack[]): void {
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    const found = into.find((entry) => entry.item === stack.item);
    if (found) found.count += stack.count;
    else into.push({ ...stack });
  }
}
