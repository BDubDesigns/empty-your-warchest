import {
  cropById,
  Rng,
  seedBonus,
  wateringStars,
  type EventLogger,
  type Stack,
  type Watering,
} from '../../../core';
import type { Crop, Farming, FarmingFeel } from '../../../data';

/** A plot's soil against its band: too little, in it, or past it (mud, a miss). */
export type SoilState = 'dry' | 'good' | 'mud';

/** One plot's soil gauge in a watering. */
export interface Gauge {
  plot: number;
  crop: Crop;
  /** The crop's thirst: the gauge's target band. */
  band: { low: number; high: number };
  /** Where it started (seeded), where it is now (0 dry to 1 soaked), and how much went on. */
  start: number;
  moisture: number;
  poured: number;
  state: SoilState;
}

/** One stretch of pouring on one plot: from the can tipping over it to its stopping. */
export interface Pour {
  plot: number;
  /** Round time it started, and how long it lasted. */
  at: number;
  seconds: number;
  amount: number;
  /** The gauge after it, and what that is. */
  moisture: number;
  state: SoilState;
}

export type WateringEndReason = 'done' | 'time' | 'dry' | 'leave';

/** How a watering went. */
export interface WateringResult {
  stars: number;
  /** Plots that ended in their band, of the plots watered. */
  inBand: number;
  plots: number;
  /** Plots left dry and turned to mud. */
  dry: number;
  mud: number;
  /** Water poured, and left in the can. */
  used: number;
  left: number;
  /** Extra seeds for 3 stars. */
  bonus: Stack[];
  seconds: number;
  reason: WateringEndReason;
}

/** Things a view plays effects for. */
export type WateringEvent =
  | { type: 'pour'; gauge: Gauge }
  | { type: 'band'; gauge: Gauge }
  | { type: 'mud'; gauge: Gauge }
  | { type: 'stop'; gauge: Gauge; pour: Pour }
  | { type: 'empty' }
  | ({ type: 'end' } & WateringResult);

export interface WateringHooks {
  logger: EventLogger;
  /** The Farming level, for the logs. */
  level: number;
  /** Records each plot's watering (once per planting) when the round ends. */
  record: (plot: number, water: Watering) => void;
  /** Banks the 3 stars' extra seeds. */
  bank: (seeds: Stack[]) => void;
  onEvent?: (event: WateringEvent) => void;
}

/** What a gauge level is, against a band. */
export function soilState(moisture: number, band: { low: number; high: number }): SoilState {
  if (moisture < band.low - 1e-9) return 'dry';
  return moisture > band.high + 1e-9 ? 'mud' : 'good';
}

/** How much the can holds for a farm of `plots` plots. */
export function canCapacity(rules: Pick<Farming, 'watering'>, plots: number): number {
  return rules.watering.can.perPlot * plots;
}

/**
 * One watering at the farm, without any rendering: a can of `capacity` water over the plots
 * planted and not yet watered, each with its crop's band. A view tells it where the can is and
 * whether the finger's holding it down to pour, and runs time on; the can pours `pourRate` a
 * second on the plot under it. When it ends (Done, the time, the can running dry, or leaving),
 * each plot's watering is recorded with the round's stars. The same inputs at the same times play
 * out the same.
 */
export class WateringRound {
  readonly rules: Farming;
  /** The feel, fixed for the round (sliders apply from the next one). */
  readonly feel: FarmingFeel;
  readonly capacity: number;
  readonly gauges: Gauge[];
  readonly pours: Pour[] = [];
  phase: 'water' | 'done' = 'water';
  /** Seconds into the round. */
  now = 0;
  /** Water left in the can. */
  water: number;
  result: WateringResult | undefined;
  readonly #hooks: WateringHooks;
  /** The plot under the can, and whether it's pouring. */
  #over: number | undefined;
  #pouring = false;
  #pour: Pour | undefined;
  #emptyAt: number | undefined;

  constructor(
    rules: Farming,
    feel: FarmingFeel,
    plots: readonly { plot: number; crop: string }[],
    capacity: number,
    seed: number | string,
    hooks: WateringHooks,
  ) {
    this.rules = rules;
    this.feel = { ...feel };
    this.capacity = capacity;
    this.water = capacity;
    this.#hooks = hooks;
    const rng = new Rng(seed);
    const { start } = rules.watering;
    this.gauges = plots.map(({ plot, crop }) => {
      const entry = cropById(rules, crop);
      const moisture = rng.range(start.min, start.max);
      return {
        plot,
        crop: entry,
        band: { ...entry.band },
        start: moisture,
        moisture,
        poured: 0,
        state: soilState(moisture, entry.band),
      };
    });
    hooks.logger.log('farming.waterStart', {
      level: hooks.level,
      capacity: round3(capacity),
      seconds: rules.watering.seconds,
      plots: this.gauges.map((gauge) => ({
        plot: gauge.plot,
        crop: gauge.crop.id,
        start: round3(gauge.start),
        band: [gauge.band.low, gauge.band.high],
      })),
      feel: this.feel,
    });
  }

  /** Seconds left in the round. */
  get left(): number {
    return Math.max(this.rules.watering.seconds - this.now, 0);
  }

