import type { Tuning } from '../data';

/** XP thresholds per level, built from the curve constants in data. */
export class XpCurve {
  readonly maxLevel: number;
  /** thresholds[level] = total XP needed to reach that level. Index 0 is unused. */
  readonly #thresholds: number[];

  constructor(params: Tuning['xpCurve']) {
    this.maxLevel = params.maxLevel;
    this.#thresholds = [0, 0];
    let points = 0;
    for (let level = 2; level <= params.maxLevel; level++) {
      const n = level - 1;
      points += Math.floor(n + params.base * 2 ** (n / params.doublingLevels));
      this.#thresholds.push(Math.floor(points / params.divisor));
    }
  }

  /** Total XP needed to reach `level`. */
  xpForLevel(level: number): number {
    if (!Number.isInteger(level) || level < 1 || level > this.maxLevel) {
      throw new RangeError(`Level must be a whole number from 1 to ${this.maxLevel}, got ${level}`);
    }
    return this.#thresholds[level] as number;
  }

  /** The level reached with `xp` total XP. */
  levelForXp(xp: number): number {
    let level = 1;
    while (level < this.maxLevel && xp >= (this.#thresholds[level + 1] as number)) level++;
    return level;
  }
}
