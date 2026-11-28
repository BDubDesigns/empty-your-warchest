import { byId, type GameData, type WorkerJob } from '../data';
import { plotCount, tendPlots, type FarmState, type FarmWork } from './farm';
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
  /** What the farm's workers harvested and replanted, when there's a farm. */
  farm?: FarmWork;
}

/** The farm, for the workers: its plots (and clock) and how many are open. */
export interface FarmWorkplace {
  state: FarmState;
  level: number;
}

/** Workers you have at a level of the workers' skill. */
export function workerCount(data: Pick<GameData, 'workers'>, level: number): number {
  const { start, everyLevels } = data.workers;
  // One more at every `everyLevels`th level (5, 10, 15 …).
  return start + Math.floor(Math.max(level, 0) / everyLevels);
}

/** The station a job is done at. */
export function jobStation(data: Pick<GameData, 'recipes'>, job: WorkerJob): string {
  return 'plots' in job ? job.plots : byId(data.recipes, job.recipe).station;
}

/** Whether a station has a worker job (else it takes no workers). */
export function hasJob(data: Pick<GameData, 'workers' | 'recipes'>, station: string): boolean {
  return data.workers.jobs.some((job) => jobStation(data, job) === station);
}

/** Plots one worker tends a minute at a station, if its job is tending plots (the farm's). */
export function plotRate(
  data: Pick<GameData, 'workers' | 'recipes'>,
  station: string,
): number | undefined {
  const job = data.workers.jobs.find((entry) => jobStation(data, entry) === station);
  return job && 'plots' in job ? job.perMinute : undefined;
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
  if (!job || 'plots' in job) return undefined;
  const output = byId(data.recipes, job.recipe).outputs[0];
  if (!output) return undefined;
  return { item: output.item, count: job.perMinute * job.batches * job.yield * output.count };
}

/** Items some worker uses up: the ones a minimum can be kept back of. */
export function workerInputs(data: Pick<GameData, 'workers' | 'recipes' | 'farming'>): string[] {
  const items = new Set<string>();
  for (const job of data.workers.jobs) {
    if ('plots' in job) {
      // The farm's workers replant from the seeds.
      for (const crop of data.farming.crops) items.add(crop.seed);
      continue;
    }
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
 * With a `farm`, its clock moves on with the minutes (its crops grow on the workers' time), and
 * its workers tend its plots in their turn (src/core/farm.ts).
 */
export function doWork(
  data: GameData,
  inventory: Inventory,
  state: WorkState,
  minutes: number,
  farm?: FarmWorkplace,
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
  const farmWork: FarmWork = { harvested: [], replanted: [] };
  let left = Math.max(minutes, 0);
  while (left > 1e-9) {
    const step = Math.min(left, 1);
    left -= step;
    if (farm) farm.state.minutes += step;
    data.workers.jobs.forEach((job, index) => {
      const work = stations[index];
      if (!work || work.workers <= 0) return;
      const key = 'plots' in job ? `plots:${job.plots}` : job.recipe;
      const owed = (state.carry[key] ?? 0) + job.perMinute * work.workers * step;
      const due = Math.floor(owed + 1e-9);
      state.carry[key] = Math.max(owed - due, 0);
      if (due === 0) return;
      if ('plots' in job) {
        if (farm) tendFarm(data, farm, due, state, work, farmWork, spare, take);
        return;
      }
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
  return {
    minutes: Math.max(minutes, 0),
    stations,
    ...(farm && { farm: farmWork }),
  };
}

/** The farm's turn in a minute of work: `due` tends, the harvests going on its pile with their XP. */
function tendFarm(
  data: GameData,
  farm: FarmWorkplace,
  due: number,
  state: WorkState,
  work: StationWork,
  farmWork: FarmWork,
  spare: (item: string, station: string) => number,
  take: (item: string, count: number, station: string) => void,
): void {
  const before = farmWork.harvested.length;
  const used: Stack[] = [];
  tendPlots(
    data,
    farm.state,
    plotCount(data.farming, farm.level),
    due,
    {
      spare: (item) => spare(item, work.station),
      take: (item, count) => {
        take(item, count, work.station);
        addStacks(used, [{ item, count }]);
      },
    },
    farmWork,
  );
  if (farmWork.short) work.short = farmWork.short;
  const harvested = farmWork.harvested.slice(before);
  const made = harvested.map((harvest) => ({ item: harvest.item, count: harvest.count }));
  addStacks((state.piles[work.station] ??= []), made);
  addStacks(work.made, made);
  addStacks(work.used, used);
  const xp = harvested.reduce((sum, harvest) => sum + harvest.xp, 0);
  state.xp[work.station] = (state.xp[work.station] ?? 0) + xp;
  work.xp += xp;
}

function addStacks(into: Stack[], stacks: readonly Stack[]): void {
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    const found = into.find((entry) => entry.item === stack.item);
    if (found) found.count += stack.count;
    else into.push({ ...stack });
  }
}
