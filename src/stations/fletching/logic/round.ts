import { starBonus, type EventLogger, type Stack } from '../../../core';
import type { Fletching, FletchingFeel } from '../../../data';

/** The three kinds of arrow the bench makes. */
export type ArrowMade = 'fletched' | 'duster' | 'bare';

/** How the tar went: too little (the feathers slide off), in the green band, or too much (globs). */
export type TarState = 'thin' | 'good' | 'thick';

/** How a batch was made: feathers tapped on, shoved in the bucket, or none at all. */
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

/**
 * The one shaft on the bench, standing for the whole batch: waiting to be dipped, in the tar, in
 * the jig with feathers going on, or made (off to the chest).
 */
export interface ArrowInHand {
  step: 'shaft' | 'dip' | 'feathers' | 'made';
  /** Round time it went into the tar, came out, and was made. */
  dipAt: number | undefined;
  liftAt: number | undefined;
  madeAt: number | undefined;
  /** The tar level it came out with (0 to 1), and what that was. */
  tar: number | undefined;
  tarState: TarState | undefined;
  taps: FeatherTap[];
  way: FletchWay | undefined;
  made: ArrowMade | undefined;
}

/** A batch as picked: its size on the picker, the streak's multiplier, and the arrows that makes. */
export interface Batch {
  size: number;
  streak: number;
  arrows: number;
}

/** How a round went. */
export interface FletchingResult {
  way: FletchWay;
  made: ArrowMade;
  /** Arrows made (all of the one kind), and the fletched arrows the stars added. */
  arrows: number;
  bonus: number;
  stars: number;
  xp: number;
  /** Staves used, feathers used, and of those how many slid off (too little tar). */
  staves: number;
  feathers: number;
  lost: number;
  /** The batch as picked, and the streak's multiplier for the next round. */
  batch: Batch;
  streakAfter: number;
  seconds: number;
}

/** Things a view plays effects for. */
export type FletchingEvent =
  | { type: 'dip'; arrow: ArrowInHand }
  | { type: 'lift'; arrow: ArrowInHand }
  | { type: 'tap'; arrow: ArrowInHand; tap: FeatherTap }
  | { type: 'made'; arrow: ArrowInHand; result: FletchingResult; item: string }
  | ({ type: 'end' } & FletchingResult);

