import { byId, type Crop, type Farming, type GameData } from '../data';
import type { Stack } from './inventory';

/** How a planting was watered (once per planting): by the mini game or by a worker. */
export interface Watering {
  /** The watering's stars (a worker's are the data's). */
  stars: number;
  /** This plot ended in its band: only then does it get the stars' multiplier. */
  inBand: boolean;
  /** Where its gauge ended (0 dry to 1 soaked). */
  moisture: number;
  by: 'player' | 'worker';
}

/** A crop in the ground. */
export interface Planting {
  crop: string;
  /** When it went in, on the farm's clock (minutes). */
  plantedAt: number;
  water?: Watering;
  /** Its growing has been seen to end (logged once). */
  ripe?: boolean;
}

export interface Plot {
  planting?: Planting;
  /** The crop last harvested here: what a worker replants. */
  last?: string;
}

/**
 * The farm, saved with the game. Its clock is the workers' time (playing, and away up to their
 * cap), banked by the same WorkClock: `minutes` is all of it banked so far, so a crop planted at
 * `plantedAt` has grown `minutes + owed - plantedAt`, whatever the real time.
 */
export interface FarmState {
  minutes: number;
  plots: Plot[];
}

/** What harvesting one plot gives. */
export interface Harvest {
  plot: number;
  crop: string;
  item: string;
  count: number;
  xp: number;
  multiplier: number;
}

/** What the farm's workers did over a stretch. */
export interface FarmWork {
  harvested: Harvest[];
  replanted: { plot: number; crop: string }[];
  /** A seed they ran short of (or hit the minimum of). */
  short?: string;
}

/** How grown a planting looks: just sown, a sprout, young, grown, or ripe. */
export type GrowthStage = 'seed' | 'sprout' | 'young' | 'grown' | 'ripe';

export function newFarm(): FarmState {
  return { minutes: 0, plots: [] };
}

/** A farm as a save file has it: any of its optional parts may be there as undefined. */
export interface SavedFarm {
  minutes: number;
  plots: {
    planting?:
      | {
          crop: string;
          plantedAt: number;
          water?: Watering | undefined;
          ripe?: boolean | undefined;
        }
      | undefined;
    last?: string | undefined;
  }[];
}

/** A deep copy of a farm (or a saved one). */
export function copyFarm(farm: SavedFarm): FarmState {
  return {
    minutes: farm.minutes,
    plots: farm.plots.map((plot): Plot => {
      const copy: Plot = {};
      if (plot.last !== undefined) copy.last = plot.last;
      const planting = plot.planting;
      if (planting) {
        copy.planting = { crop: planting.crop, plantedAt: planting.plantedAt };
        if (planting.water) copy.planting.water = { ...planting.water };
        if (planting.ripe) copy.planting.ripe = true;
      }
      return copy;
    }),
  };
}

/** The farm's station in the data (there's one), and the skill it trains. */
export function farmStation(data: Pick<GameData, 'stations'>) {
  const station = data.stations.find((entry) => entry.mechanic === 'farming');
  if (!station) throw new Error('No farm in the data');
  return station;
}

/** Plots open at a Farming level: the most whose level is reached. */
export function plotCount(farming: Pick<Farming, 'plots'>, level: number): number {
  let count = 0;
  for (const entry of farming.plots) if (entry.level <= level) count = entry.count;
  return count;
}

/** Crops open at a Farming level, in data order. */
export function cropsOpen(farming: Pick<Farming, 'crops'>, level: number): Crop[] {
  return farming.crops.filter((crop) => crop.level <= level);
}

export function cropById(farming: Pick<Farming, 'crops'>, id: string): Crop {
  return byId(farming.crops, id);
}

/** When a planting is ripe, on the farm's clock. */
export function ripeAt(farming: Pick<Farming, 'crops'>, planting: Planting): number {
  return planting.plantedAt + cropById(farming, planting.crop).growMinutes;
}

/** How far a planting has grown at `now` (farm minutes): 0 just sown, 1 ripe. It never dies. */
export function growth(farming: Pick<Farming, 'crops'>, planting: Planting, now: number): number {
  const grow = cropById(farming, planting.crop).growMinutes;
  return Math.min(Math.max((now - planting.plantedAt) / grow, 0), 1);
}

export function isRipe(farming: Pick<Farming, 'crops'>, planting: Planting, now: number): boolean {
  return now >= ripeAt(farming, planting) - 1e-9;
}

/** The stage a share of growing (0 to 1) shows, from the looks' thresholds. */
export function stageOf(stages: Farming['looks']['stages'], grown: number): GrowthStage {
  if (grown >= 1) return 'ripe';
  if (grown >= stages.grown) return 'grown';
  if (grown >= stages.young) return 'young';
  return grown >= stages.sprout ? 'sprout' : 'seed';
}

