import { Rng, type EventLogger } from '../../../core';
import type { Splitting, SplittingFeel, SplittingLog } from '../../../data';
import { Pump } from './pump';
import {
  bestPlan,
  DEG,
  normalize,
  planFor,
  snapTurn,
  starsFor,
  worthOf,
  type Plan,
} from './pattern';

const degrees = (radians: number) => Math.round(normalize(radians) / DEG);

export type SplittingPhase =
  /** Picking a head and turning the cuts. */
  | { kind: 'plan' }
  /** The head dropping onto the log. */
  | { kind: 'swing'; at: number }
  /** Pumping the handle to drive the head through. */
  | { kind: 'pump'; pump: Pump }
  | { kind: 'done' };

/** Things a view plays effects for. */
export type SplittingEvent =
  | { type: 'strike' }
  /** The head has landed: the pump starts. */
  | { type: 'landed' }
  /** A stroke of the pump drove the head one notch in (`stroke` of `strokes`). */
  | { type: 'stroke'; stroke: number; strokes: number }
  | {
      type: 'done';
      /** The plan as it came out. */
      plan: Plan;
      /** The best this log could have made with these heads, and the stars for this one. */
      best: Plan;
      stars: number;
      /** Bonus staves for the stars, and what went into the warchest in all. */
      bonus: number;
      banked: number;
    };

export interface SplittingHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => SplittingFeel;
  rules: Splitting;
  /** The heads open to choose from, fewest pieces first. */
  heads: readonly number[];
  /**
   * Banks a finished log: runs the splitting recipe for `worth` staves (its staves × its grains,
   * plus any star bonus; uses up the log), paying XP on the `staves` split. Returns the staves
   * banked.
   */
  bank: (worth: number, staves: number) => number;
  onEvent?: (event: SplittingEvent) => void;
}

/**
 * Splitting one log, without any rendering: pick a head and turn its cuts (in whole steps), strike
 * to drop it onto the log, then pump the handle to drive it through. Every wedge is a stave, and
 * grains kept whole multiply the log. A view feeds it input and time, and draws its state.
 */
export class SplittingRound {
  readonly log: SplittingLog;
  readonly heads: readonly number[];
  /** The best this log could make with these heads: what stars are out of. */
  readonly best: Plan;
  /** The head chosen and how it's turned (radians, always on a whole step). */
  count: number;
  rotation: number;
  phase: SplittingPhase = { kind: 'plan' };
  now = 0;
  readonly #hooks: SplittingHooks;
  readonly #rng: Rng;
  #pumpStart = 0;
  #strokeAt = 0;
  #strokeGaps: number[] = [];
  #headChanges = 0;

