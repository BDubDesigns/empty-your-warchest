import { Rng, type EventLogger } from '../../../core';
import type { Riving, RivingFeel, RivingLog } from '../../../data';
import { Press } from './press';
import { bestPlan, DEG, normalize, planFor, starsFor, worthOf, type Plan } from './pattern';

const degrees = (radians: number) => Math.round((normalize(radians) / DEG) * 10) / 10;

export type RivingPhase =
  /** Picking a head and turning the cuts. */
  | { kind: 'plan' }
  /** The head dropping onto the log. */
  | { kind: 'swing'; at: number }
  /** Pulling the lever to drive the head through. */
  | { kind: 'press'; press: Press }
  | { kind: 'done' };

/** Things a view plays effects for. */
export type RivingEvent =
  | { type: 'strike' }
  /** The head has landed: the pull starts. */
  | { type: 'landed' }
  /** A piece split off badly during the pull: it's lost, with any grain in it. */
  | { type: 'lost'; wedge: number }
  | {
      type: 'done';
      /** The plan as it came out (lost pieces and their grains gone). */
      plan: Plan;
      lost: number[];
      /** The best this log could have made with these heads, and the stars for this one. */
      best: Plan;
      stars: number;
      /** Bonus staves for the stars, and what went into the warchest in all. */
      bonus: number;
      banked: number;
    };

export interface RivingHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => RivingFeel;
  rules: Riving;
  /** The heads open to choose from, fewest pieces first. */
  heads: readonly number[];
  /**
   * Banks a finished log: runs the riving recipe for `worth` staves (its staves × its grains,
   * plus any star bonus; uses up the log), paying XP on the `staves` split. Returns the staves
   * banked.
   */
  bank: (worth: number, staves: number) => number;
  onEvent?: (event: RivingEvent) => void;
}

/**
 * Riving one log, without any rendering: pick a head and turn its cuts, strike to drop it onto the
 * log, then pull the lever down to drive it through while keeping the bubble steady. Every wedge is
 * a stave; grains kept whole multiply the log; pieces lost to the bubble are gone. A view feeds it
 * input and time, and draws its state.
 */
export class RivingRound {
  readonly log: RivingLog;
  readonly heads: readonly number[];
  /** The best this log could make with these heads, pulled perfectly: what stars are out of. */
  readonly best: Plan;
  /** The head chosen and how it's turned (radians). */
  count: number;
  rotation: number;
  phase: RivingPhase = { kind: 'plan' };
  now = 0;
  /** Wedges (by index) lost during the pull. */
  lost: number[] = [];
  readonly #hooks: RivingHooks;
  readonly #rng: Rng;
  #pressStart = 0;
  #headChanges = 0;

  constructor(log: RivingLog, hooks: RivingHooks, seed: number, count?: number) {
    const first = hooks.heads[0];
    if (first === undefined) throw new Error('No heads to rive with');
    this.log = log;
    this.heads = hooks.heads;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.count = count !== undefined && hooks.heads.includes(count) ? count : first;
    this.best = bestPlan(hooks.rules, log, hooks.heads);
    // The cuts start at a random turn that isn't already the best, so there's always a look.
    this.rotation = this.#rng.range(0, Math.PI * 2);
    for (let tries = 0; tries < 20 && this.plan.worth >= this.best.worth; tries++) {
      this.rotation = this.#rng.range(0, Math.PI * 2);
    }
    this.#log('riving.logStart', {
      log: log.id,
      seed,
      grains: log.grains.map((grain) => grain.kind),
      knots: log.knots.length,
      checks: log.checks.length,
      heads: hooks.heads,
      best: { head: this.best.count, turn: degrees(this.best.rotation), worth: this.best.worth },
      feel: hooks.feel(),
    });
  }

  get feel(): RivingFeel {
    return this.#hooks.feel();
  }

  get rules(): Riving {
    return this.#hooks.rules;
  }

  /** What the head as chosen and turned makes now (with any pieces lost so far). */
  get plan(): Plan {
    return planFor(this.rules, this.log, this.count, this.rotation, this.lost);
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

  /** Turns the cuts to `rotation` (radians). */
  turnTo(rotation: number): void {
    if (this.phase.kind === 'plan') this.rotation = normalize(rotation);
  }

  /** Fine-tune buttons: −1 turns the cuts one way, +1 the other. */
  nudge(direction: 1 | -1): void {
    this.turnTo(this.rotation + direction * this.feel.fineAimStep * DEG);
  }

  // Striking and pulling

  /** Drops the head onto the log: commits the plan. */
  strike(): void {
    if (this.phase.kind !== 'plan') return;
    const plan = this.plan;
    this.#log('riving.strike', {
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

  /** The lever has been pulled down `pixels` since the pull began. */
  drag(pixels: number): void {
    if (this.phase.kind === 'press') this.phase.press.drag(pixels);
  }

  /** Leaning on the lever, −1 to 1. */
  lean(amount: number): void {
    if (this.phase.kind === 'press') this.phase.press.lean(amount);
  }

  // Time

  tick(dt: number): void {
    this.now += dt;
    const phase = this.phase;
    if (phase.kind === 'swing' && this.now - phase.at >= this.feel.strikeSeconds) {
      const plan = this.plan;
      const press = new Press(() => this.feel, {
        count: plan.count,
        checkLines: plan.checkLines,
        knotLines: plan.knotLines,
        seed: Math.floor(this.#rng.range(0, 2 ** 31)),
      });
      this.#pressStart = this.now;
      this.phase = { kind: 'press', press };
      this.#hooks.onEvent?.({ type: 'landed' });
    } else if (phase.kind === 'press') {
      const result = phase.press.tick(dt);
      if (result === 'lost') this.#loseWedge(phase.press);
      else if (result === 'through') this.#done(phase.press);
    }
  }

  /** Leaving mid-log: nothing is banked and the log isn't used up. */
  exit(): void {
    if (this.phase.kind === 'done') return;
    this.#log('riving.leave', {
      log: this.log.id,
      phase: this.phase.kind,
      head: this.count,
      seconds: Math.round(this.now * 10) / 10,
    });
  }

  /** A piece splits off badly: one still standing, picked from the seed. */
  #loseWedge(press: Press): void {
    const standing = this.plan.wedges
      .map((wedge) => wedge.index)
      .filter((index) => !this.lost.includes(index));
    if (standing.length === 0) return;
    const wedge = standing[Math.floor(this.#rng.range(0, standing.length))] ?? 0;
    this.lost.push(wedge);
    this.#log('riving.lost', {
      log: this.log.id,
      wedge,
      progress: Math.round(press.progress * 100) / 100,
    });
    this.#hooks.onEvent?.({ type: 'lost', wedge });
  }

  #done(press: Press): void {
    const plan = this.plan;
    const stars = starsFor(this.rules, plan.worth, this.best.worth);
    const share =
      stars >= 3 ? this.rules.starBonus.three : stars >= 2 ? this.rules.starBonus.two : 0;
    const bonus = worthOf(plan.worth, share);
    this.phase = { kind: 'done' };
    const banked = this.#hooks.bank(plan.worth + bonus, plan.staves);
    this.#log('riving.logEnd', {
      log: this.log.id,
      head: plan.count,
      turn: degrees(plan.rotation),
      staves: plan.staves,
      lost: this.lost.length,
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
      pressSeconds: Math.round((this.now - this.#pressStart) * 100) / 100,
      peakPressure: Math.round(press.peakPressure * 100) / 100,
      peakOffset: Math.round(press.peakOffset * 100) / 100,
    });
    this.#hooks.onEvent?.({
      type: 'done',
      plan,
      lost: [...this.lost],
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
