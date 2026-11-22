/** Hashes a string seed into a 32-bit number (FNV-1a). */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Seeded random numbers (mulberry32). The same seed always gives the same
 * sequence, so clearings and runs can be replayed. All game randomness goes through this.
 */
export class Rng {
  #state: number;

  constructor(seed: number | string) {
    this.#state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  }

  /** Current internal state; `new Rng(rng.state)` continues the same sequence. */
  get state(): number {
    return this.#state;
  }

  /** A float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    return items[this.int(0, items.length - 1)] as T;
  }
}