export interface FletchingHooks {
  logger: EventLogger;
  /** The Fletching level: how big a batch the bench takes. */
  level: number;
  /** How many of an item are in the warchest. */
  count: (item: string) => number;
  /** Takes items out of the warchest. */
  spend: (item: string, count: number) => void;
  /** Banks items (the batch, the stars' bonus) with their XP. */
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

/**
 * What a careful batch comes out as: too little tar and its feathers slide off (bare); too much
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
 * Stars from the round's beats. A fletched batch is 3. A careful one that came near (the tar
 * within `nearTar` of the band, every feather within `nearTapMs` of its mark, or its window if
 * that's wider) is 2; any other is 1. The bucket and bare are their fixed stars, never 3, so the
 * shortcuts don't build a streak.
 */
export function starsFor(
  rules: Pick<Fletching, 'stars'>,
  feel: Pick<FletchingFeel, 'tarLow' | 'tarHigh' | 'markWindowMs'>,
  beats: {
    way: FletchWay;
    made: ArrowMade;
    tar: number;
    taps: readonly Pick<FeatherTap, 'offMs'>[];
  },
): number {
  const { stars } = rules;
  if (beats.way === 'bucket') return Math.min(stars.bucket, 2);
  if (beats.way === 'bare') return Math.min(stars.bare, 2);
  if (beats.made === 'fletched') return 3;
  const tarNear =
    beats.tar >= feel.tarLow - stars.nearTar && beats.tar <= feel.tarHigh + stars.nearTar;
  const window = Math.max(stars.nearTapMs, feel.markWindowMs);
  const tapsNear = beats.taps.every((tap) => Math.abs(tap.offMs) <= window);
  return tarNear && tapsNear ? 2 : 1;
}

/**
 * The hot streak after a round: 3 stars raises the multiplier a step (up to `cap`); anything less
 * drops it a step, never below 1 (Brandon, Nov 28: a miss no longer starts again from 1).
 */
export function nextStreak(streak: number, stars: number, cap: number): number {
  const top = Math.max(Math.floor(cap), 1);
  const now = Math.min(Math.max(Math.floor(streak), 1), top);
  return stars >= 3 ? Math.min(now + 1, top) : Math.max(now - 1, 1);
}

/** The biggest batch the bench takes at `level` (before the streak), from the data's sizes. */
export function benchSize(rules: Pick<Fletching, 'batch'>, level: number): number {
  let size = 1;
  for (const entry of rules.batch.sizes)
    if (entry.level <= level) size = Math.max(size, entry.arrows);
  return size;
}

/** The next bench size to open above `level`, if any. */
export function nextBenchSize(
  rules: Pick<Fletching, 'batch'>,
  level: number,
): { arrows: number; level: number } | undefined {
  return rules.batch.sizes.find((entry) => entry.level > level);
}

/** Staves a batch of `arrows` takes: 1 for every `arrowsPerStave`, rounded up. */
export function stavesFor(rules: Pick<Fletching, 'arrowsPerStave'>, arrows: number): number {
  return Math.ceil(Math.max(arrows, 0) / rules.arrowsPerStave);
}

/**
 * The most arrows the warchest's staves and feathers allow in one batch: as many as the staves
 * make and the feathers fletch carefully. With too few feathers for even one careful arrow, it's
 * what the staves make, as bare arrows only (`bareOnly`).
 */
export function arrowsAllowed(
  rules: Pick<Fletching, 'arrowsPerStave' | 'feathers'>,
  staves: number,
  feathers: number,
): { arrows: number; bareOnly: boolean } {
  const byStaves = Math.max(Math.floor(staves), 0) * rules.arrowsPerStave;
  const byFeathers = Math.floor(Math.max(feathers, 0) / rules.feathers.careful);
  if (byFeathers < 1) return { arrows: byStaves, bareOnly: true };
  return { arrows: Math.min(byStaves, byFeathers), bareOnly: false };
}

/**
 * The picker's sizes, from 1 to the bench's size at `level`, each with the arrows it makes at
 * this `streak` (at most what the warchest allows). A size is open only if it makes more than the
 * one below it, so the picker never goes past what the staves and feathers allow.
 */
export function pickerSizes(
  rules: Pick<Fletching, 'batch' | 'arrowsPerStave' | 'feathers'>,
  level: number,
  streak: number,
  staves: number,
  feathers: number,
): Batch[] {
  const { arrows: allowed } = arrowsAllowed(rules, staves, feathers);
  if (allowed < 1) return [];
  const sizes: Batch[] = [];
  for (let size = 1; size <= benchSize(rules, level); size++) {
    if (size > 1 && (size - 1) * streak >= allowed) break;
    sizes.push({ size, streak, arrows: Math.min(size * streak, allowed) });
  }
  return sizes;
}

/**
 * One round at the fletcher's bench, without any rendering: one arrow's beats, made into a whole
 * batch. The batch is picked before it starts (`size` on the picker, times the hot streak), within
 * the bench's size and the warchest's staves and feathers. A view feeds it the player's dip, lift,
 * taps, the bucket or the bare button, and time, and draws it. The same inputs at the same times
 * play out the same.
 */
export class FletchingRound {
  readonly rules: Fletching;
  /** The feel, fixed for the round (sliders apply from the next one). */
  readonly feel: FletchingFeel;
  readonly batch: Batch;
  /** With too few feathers to fletch even one arrow, the batch can only be bare. */
  readonly bareOnly: boolean;
  phase: 'make' | 'done' = 'make';
  /** Seconds into the round. */
  now = 0;
  /** The one shaft shown: the whole batch's beats. */
  readonly arrow: ArrowInHand = {
    step: 'shaft',
    dipAt: undefined,
    liftAt: undefined,
    madeAt: undefined,
    tar: undefined,
    tarState: undefined,
    taps: [],
    way: undefined,
    made: undefined,
  };
  result: FletchingResult | undefined;
  readonly #hooks: FletchingHooks;

  constructor(
    rules: Fletching,
    feel: FletchingFeel,
    hooks: FletchingHooks,
    pick: { size: number; streak: number },
  ) {
    this.rules = rules;
    this.feel = { ...feel };
    this.#hooks = hooks;
    const staves = hooks.count(rules.stave);
    const feathers = hooks.count(rules.feather);
    const streak = Math.min(Math.max(Math.floor(pick.streak), 1), Math.max(this.feel.streakCap, 1));
    const sizes = pickerSizes(rules, hooks.level, streak, staves, feathers);
    const size = Math.min(Math.max(Math.floor(pick.size), 1), Math.max(sizes.length, 1));
    this.batch = sizes[size - 1] ?? { size: 1, streak, arrows: 0 };
    this.bareOnly = arrowsAllowed(rules, staves, feathers).bareOnly;
    hooks.logger.log('fletching.roundStart', {
      level: hooks.level,
      size: this.batch.size,
      streak: this.batch.streak,
      arrows: this.batch.arrows,
      bench: benchSize(rules, hooks.level),
      staves,
      feathers,
      bareOnly: this.bareOnly,
      feel: this.feel,
    });
  }

  /** Feathers in the warchest. */
  get feathersLeft(): number {
    return this.#hooks.count(this.rules.feather);
  }

  /** Feathers the batch takes the careful way, and in the bucket. */
  get carefulFeathers(): number {
    return this.rules.feathers.careful * this.batch.arrows;
  }

  get bucketFeathers(): number {
    return this.rules.feathers.bucket * this.batch.arrows;
  }

  /** Whether there are the feathers to fletch the batch carefully, and for the bucket. */
  get canFletch(): boolean {
    return this.batch.arrows > 0 && this.feathersLeft >= this.carefulFeathers;
  }

  get canBucket(): boolean {
    return this.batch.arrows > 0 && this.feathersLeft >= this.bucketFeathers;
  }

