import type { RivingFeel } from '../../../data';

/** What a pull of the handle did: a stroke drove the head in, or the last one drove it through. */
export type PumpResult = 'stroke' | 'through';

/**
 * Pumping the handle to drive the splitting head through the log, like a jack: each full swipe
 * down is one stroke and drives the head one notch in, and the last stroke bursts the log. The
 * handle has to come back up (halfway, or by lifting the finger) before the next stroke. Nothing
 * can go wrong: the pump is the payoff for the plan.
 */
export class Pump {
  /** Strokes it takes to go through. */
  readonly strokes: number;
  /** Strokes done so far. */
  done = 0;
  /** Where the handle is in its stroke: 0 up, 1 all the way down. */
  handle = 0;
  through = false;
  readonly #feel: () => RivingFeel;
  #armed = true;
  /** Where the finger has the handle at the top (pixels down from where it went down). */
  #top = 0;

  /** A `count`-way head, among heads making `fewest` to `most` pieces: more pieces, more strokes. */
  constructor(feel: () => RivingFeel, count: number, fewest: number, most: number) {
    this.#feel = feel;
    const { pumpsFew, pumpsMany } = feel();
    const share = most > fewest ? (count - fewest) / (most - fewest) : 0;
    this.strokes = Math.round(pumpsFew + Math.min(Math.max(share, 0), 1) * (pumpsMany - pumpsFew));
  }

  /** How far the head has gone through the log, 0–1. */
  get progress(): number {
    return this.done / this.strokes;
  }

  /**
   * The finger is `pixels` down from where it went down. The handle follows it between its stops:
   * past either one, the finger carries the stroke with it, so it never has to reach back.
   */
  pull(pixels: number): PumpResult | undefined {
    if (this.through) return undefined;
    const travel = this.#feel().pumpTravel;
    this.#top = Math.min(Math.max(this.#top, pixels - travel), pixels);
    this.handle = (pixels - this.#top) / travel;
    if (!this.#armed) {
      if (this.handle <= 0.5) this.#armed = true;
      return undefined;
    }
    if (this.handle < 1) return undefined;
    this.#armed = false;
    this.done += 1;
    if (this.done < this.strokes) return 'stroke';
    this.through = true;
    return 'through';
  }

  /** The finger lifted: the handle springs back up, ready for the next stroke. */
  release(): void {
    this.handle = 0;
    this.#armed = true;
    this.#top = 0;
  }
}
