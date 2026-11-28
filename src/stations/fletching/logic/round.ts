import { starBonus, type EventLogger, type Stack } from '../../../core';
import type { Fletching, FletchingFeel } from '../../../data';

/** The three kinds of arrow the bench makes. */
export type ArrowMade = 'fletched' | 'duster' | 'bare';

/** How the tar went: too little (the feathers slide off), in the green band, or too much (globs). */
export type TarState = 'thin' | 'good' | 'thick';

/** How an arrow was made: feathers tapped on, shoved in the bucket, or none at all. */
export type FletchWay = 'careful' | 'bucket' | 'bare';

/** A feather slapped on as the shaft turned. */
export interface FeatherTap {
  /** Round time of the tap. */
  at: number;
  /** Where it went round the shaft (degrees, the shaft's own: its marks are at 0, 120, 240 …). */
  angle: number;
  /** The mark it went to (the nearest one still bare), and how far off it was. */
  mark: number;
  /** Off its mark: degrees, and ms (+ late: the mark had passed the top; − early). */
  offDegrees: number;
  offMs: number;
  onMark: boolean;
}

/** The arrow on the bench right now. */
export interface ArrowInHand {
  /** Its number in the round, from 0. */
  index: number;
  /**
   * Waiting to be dipped, in the tar, in the jig with feathers going on, or made (off to the
   * chest while the next shaft comes).
   */
  step: 'shaft' | 'dip' | 'feathers' | 'made';
  /** Round time it came onto the bench, went into the tar, came out, and was made. */
  readyAt: number;
  dipAt: number | undefined;
  liftAt: number | undefined;
  madeAt: number | undefined;
  /** The tar level it came out with (0 to 1), and what that was. */
  tar: number | undefined;
  tarState: TarState | undefined;
  taps: FeatherTap[];
  way: FletchWay | undefined;
  made: ArrowMade | undefined;
  /** Feathers it used up, and of those how many slid off (too little tar). */
  feathers: number;
  lost: number;
}

export type FletchingEndReason = 'time' | 'out';

/** How a round went. */
export interface FletchingResult {
  /** Arrows made, by kind. */
  made: Record<ArrowMade, number>;
  arrows: number;
  stars: number;
  /** Fletched arrows the stars added. */
  bonus: number;
  xp: number;
  /** Feathers used up, and of those how many slid off (too little tar). */
  feathers: number;
  lost: number;
  /** Staves split into shafts this round, and shafts used. */
  staves: number;
  shafts: number;
  /** Arrows made the careful way and in the bucket. */
  bucket: number;
  careful: number;
  seconds: number;
  reason: FletchingEndReason;
}

/** Things a view plays effects for. */
export type FletchingEvent =
  | { type: 'ready'; arrow: ArrowInHand }
  | { type: 'dip'; arrow: ArrowInHand }
  | { type: 'lift'; arrow: ArrowInHand }
  | { type: 'tap'; arrow: ArrowInHand; tap: FeatherTap }
  | { type: 'made'; arrow: ArrowInHand; item: string; xp: number }
  | ({ type: 'end' } & FletchingResult);

export interface FletchingHooks {
  logger: EventLogger;
  /** The Fletching level, for the logs. */
  level: number;
  /** How many of an item are in the warchest. */
  count: (item: string) => number;
  /** Takes items out of the warchest. */
  spend: (item: string, count: number) => void;
  /** Banks items (an arrow made, a spare shaft, the stars' bonus) with their XP, as it happens. */
  bank: (items: Stack[], xp: number) => void;
  onEvent?: (event: FletchingEvent) => void;
}

