import { byId, type GameData, type WorkerJob } from '../data';
import type { Inventory, Stack } from './inventory';

/** Where the workers are and what they're owed: saved with the game. */
export interface WorkState {
  /** Workers at each station, by station id. */
  crew: Record<string, number>;
  /** Jobs owed but not yet done, by recipe: the fractions carried from one stretch to the next. */
  carry: Record<string, number>;
  /** Items the workers never use below, by item id. */
  minimums: Record<string, number>;
  /** What each station's workers made and haven't been collected yet, by station id. */
  piles: Record<string, Stack[]>;
  /** XP each station's workers earned, paid when its pile is collected, by station id. */
  xp: Record<string, number>;
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
 * The workers' work over `minutes`, done to `state` (and the warchest): minute by minute, each
 * station in the data's order (down the chain), its workers run their job `perMinute` times a
 * minute each. They pass things down the line: a job takes its inputs from the other stations'
 * piles first, then from the warchest as far as it's above the minimums. What they make goes on
 * their own station's pile, and its XP waits with it. Whole jobs are done as they come due; the
 * fraction still owed carries over, but a job held up for want of inputs is dropped, not saved up.
 */
export function doWork(
  data: GameData,
  inventory: Inventory,
  state: WorkState,
  minutes: number,
): WorkResult {
  const piles = (station: string): Stack[] => (state.piles[station] ??= []);
  /** How many of `item` the workers can take: on other stations' piles, and spare in the warchest. */
  const spare = (item: string, station: string): number => {
    let count = Math.max(inventory.count(item) - (state.minimums[item] ?? 0), 0);
    for (const [other, pile] of Object.entries(state.piles)) {
      if (other !== station) count += pile.find((stack) => stack.item === item)?.count ?? 0;
    }
    return count;
  };
  /** Takes `count` of `item`, from the other piles first, then the warchest. */
  const take = (item: string, count: number, station: string): void => {
    let left = count;
    for (const [other, pile] of Object.entries(state.piles)) {
      if (other === station || left === 0) continue;
      const stack = pile.find((entry) => entry.item === item);
      if (!stack) continue;
      const taken = Math.min(stack.count, left);
      stack.count -= taken;
      left -= taken;
      if (stack.count === 0) pile.splice(pile.indexOf(stack), 1);
    }
    if (left > 0) inventory.remove(item, left);
  };
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
      const owed = (state.carry[job.recipe] ?? 0) + job.perMinute * work.workers * step;
      const due = Math.floor(owed + 1e-9);
      state.carry[job.recipe] = Math.max(owed - due, 0);
      if (due === 0) return;
      const recipe = byId(data.recipes, job.recipe);
      const needs = [
        ...recipe.inputs.map((input) => ({ item: input.item, count: input.count * job.batches })),
        ...job.extra,
      ];
      let jobs = due;
      for (const need of needs) {
        const can = Math.floor(spare(need.item, work.station) / need.count);
        if (can < jobs) {
          jobs = can;
          work.short = need.item;
        }
      }
      if (jobs === 0) return;
      const used = needs.map((need) => ({ item: need.item, count: need.count * jobs }));
      for (const stack of used) take(stack.item, stack.count, work.station);
      const made = recipe.outputs.map((output) => ({
        item: output.item,
        count: output.count * job.batches * job.yield * jobs,
      }));
      addStacks(piles(work.station), made);
      addStacks(work.made, made);
      addStacks(work.used, used);
      const xp = recipe.xp * job.batches * job.yield * jobs;
      state.xp[work.station] = (state.xp[work.station] ?? 0) + xp;
      work.xp += xp;
    });
  }
  return { minutes: Math.max(minutes, 0), stations };
}

function addStacks(into: Stack[], stacks: readonly Stack[]): void {
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    const found = into.find((entry) => entry.item === stack.item);
    if (found) found.count += stack.count;
    else into.push({ ...stack });
  }
}