/** What a plot's watering multiplies its yield by: its stars' if it ended in its band, else 1. */
export function multiplierFor(watering: Pick<Farming, 'watering'>['watering'], water?: Watering) {
  if (!water?.inBand || water.stars < 1) return 1;
  const { one, two, three } = watering.multiplier;
  return water.stars >= 3 ? three : water.stars === 2 ? two : one;
}

/** What a ripe planting gives: its crop's yield times its watering's multiplier, rounded. */
export function harvestOf(
  farming: Pick<Farming, 'crops' | 'watering'>,
  plot: number,
  planting: Planting,
): Harvest {
  const crop = cropById(farming, planting.crop);
  const multiplier = multiplierFor(farming.watering, planting.water);
  const count = Math.max(Math.round(crop.yield * multiplier), 1);
  return { plot, crop: crop.id, item: crop.item, count, xp: count * crop.xp, multiplier };
}

/** Stars from the share of plots that ended in their band (the data's thresholds). */
export function wateringStars(stars: Farming['watering']['stars'], inBand: number, plots: number) {
  if (plots <= 0) return 0;
  const share = inBand / plots;
  if (share >= stars.three - 1e-9) return 3;
  if (share >= stars.two - 1e-9) return 2;
  return share >= stars.one - 1e-9 ? 1 : 0;
}

/**
 * The extra seeds a watering gives: at 3 stars, `seedBonus.three` of each crop's plots, rounded
 * down (so watering one plot at a time never makes seeds from nothing).
 */
export function seedBonus(
  farming: Pick<Farming, 'crops' | 'watering'>,
  stars: number,
  crops: string[],
) {
  if (stars < 3) return [];
  const counts = new Map<string, number>();
  for (const crop of crops) counts.set(crop, (counts.get(crop) ?? 0) + 1);
  const bonus: Stack[] = [];
  for (const [crop, plots] of counts) {
    const count = Math.floor(plots * farming.watering.seedBonus.three + 1e-9);
    if (count > 0) bonus.push({ item: cropById(farming, crop).seed, count });
  }
  return bonus;
}

/** The plot a worker tends next: the ripe one that's waited longest, else an empty one to replant. */
function nextToTend(farming: Farming, farm: FarmState, plots: number): number | undefined {
  let best: { plot: number; at: number } | undefined;
  for (let plot = 0; plot < plots; plot++) {
    const planting = farm.plots[plot]?.planting;
    if (!planting || !isRipe(farming, planting, farm.minutes)) continue;
    const at = ripeAt(farming, planting);
    if (!best || at < best.at) best = { plot, at };
  }
  if (best) return best.plot;
  for (let plot = 0; plot < plots; plot++) {
    const entry = farm.plots[plot];
    if (entry && !entry.planting && entry.last !== undefined) return plot;
  }
  return undefined;
}

/** Where a worker gets seeds: how many it can take, and taking them. */
export interface SeedSource {
  spare: (item: string) => number;
  take: (item: string, count: number) => void;
}

/**
 * `due` worker tends at the farm, now (its clock already moved on): each harvests the ripe plot
 * that's waited longest (its own watering's multiplier) and replants what was there, watered at
 * the worker's stars, or replants an empty plot that had a crop. A tend with nothing to do, or no
 * seed for it, is dropped.
 */
export function tendPlots(
  data: Pick<GameData, 'farming'>,
  farm: FarmState,
  plots: number,
  due: number,
  seeds: SeedSource,
  work: FarmWork,
): void {
  const farming = data.farming;
  for (let tend = 0; tend < due; tend++) {
    const plot = nextToTend(farming, farm, plots);
    if (plot === undefined) return;
    const entry = (farm.plots[plot] ??= {});
    const planting = entry.planting;
    if (planting) {
      work.harvested.push(harvestOf(farming, plot, planting));
      entry.last = planting.crop;
      delete entry.planting;
    }
    const crop = cropById(farming, entry.last ?? '');
    if (seeds.spare(crop.seed) < 1) {
      work.short = crop.seed;
      // Nothing more it can do here until there are seeds.
      if (!planting) return;
      continue;
    }
    seeds.take(crop.seed, 1);
    const middle = (crop.band.low + crop.band.high) / 2;
    entry.planting = {
      crop: crop.id,
      plantedAt: farm.minutes,
      water: { stars: farming.worker.stars, inBand: true, moisture: middle, by: 'worker' },
    };
    work.replanted.push({ plot, crop: crop.id });
  }
}

/** Checks a saved farm against the data: throws on a crop that no longer exists. */
export function checkFarm(data: Pick<GameData, 'farming'>, farm: FarmState): void {
  for (const plot of farm.plots) {
    for (const crop of [plot.planting?.crop, plot.last]) {
      if (crop !== undefined && !data.farming.crops.some((entry) => entry.id === crop)) {
        throw new Error(`Save has a plot of "${crop}", which isn't a crop`);
      }
    }
  }
}
