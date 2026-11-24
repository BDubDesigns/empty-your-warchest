import type { RivingFeel } from '../../../data';

export type LeverResult = 'clean' | 'runout' | 'bound';

/**
 * Levering a split open after the strike: the handle's drag runs the crack down the log. Keep the
 * crack's speed in the steady band. Faster builds strain (less along a check) and enough of it
 * runs out; slower for too long and the crack binds, so the froe has to be struck again. A knot
 * on the line runs out when the crack reaches it.
 */
export class Lever {
  /** How far down the log the crack has run, 0–1. */
  progress: number;
  /** 0–1: at 1 the split runs out. */
  strain = 0;
  result: LeverResult | undefined;
  /** For the logs: the fastest the crack ran and the most strain it took. */
  peakSpeed = 0;
  peakStrain = 0;
  /** Seconds levered. */
  seconds = 0;
  readonly #feel: () => RivingFeel;
  readonly #onCheck: boolean;
  /** Where (0–1 down the log) a knot on the line runs it out, if there is one. */
  readonly #knotAt: number | undefined;
  readonly #from: number;
  #target: number;
  #samples: { t: number; progress: number }[] = [];
  #slowFor = 0;

  constructor(
    feel: () => RivingFeel,
    options: { onCheck: boolean; knotAt?: number; from?: number },
  ) {
    this.#feel = feel;
    this.#onCheck = options.onCheck;
    this.#knotAt = options.knotAt;
    this.#from = options.from ?? 0;
    this.progress = this.#from;
    this.#target = this.#from;
  }

  /** The handle has been pulled `pixels` since this lever started: the crack follows it down. */
  drag(pixels: number): void {
    if (this.result) return;
    const target = this.#from + Math.max(pixels, 0) / this.#feel().leverTravel;
    this.#target = Math.max(this.#target, Math.min(target, 1));
  }

  /** How fast the crack is running, in log lengths per second (averaged over the speed window). */
  get speed(): number {
    const window = this.#feel().speedWindow;
    const now = this.seconds;
    const old = this.#samples.find((sample) => sample.t >= now - window) ?? this.#samples[0];
    if (!old || now - old.t <= 0) return 0;
    return (this.progress - old.progress) / (now - old.t);
  }

  /** Whether the crack is running faster than the steady band right now. */
  get straining(): boolean {
    return this.speed > this.#feel().bandHigh;
  }

  tick(dt: number): LeverResult | undefined {
    if (this.result || dt <= 0) return this.result;
    const feel = this.#feel();
    this.seconds += dt;
    this.progress = this.#target;
    this.#samples.push({ t: this.seconds, progress: this.progress });
    while (
      this.#samples.length > 2 &&
      (this.#samples[1]?.t ?? 0) < this.seconds - feel.speedWindow
    ) {
      this.#samples.shift();
    }
    const speed = this.speed;
    this.peakSpeed = Math.max(this.peakSpeed, speed);
    const over = speed - feel.bandHigh;
    this.strain =
      over > 0
        ? this.strain + over * feel.strainRise * (this.#onCheck ? feel.checkEase : 1) * dt
        : Math.max(this.strain - feel.strainRecover * dt, 0);
    this.peakStrain = Math.max(this.peakStrain, Math.min(this.strain, 1));
    if (this.#knotAt !== undefined && this.progress >= this.#knotAt) return this.#end('runout');
    if (this.strain >= 1) return this.#end('runout');
    if (this.progress >= 1) return this.#end('clean');
    // Too slow once started: the crack binds.
    if (this.progress > this.#from && speed < feel.bandLow) this.#slowFor += dt;
    else this.#slowFor = 0;
    if (this.#slowFor >= feel.bindSeconds) return this.#end('bound');
    return undefined;
  }

  #end(result: LeverResult): LeverResult {
    this.result = result;
    return result;
  }
}