  /** The tar on the shaft right now (0 to 1): rising while it's in the pot. */
  get tar(): number {
    const arrow = this.arrow;
    if (arrow.step === 'dip' && arrow.dipAt !== undefined) {
      return tarLevel(this.now - arrow.dipAt, this.feel);
    }
    return arrow.tar ?? 0;
  }

  /** How far the shaft in the jig has turned (degrees), or 0 when it isn't in the jig. */
  get turn(): number {
    const arrow = this.arrow;
    if (arrow.step !== 'feathers' || arrow.liftAt === undefined) return 0;
    return turnAt(this.now - arrow.liftAt, this.feel);
  }

  /** Whether the round's under way (the shaft's been dipped): the picker's closed from then on. */
  get begun(): boolean {
    return this.arrow.step !== 'shaft';
  }

  /** Puts the shaft's back end in the tar pot. Not when the batch can only be bare. */
  dip(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow.step !== 'shaft' || this.bareOnly) return false;
    if (this.batch.arrows < 1) return false;
    arrow.step = 'dip';
    arrow.dipAt = this.now;
    this.#hooks.onEvent?.({ type: 'dip', arrow });
    return true;
  }

  /** Lifts it out of the tar with the level it's reached, into the jig for its feathers. */
  lift(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow.step !== 'dip') return false;
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
   * it went on). The last one finishes the batch. Needs the feathers for the batch done carefully.
   */
  tap(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow.step !== 'feathers' || !this.canFletch) return false;
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
      this.#finish('careful', carefulResult(arrow.tarState ?? 'thin', arrow.taps));
    }
    return true;
  }

  /** Shoves the tarred shaft in the feather bucket: the batch all dusters, at once. */
  bucket(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || arrow.step !== 'feathers' || !this.canBucket) return false;
    // Any feathers tapped on already are in among the bucket's.
    this.#finish('bucket', 'duster');
    return true;
  }

  /** Skips the feathers: the batch all bare, before the tar or after it. */
  bare(): boolean {
    const arrow = this.arrow;
    if (this.phase !== 'make' || (arrow.step !== 'shaft' && arrow.step !== 'feathers')) {
      return false;
    }
    if (this.batch.arrows < 1) return false;
    this.#finish('bare', 'bare');
    return true;
  }

  /** Runs the round on by `dt` seconds: once the batch is made, it ends after its beat. */
  tick(dt: number): void {
    if (this.phase !== 'make') return;
    this.now += Math.max(dt, 0);
    const arrow = this.arrow;
    const result = this.result;
    if (
      result &&
      arrow.madeAt !== undefined &&
      this.now - arrow.madeAt >= this.feel.finishSeconds - 1e-9
    ) {
      this.phase = 'done';
      this.#hooks.onEvent?.({ type: 'end', ...result });
    }
  }

  /** Leaving: before the batch is made, nothing's been used; after, it's all banked already. */
  exit(): void {
    if (this.phase === 'done') return;
    if (!this.result) {
      this.#hooks.logger.log('fletching.leave', {
        seconds: round2(this.now),
        step: this.arrow.step,
        arrows: this.batch.arrows,
      });
    }
    this.phase = 'done';
  }

  /** The batch is made: staves and feathers used, the arrows, any bonus and XP banked, logged. */
  #finish(way: FletchWay, made: ArrowMade): void {
    const { rules, arrow, batch } = this;
    const hooks = this.#hooks;
    arrow.step = 'made';
    arrow.madeAt = this.now;
    arrow.way = way;
    arrow.made = made;
    const arrows = batch.arrows;
    const staves = stavesFor(rules, arrows);
    const feathers = way === 'bare' ? 0 : rules.feathers[way] * arrows;
    // Too little tar: the careful way's feathers slid off.
    const lost = way === 'careful' && made === 'bare' ? feathers : 0;
    hooks.spend(rules.stave, staves);
    if (feathers > 0) hooks.spend(rules.feather, feathers);
    const stars = starsFor(rules, this.feel, { way, made, tar: arrow.tar ?? 0, taps: arrow.taps });
    const bonus = made === 'fletched' ? starBonus(arrows, stars, rules.starBonus) : 0;
    const kind = rules.arrows[made];
    const xp = kind.xp * arrows;
    const items: Stack[] = [{ item: kind.item, count: arrows }];
    if (bonus > 0) items.push({ item: rules.arrows.fletched.item, count: bonus });
    hooks.bank(items, xp);
    const result: FletchingResult = {
      way,
      made,
      arrows,
      bonus,
      stars,
      xp,
      staves,
      feathers,
      lost,
      batch: { ...batch },
      streakAfter: nextStreak(batch.streak, stars, this.feel.streakCap),
      seconds: this.now,
    };
    this.result = result;
    hooks.logger.log('fletching.roundEnd', {
      level: hooks.level,
      way,
      made,
      size: batch.size,
      streak: batch.streak,
      streakAfter: result.streakAfter,
      arrows,
      bonus,
      stars,
      xp,
      staves,
      feathers,
      lost,
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
      seconds: round2(this.now),
      stavesLeft: hooks.count(rules.stave),
      feathersLeft: hooks.count(rules.feather),
    });
    hooks.onEvent?.({ type: 'made', arrow, result, item: kind.item });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
