import { Rng } from '../../../core';
import type { RivingFeel } from '../../../data';

/** What happened on a tick of the pull: a piece was lost, or the head went through. */
export type PressResult = 'lost' | 'through';

/** What a pull is like, from the head and how it's turned. */
export interface PressSetup {
  /** Pieces the head makes: more wander harder. */
  count: number;
  /** Lines along a check (calming) and through a knot (shaking). */
  checkLines: number;
  knotLines: number;
  /** Seeds the wander, so a round replays. */
  seed: number;
}

/**
 * Pulling the lever down to drive the splitting head through the log. Dragging ahead of the head
 * builds pressure: more pressure drives it faster but makes the bubble wander more (and every
 * head wanders more the more pieces it makes; lines through knots shake it, lines along checks
 * calm it). Lean against the bubble with a sideways drag. Each time it reaches an edge a piece
 * splits off badly and is lost, and the bubble starts again from the middle. The pull carries on
 * until the head is through.
 */
export class Press {
  /** How far the head has gone through the log, 0–1. */
  progress = 0;
  /** 0–1: how far the lever is pulled ahead of the head (full at `pressureAt`). */
  pressure = 0;
  /** The bubble: −1 … 0 (steady) … +1. At either edge a piece is lost. */
  offset = 0;
  /** Pieces lost so far. */
  losses = 0;
  through = false;
  /** For the logs: the most pressure and the furthest the bubble got. */
  peakPressure = 0;
  peakOffset = 0;
  /** Seconds pulled. */
  seconds = 0;
  readonly #feel: () => RivingFeel;
  readonly #setup: PressSetup;
  readonly #rng: Rng;
  #target = 0;
  #lean = 0;
  #wander = 0;
  #wanderUntil = 0;

  constructor(feel: () => RivingFeel, setup: PressSetup) {
    this.#feel = feel;
    this.#setup = setup;
    this.#rng = new Rng(setup.seed);
  }

  /** The lever has been pulled down `pixels` since the pull began. */
  drag(pixels: number): void {
    if (this.through) return;
    const target = Math.max(pixels, 0) / this.#feel().leverTravel;
    this.#target = Math.max(this.#target, Math.min(target, 1));
  }

  /** Leaning, −1 to 1: pushes the bubble that way. */
  lean(amount: number): void {
    this.#lean = Math.max(-1, Math.min(1, amount));
  }

  /** How much the bubble wanders either way right now (bubble widths per second, at most). */
  get wobble(): number {
    const feel = this.#feel();
    const { count, checkLines, knotLines } = this.#setup;
    const base =
      feel.wobble +
      Math.max(count - feel.wobbleFrom, 0) * feel.wobblePerStave +
      knotLines * feel.knotJitter;
    const calm = 1 - (checkLines / Math.max(count, 1)) * (1 - feel.checkEase);
    return base * calm * (1 + this.pressure * feel.pressurePull);
  }

  tick(dt: number): PressResult | undefined {
    if (this.through || dt <= 0) return undefined;
    const feel = this.#feel();
    this.seconds += dt;
    const lead = Math.max(this.#target - this.progress, 0);
    this.pressure = Math.min(lead / feel.pressureAt, 1);
    this.peakPressure = Math.max(this.peakPressure, this.pressure);
    const moving = lead > 1e-9;
    // Gentle pressure drives it through in `slowDriveSeconds`, full pressure in `driveSeconds`.
    const rate =
      1 / feel.slowDriveSeconds +
      this.pressure * (1 / feel.driveSeconds - 1 / feel.slowDriveSeconds);
    if (moving) this.progress = Math.min(this.progress + rate * dt, this.#target);
    if (this.seconds >= this.#wanderUntil) {
      this.#wander = this.#rng.range(-1, 1);
      this.#wanderUntil = this.seconds + feel.wobbleSeconds;
    }
    // The bubble only wanders while the head is moving; easing off holds it.
    const drift = moving ? this.#wander * this.wobble : 0;
    this.offset += (drift + this.#lean * feel.leanRate) * dt;
    this.peakOffset = Math.max(this.peakOffset, Math.abs(this.offset));
    if (Math.abs(this.offset) >= 1) {
      this.losses += 1;
      this.offset = 0;
      return 'lost';
    }
    if (this.progress >= 1 - 1e-9) {
      this.through = true;
      return 'through';
    }
    return undefined;
  }
}
