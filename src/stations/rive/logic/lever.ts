import { Rng } from '../../../core';
import type { RivingFeel } from '../../../data';

/** How a lever ended: clean, or run out to the thin side or (over-leaned) to the thick side. */
export type LeverResult = 'clean' | 'thin' | 'thick';

/** What a split is like to lever, from where it was aimed. */
export interface LeverSetup {
  /** 0 (even) to 1 (a sliver): how hard the crack pulls to the thin side. */
  unevenness: number;
  /** The piece's width (degrees): narrow pieces wobble. */
  width: number;
  onCheck: boolean;
  throughKnot: boolean;
  /** Seeds the wobble, so a round replays. */
  seed: number;
  /** Where the crack had got to, if this lever carries on an earlier one. */
  from?: number;
}

/**
 * Levering a split open after the strike: dragging down runs the crack down the log, and the crack
 * drifts toward the thin side (harder the more uneven the split and the faster you go; narrow
 * pieces and knots wobble it either way). A bubble shows the drift, from −1 (thick side) to +1 (thin
 * side): lean against it with a sideways drag. At either edge it runs out.
 */
export class Lever {
  /** How far down the log the crack has run, 0–1. */
  progress: number;
  /** The bubble: −1 (run out to the thick side) … 0 (straight) … +1 (run out to the thin side). */
  offset = 0;
  result: LeverResult | undefined;
  /** For the logs: the fastest the crack ran and the furthest the bubble got. */
  peakSpeed = 0;
  peakOffset = 0;
  /** Seconds levered. */
  seconds = 0;
  readonly #feel: () => RivingFeel;
  readonly #setup: LeverSetup;
  readonly #rng: Rng;
  #target: number;
  #lean = 0;
  #samples: { t: number; progress: number }[] = [];
  #wander = 0;
  #wanderUntil = 0;

  constructor(feel: () => RivingFeel, setup: LeverSetup) {
    this.#feel = feel;
    this.#setup = setup;
    this.#rng = new Rng(setup.seed);
    this.progress = setup.from ?? 0;
    this.#target = this.progress;
  }

  /** The handle has been pulled down `pixels` since this lever started: the crack follows. */
  drag(pixels: number): void {
    if (this.result) return;
    const target = (this.#setup.from ?? 0) + Math.max(pixels, 0) / this.#feel().leverTravel;
    this.#target = Math.max(this.#target, Math.min(target, 1));
  }

  /** Leaning, −1 to 1: pushes the bubble that way (toward the thin side is positive). */
  lean(amount: number): void {
    this.#lean = Math.max(-1, Math.min(1, amount));
  }

  /** How fast the crack is running, in log lengths per second (averaged over the speed window). */
  get speed(): number {
    const window = this.#feel().speedWindow;
    const now = this.seconds;
    const old = this.#samples.find((sample) => sample.t >= now - window) ?? this.#samples[0];
    if (!old || now - old.t <= 0) return 0;
    return (this.progress - old.progress) / (now - old.t);
  }

  /** How hard the crack pulls toward the thin side right now (bubble widths per second). */
  get pull(): number {
    const feel = this.#feel();
    const { unevenness, onCheck, throughKnot } = this.#setup;
    return (
      unevenness *
      feel.pullPerUnevenness *
      (1 + this.speed * feel.speedPull) *
      (onCheck ? feel.checkEase : 1) *
      (throughKnot ? feel.knotPull : 1)
    );
  }

  /** How much the crack wanders either way (bubble widths per second, at most). */
  get wobble(): number {
    const feel = this.#feel();
    const { width, onCheck, throughKnot } = this.#setup;
    const thinness = Math.max(feel.wobbleFrom / Math.max(width, 1) - 1, 0);
    return (
      (thinness * feel.wobblePerThinness + (throughKnot ? feel.knotJitter : 0)) *
      (onCheck ? feel.checkEase : 1)
    );
  }

  tick(dt: number): LeverResult | undefined {
    if (this.result || dt <= 0) return this.result;
    const feel = this.#feel();
    this.seconds += dt;
    const moving = this.#target > this.progress;
    this.progress = this.#target;
    this.#samples.push({ t: this.seconds, progress: this.progress });
    while (
      this.#samples.length > 2 &&
      (this.#samples[1]?.t ?? 0) < this.seconds - feel.speedWindow
    ) {
      this.#samples.shift();
    }
    this.peakSpeed = Math.max(this.peakSpeed, this.speed);
    if (this.seconds >= this.#wanderUntil) {
      this.#wander = this.#rng.range(-1, 1);
      this.#wanderUntil = this.seconds + feel.wobbleSeconds;
    }
    // The crack only drifts while it's running; holding still holds it.
    const drift = moving || this.speed > 0 ? this.pull + this.#wander * this.wobble : 0;
    this.offset += (drift + this.#lean * feel.leanRate) * dt;
    this.peakOffset = Math.max(this.peakOffset, Math.abs(this.offset));
    if (this.offset >= 1) return this.#end('thin');
    if (this.offset <= -1) return this.#end('thick');
    if (this.progress >= 1) return this.#end('clean');
    return undefined;
  }

  #end(result: LeverResult): LeverResult {
    this.result = result;
    return result;
  }
}