/** An angle wrapped to (-180, 180]. */
export function wrapDegrees(angle: number): number {
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** What a tar level is, against the green band. */
export function tarState(level: number, feel: Pick<FletchingFeel, 'tarLow' | 'tarHigh'>): TarState {
  if (level < feel.tarLow) return 'thin';
  return level > feel.tarHigh ? 'thick' : 'good';
}

/** The tar level after `seconds` in the pot: rising `tarFill` a second, at most a full coat. */
export function tarLevel(seconds: number, feel: Pick<FletchingFeel, 'tarFill'>): number {
  return Math.min(Math.max(seconds, 0) * feel.tarFill, 1);
}

/**
 * How far the shaft has turned (degrees) `seconds` after it went in the jig: it starts so its
 * first mark (at 0°) reaches the top `leadSeconds` in, and turns `turnSpeed` a second.
 */
export function turnAt(
  seconds: number,
  feel: Pick<FletchingFeel, 'turnSpeed' | 'leadSeconds'>,
): number {
  return feel.turnSpeed * (seconds - feel.leadSeconds);
}

/** Where mark `index` of `marks` is round the shaft (degrees, the shaft's own). */
export function markAngle(index: number, marks: number): number {
  return (360 / marks) * index;
}

/** Stars from fletched arrows made: 3, 2 and 1 from the data's counts, else none. */
export function starsFor(rules: Fletching['stars'], fletched: number): number {
  if (fletched >= rules.three) return 3;
  if (fletched >= rules.two) return 2;
  return fletched >= rules.one ? 1 : 0;
}

/**
 * What a careful arrow comes out as: too little tar and its feathers slide off (bare); too much
 * and it globs, or any feather off its mark and it's lopsided (a duster); else fletched.
 */
export function carefulResult(
  tar: TarState,
  taps: readonly Pick<FeatherTap, 'onMark'>[],
): ArrowMade {
  if (tar === 'thin') return 'bare';
  if (tar === 'thick') return 'duster';
  return taps.every((tap) => tap.onMark) ? 'fletched' : 'duster';
}

/**
 * One round at the fletcher's bench, without any rendering: an arrow at a time, from the
 * warchest's shafts (and staves, split as they're needed) and feathers. A view feeds it the
 * player's dips, lifts, taps, the bucket and the bare button, and time, and draws it. The same
 * inputs at the same times play out the same.
 */
export class FletchingRound {
  readonly rules: Fletching;
  /** The feel, fixed for the round (sliders apply from the next one). */
  readonly feel: FletchingFeel;
  phase: 'make' | 'done' = 'make';
  /** Seconds into the round. */
  now = 0;
  /** The arrow on the bench (none once the round's done or there's nothing left to make one). */
  arrow: ArrowInHand | undefined;
  readonly arrows: ArrowInHand[] = [];
  result: FletchingResult | undefined;
  readonly #hooks: FletchingHooks;
  #made: Record<ArrowMade, number> = { fletched: 0, duster: 0, bare: 0 };
  #xp = 0;
  #feathers = 0;
  #lost = 0;
  #staves = 0;
  #shafts = 0;

  constructor(rules: Fletching, feel: FletchingFeel, hooks: FletchingHooks) {
    this.rules = rules;
    this.feel = { ...feel };
    this.#hooks = hooks;
    hooks.logger.log('fletching.roundStart', {
      level: hooks.level,
      seconds: rules.round.seconds,
      shafts: hooks.count(rules.shaft),
      staves: hooks.count(rules.stave),
      feathers: hooks.count(rules.feather),
      feel: this.feel,
    });
    this.#nextArrow();
  }

  /** Seconds left in the round. */
  get left(): number {
    return Math.max(this.rules.round.seconds - this.now, 0);
  }

  /** Arrows of each kind made so far. */
  get made(): Readonly<Record<ArrowMade, number>> {
    return this.#made;
  }

  /** Shafts there are still to make arrows from: in the warchest, and in the staves there. */
  get shaftsLeft(): number {
    const { rules } = this;
    return this.#hooks.count(rules.shaft) + this.#hooks.count(rules.stave) * rules.shaftsPerStave;
  }

  /** Feathers in the warchest. */
  get feathersLeft(): number {
    return this.#hooks.count(this.rules.feather);
  }

  /** Whether there are the feathers for careful fletching, and for the bucket. */
  get canFletch(): boolean {
    return this.feathersLeft >= this.rules.feathers.careful;
  }

  get canBucket(): boolean {
    return this.feathersLeft >= this.rules.feathers.bucket;
  }

  /** The tar on the arrow in hand right now (0 to 1): rising while it's in the pot. */
  get tar(): number {
    const arrow = this.arrow;
    if (!arrow) return 0;
    if (arrow.step === 'dip' && arrow.dipAt !== undefined) {
      return tarLevel(this.now - arrow.dipAt, this.feel);
    }
    return arrow.tar ?? 0;
  }

  /** How far the shaft in the jig has turned (degrees), or 0 when it isn't in the jig. */
  get turn(): number {
    const arrow = this.arrow;
    if (arrow?.step !== 'feathers' || arrow.liftAt === undefined) return 0;
    return turnAt(this.now - arrow.liftAt, this.feel);
  }

  /** Puts the shaft's back end in the tar pot. */
  dip(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow?.step !== 'shaft') return false;
    arrow.step = 'dip';
    arrow.dipAt = this.now;
    this.#hooks.onEvent?.({ type: 'dip', arrow });
    return true;
  }

  /** Lifts it out of the tar with the level it's reached, into the jig for its feathers. */
  lift(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow?.step !== 'dip') return false;
    const tar = this.tar;
    arrow.tar = tar;
    arrow.tarState = tarState(tar, this.feel);
    arrow.step = 'feathers';
    arrow.liftAt = this.now;
    this.#hooks.onEvent?.({ type: 'lift', arrow });
    return true;
  }

  /**
   * Slaps a feather on at the top of the turning shaft, onto the nearest mark still bare (true if
   * it went on). The last one finishes the arrow. Needs the feathers for a careful arrow.
   */
  tap(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow?.step !== 'feathers' || !this.canFletch) return false;
    const { marks } = this.rules;
    // The top, in the shaft's own angles.
    const angle = wrapDegrees(-this.turn);
    let best = { mark: -1, off: Infinity };
    for (let mark = 0; mark < marks; mark++) {
      if (arrow.taps.some((tap) => tap.mark === mark)) continue;
      // Where the mark is from the top: past it (+) or still to come (−).
      const off = wrapDegrees(markAngle(mark, marks) - angle);
      if (Math.abs(off) < Math.abs(best.off)) best = { mark, off };
    }
    const offMs = (best.off / this.feel.turnSpeed) * 1000;
    const tap: FeatherTap = {
      at: this.now,
      angle,
      mark: best.mark,
      offDegrees: best.off,
      offMs,
      onMark: Math.abs(offMs) <= this.feel.markWindowMs,
    };
    arrow.taps.push(tap);
    this.#hooks.onEvent?.({ type: 'tap', arrow, tap });
    if (arrow.taps.length >= marks) {
      const tar = arrow.tarState ?? 'thin';
      const made = carefulResult(tar, arrow.taps);
      this.#finish(arrow, 'careful', made, this.rules.feathers.careful, made === 'bare');
    }
    return true;
  }

  /** Shoves the tarred shaft in the feather bucket: a duster, at once, for the bucket's feathers. */
  bucket(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow?.step !== 'feathers' || !this.canBucket) return false;
    // Any feathers tapped on already are in among the bucket's.
    this.#finish(arrow, 'bucket', 'duster', this.rules.feathers.bucket, false);
    return true;
  }

  /** Skips the feathers: a bare arrow, before the tar or after it. */
  bare(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || (arrow?.step !== 'shaft' && arrow?.step !== 'feathers')) {
      return false;
    }
    this.#finish(arrow, 'bare', 'bare', 0, false);
    return true;
  }

  /** Runs the round on by `dt` seconds. */
  tick(dt: number): void {
    if (this.phase !== 'make') return;
    this.now += Math.max(dt, 0);
    const arrow = this.arrow;
    if (
      arrow?.step === 'made' &&
      arrow.madeAt !== undefined &&
      this.now - arrow.madeAt >= this.feel.finishSeconds - 1e-9
    ) {
      this.#nextArrow();
    }
    // (Running out of shafts just now ended it.)
    if (!this.result && this.now >= this.rules.round.seconds - 1e-9) this.#end('time');
  }

  /** Leaving mid-round: the arrow in hand goes back as a shaft; what's been made stays. */
  exit(): void {
    if (this.phase === 'done') return;
    this.#hooks.logger.log('fletching.leave', {
      seconds: round2(this.now),
      arrows: this.arrows.filter((arrow) => arrow.made).length,
      fletched: this.#made.fletched,
    });
    this.#putBack();
    this.phase = 'done';
  }

  /** The next shaft onto the bench: a spare one, or a stave split into shafts. Else it's over. */
  #nextArrow(): void {
    const { rules } = this;
    const hooks = this.#hooks;
    if (hooks.count(rules.shaft) < 1) {
      if (hooks.count(rules.stave) < 1) {
        this.arrow = undefined;
        this.#end('out');
        return;
      }
      hooks.spend(rules.stave, 1);
      hooks.bank([{ item: rules.shaft, count: rules.shaftsPerStave }], 0);
      this.#staves += 1;
    }
    hooks.spend(rules.shaft, 1);
    this.#shafts += 1;
    const arrow: ArrowInHand = {
      index: this.arrows.length,
      step: 'shaft',
      readyAt: this.now,
      dipAt: undefined,
      liftAt: undefined,
      madeAt: undefined,
      tar: undefined,
      tarState: undefined,
      taps: [],
      way: undefined,
      made: undefined,
      feathers: 0,
      lost: 0,
    };
    this.arrow = arrow;
    this.arrows.push(arrow);
    hooks.onEvent?.({ type: 'ready', arrow });
  }

  #finish(arrow: ArrowInHand, way: FletchWay, made: ArrowMade, feathers: number, lost: boolean) {
    const { rules } = this;
    arrow.step = 'made';
    arrow.madeAt = this.now;
    arrow.way = way;
    arrow.made = made;
    arrow.feathers = feathers;
    arrow.lost = lost ? feathers : 0;
    if (feathers > 0) this.#hooks.spend(rules.feather, feathers);
    this.#feathers += feathers;
    this.#lost += arrow.lost;
    this.#made[made] += 1;
    const kind = rules.arrows[made];
    this.#xp += kind.xp;
    this.#hooks.bank([{ item: kind.item, count: 1 }], kind.xp);
    this.#logArrow(arrow);
    this.#hooks.onEvent?.({ type: 'made', arrow, item: kind.item, xp: kind.xp });
  }

  /** The arrow in hand, unfinished, goes back to the warchest as a shaft (no feathers used yet). */
  #putBack(): void {
    const arrow = this.arrow;
    if (!arrow || arrow.step === 'made') return;
    this.arrows.pop();
    this.#shafts -= 1;
    this.#hooks.bank([{ item: this.rules.shaft, count: 1 }], 0);
    this.arrow = undefined;
  }

  #end(reason: FletchingEndReason): void {
    this.#putBack();
    this.arrow = undefined;
    this.phase = 'done';
    const { rules } = this;
    const fletched = this.#made.fletched;
    const stars = starsFor(rules.stars, fletched);
    const bonus = starBonus(fletched, stars, rules.starBonus);
    if (bonus > 0) this.#hooks.bank([{ item: rules.arrows.fletched.item, count: bonus }], 0);
    const made = this.arrows.filter((arrow) => arrow.made);
    const result: FletchingResult = {
      made: { ...this.#made },
      arrows: made.length,
      stars,
      bonus,
      xp: this.#xp,
      feathers: this.#feathers,
      lost: this.#lost,
      staves: this.#staves,
      shafts: this.#shafts,
      bucket: made.filter((arrow) => arrow.way === 'bucket').length,
      careful: made.filter((arrow) => arrow.way === 'careful').length,
      seconds: this.now,
      reason,
    };
    this.result = result;
    this.#hooks.logger.log('fletching.roundEnd', {
      level: this.#hooks.level,
      ...result,
      seconds: round2(this.now),
      shaftsLeft: this.shaftsLeft,
      feathersLeft: this.feathersLeft,
    });
    this.#hooks.onEvent?.({ type: 'end', ...result });
  }

  /** One log line per arrow: its tar, its taps, which way it was made, and what came of it. */
  #logArrow(arrow: ArrowInHand): void {
    this.#hooks.logger.log('fletching.arrow', {
      arrow: arrow.index,
      at: round2(arrow.readyAt),
      way: arrow.way ?? null,
      made: arrow.made ?? null,
      tar: arrow.tar === undefined ? null : round2(arrow.tar),
      tarState: arrow.tarState ?? null,
      // Seconds in the tar.
      dip:
        arrow.dipAt !== undefined && arrow.liftAt !== undefined
          ? round2(arrow.liftAt - arrow.dipAt)
          : null,
      // How far off each feather was (ms: + late, − early) and whether it was on its mark.
      taps: arrow.taps.map((tap) => ({
        mark: tap.mark,
        ms: Math.round(tap.offMs),
        onMark: tap.onMark,
      })),
      feathers: arrow.feathers,
      lost: arrow.lost,
      // Seconds from the shaft's being ready to the arrow's being made.
      seconds: arrow.madeAt === undefined ? null : round2(arrow.madeAt - arrow.readyAt),
    });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