  /** The plot being poured on right now, if any. */
  get pouringOn(): number | undefined {
    return this.phase === 'water' && this.#pouring && this.water > 0 ? this.#over : undefined;
  }

  gauge(plot: number): Gauge | undefined {
    return this.gauges.find((gauge) => gauge.plot === plot);
  }

  /** Plots in their band right now. */
  get inBand(): number {
    return this.gauges.filter((gauge) => gauge.state === 'good').length;
  }

  /**
   * Where the can is: over `plot` (or between plots, undefined), and whether the finger's holding
   * it down to pour. Plots not in this watering take no water.
   */
  aim(plot: number | undefined, pouring: boolean): void {
    if (this.phase !== 'water') return;
    const over = plot !== undefined && this.gauge(plot) ? plot : undefined;
    if (over !== this.#over || pouring !== this.#pouring) this.#stopPour();
    this.#over = over;
    this.#pouring = pouring;
  }

  /** Runs the round on by `dt` seconds, pouring on the plot under the can if it's held down. */
  tick(dt: number): void {
    if (this.phase !== 'water') return;
    const step = Math.max(dt, 0);
    const end = Math.min(this.now + step, this.rules.watering.seconds);
    const gauge = this.#over === undefined ? undefined : this.gauge(this.#over);
    if (this.#pouring && gauge && this.water > 0) {
      const room = 1 - gauge.moisture;
      const amount = Math.min(this.feel.pourRate * (end - this.now), this.water, room);
      if (!this.#pour) {
        this.#pour = {
          plot: gauge.plot,
          at: this.now,
          seconds: 0,
          amount: 0,
          moisture: gauge.moisture,
          state: gauge.state,
        };
        this.#hooks.onEvent?.({ type: 'pour', gauge });
      }
      if (amount > 0) {
        const before = gauge.state;
        this.water = Math.max(this.water - amount, 0);
        gauge.moisture = Math.min(gauge.moisture + amount, 1);
        gauge.poured += amount;
        gauge.state = soilState(gauge.moisture, gauge.band);
        this.#pour.amount += amount;
        if (gauge.state !== before) {
          this.#hooks.onEvent?.({ type: gauge.state === 'mud' ? 'mud' : 'band', gauge });
        }
      }
      this.#pour.seconds = end - this.#pour.at;
      if (this.water <= 1e-9) {
        this.water = 0;
        this.#stopPour();
        this.#emptyAt = end;
        this.#hooks.onEvent?.({ type: 'empty' });
      }
    }
    this.now = end;
    if (this.#emptyAt !== undefined && this.now - this.#emptyAt >= this.feel.dryEndSeconds - 1e-9) {
      this.#end('dry');
    } else if (this.now >= this.rules.watering.seconds - 1e-9) {
      this.#end('time');
    }
  }

  /** The Done button: ends it now. */
  finish(): void {
    this.#end('done');
  }

  /** Leaving mid-round: it ends as it stands (what's poured counts; never a penalty). */
  exit(): void {
    this.#end('leave');
  }

  #stopPour(): void {
    const pour = this.#pour;
    if (!pour) return;
    this.#pour = undefined;
    const gauge = this.gauge(pour.plot);
    if (!gauge) return;
    pour.moisture = gauge.moisture;
    pour.state = gauge.state;
    this.pours.push(pour);
    this.#hooks.logger.log('farming.pour', {
      plot: pour.plot,
      crop: gauge.crop.id,
      at: round3(pour.at),
      seconds: round3(pour.seconds),
      amount: round3(pour.amount),
      moisture: round3(pour.moisture),
      band: [gauge.band.low, gauge.band.high],
      state: pour.state,
      hit: pour.state === 'good',
      waterLeft: round3(this.water),
    });
    this.#hooks.onEvent?.({ type: 'stop', gauge, pour });
  }

  #end(reason: WateringEndReason): void {
    if (this.phase === 'done') return;
    this.#stopPour();
    this.phase = 'done';
    const { gauges } = this;
    const inBand = this.inBand;
    const stars = wateringStars(this.rules.watering.stars, inBand, gauges.length);
    for (const gauge of gauges) {
      this.#hooks.record(gauge.plot, {
        stars,
        inBand: gauge.state === 'good',
        moisture: gauge.moisture,
        by: 'player',
      });
    }
    const bonus = seedBonus(
      this.rules,
      stars,
      gauges.map((gauge) => gauge.crop.id),
    );
    if (bonus.length > 0) this.#hooks.bank(bonus);
    const result: WateringResult = {
      stars,
      inBand,
      plots: gauges.length,
      dry: gauges.filter((gauge) => gauge.state === 'dry').length,
      mud: gauges.filter((gauge) => gauge.state === 'mud').length,
      used: this.capacity - this.water,
      left: this.water,
      bonus,
      seconds: this.now,
      reason,
    };
    this.result = result;
    this.#hooks.logger.log('farming.waterEnd', {
      level: this.#hooks.level,
      ...result,
      used: round3(result.used),
      left: round3(result.left),
      seconds: round3(this.now),
      pours: this.pours.length,
      plots: gauges.map((gauge) => ({
        plot: gauge.plot,
        crop: gauge.crop.id,
        moisture: round3(gauge.moisture),
        state: gauge.state,
      })),
    });
    this.#hooks.onEvent?.({ type: 'end', ...result });
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