  constructor(log: SplittingLog, hooks: SplittingHooks, seed: number, count?: number) {
    const first = hooks.heads[0];
    if (first === undefined) throw new Error('No heads to split with');
    this.log = log;
    this.heads = hooks.heads;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.count = count !== undefined && hooks.heads.includes(count) ? count : first;
    this.best = bestPlan(hooks.rules, log, hooks.heads);
    // The cuts start at a random turn well short of the best (under 2 stars if there is one), so
    // the first look always has work to do.
    const randomTurn = () => snapTurn(hooks.rules, this.#rng.range(0, Math.PI * 2));
    this.rotation = randomTurn();
    let start = { rotation: this.rotation, worth: this.plan.worth };
    for (let tries = 0; tries < 40 && this.starsNow >= 2; tries++) {
      this.rotation = randomTurn();
      if (this.plan.worth < start.worth)
        start = { rotation: this.rotation, worth: this.plan.worth };
    }
    this.rotation = start.rotation;
    this.#log('splitting.logStart', {
      log: log.id,
      seed,
      grains: log.grains.map((grain) => grain.kind),
      knots: log.knots.length,
      heads: hooks.heads,
      best: { head: this.best.count, turn: degrees(this.best.rotation), worth: this.best.worth },
      feel: hooks.feel(),
    });
  }

  get feel(): SplittingFeel {
    return this.#hooks.feel();
  }

  get rules(): Splitting {
    return this.#hooks.rules;
  }

  /** What the head as chosen and turned makes. */
  get plan(): Plan {
    return planFor(this.rules, this.log, this.count, this.rotation);
  }

  /** Stars the plan as it stands would earn. */
  get starsNow(): number {
    return starsFor(this.rules, this.plan.worth, this.best.worth);
  }

  /** The staves needed for 1, 2 and 3 stars. */
  get starTargets(): [number, number, number] {
    const { one, two, three } = this.rules.stars;
    const need = (share: number) => Math.ceil(this.best.worth * share - 1e-9);
    return [need(one), need(two), need(three)];
  }

  // Planning

  /** Picks a head (only an open one, and only while planning). */
  choose(count: number): void {
    if (this.phase.kind !== 'plan' || !this.heads.includes(count) || count === this.count) return;
    this.count = count;
    this.#headChanges += 1;
  }

  /** Turns the cuts to the step nearest `rotation` (radians). */
  turnTo(rotation: number): void {
    if (this.phase.kind === 'plan') this.rotation = snapTurn(this.rules, rotation);
  }

  /** The ↺ ↻ buttons: one step one way (+1) or the other (−1). */
  nudge(direction: 1 | -1): void {
    this.turnTo(this.rotation + direction * this.rules.turnStep * DEG);
  }

  // Striking and pumping

  /** Drops the head onto the log: commits the plan. */
  strike(): void {
    if (this.phase.kind !== 'plan') return;
    const plan = this.plan;
    this.#log('splitting.strike', {
      log: this.log.id,
      head: plan.count,
      turn: degrees(plan.rotation),
      grainsCut: plan.cut.map((index) => this.log.grains[index]?.kind),
      multiplier: plan.multiplier,
      worth: plan.worth,
      best: this.best.worth,
      headChanges: this.#headChanges,
      planSeconds: Math.round(this.now * 10) / 10,
    });
    this.#hooks.onEvent?.({ type: 'strike' });
    this.phase = { kind: 'swing', at: this.now };
  }

  /** The finger on the handle is `pixels` down from where it went down. */
  pull(pixels: number): void {
    const phase = this.phase;
    if (phase.kind !== 'pump') return;
    const result = phase.pump.pull(pixels);
    if (!result) return;
    this.#strokeGaps.push(Math.round((this.now - this.#strokeAt) * 100) / 100);
    this.#strokeAt = this.now;
    if (result === 'through') {
      this.#done(phase.pump);
      return;
    }
    this.#hooks.onEvent?.({ type: 'stroke', stroke: phase.pump.done, strokes: phase.pump.strokes });
  }

  /** The finger lifted off the handle. */
  release(): void {
    if (this.phase.kind === 'pump') this.phase.pump.release();
  }

  // Time

  tick(dt: number): void {
    this.now += dt;
    const phase = this.phase;
    if (phase.kind === 'swing' && this.now - phase.at >= this.feel.strikeSeconds) {
      const pump = new Pump(
        () => this.feel,
        this.count,
        Math.min(...this.rules.cutters.map((cutter) => cutter.count)),
        Math.max(...this.rules.cutters.map((cutter) => cutter.count)),
      );
      this.#pumpStart = this.#strokeAt = this.now;
      this.phase = { kind: 'pump', pump };
      this.#hooks.onEvent?.({ type: 'landed' });
    }
  }

  /** Leaving mid-log: nothing is banked and the log isn't used up. */
  exit(): void {
    if (this.phase.kind === 'done') return;
    this.#log('splitting.leave', {
      log: this.log.id,
      phase: this.phase.kind,
      head: this.count,
      seconds: Math.round(this.now * 10) / 10,
    });
  }

  #done(pump: Pump): void {
    const plan = this.plan;
    const stars = starsFor(this.rules, plan.worth, this.best.worth);
    const share =
      stars >= 3 ? this.rules.starBonus.three : stars >= 2 ? this.rules.starBonus.two : 0;
    const bonus = worthOf(plan.worth, share);
    this.phase = { kind: 'done' };
    const banked = this.#hooks.bank(plan.worth + bonus, plan.staves);
    this.#log('splitting.logEnd', {
      log: this.log.id,
      head: plan.count,
      turn: degrees(plan.rotation),
      staves: plan.staves,
      knotted: plan.knotted.length,
      multiplier: plan.multiplier,
      worth: plan.worth,
      best: this.best.worth,
      bestHead: this.best.count,
      stars,
      bonus,
      grainsKept: plan.kept.map((entry) => this.log.grains[entry.grain]?.kind),
      grainsCut: plan.cut.map((index) => this.log.grains[index]?.kind),
      seconds: Math.round(this.now * 10) / 10,
      strokes: pump.strokes,
      pumpSeconds: Math.round((this.now - this.#pumpStart) * 100) / 100,
      strokeGaps: this.#strokeGaps,
    });
    this.#hooks.onEvent?.({
      type: 'done',
      plan,
      best: this.best,
      stars,
      bonus,
      banked,
    });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}
