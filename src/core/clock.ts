/** Where the game reads the current time, so tests can control it. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock that only moves when told to. For tests. */
export class ManualClock implements Clock {
  #time: number;

  constructor(time = 0) {
    this.#time = time;
  }

  now(): number {
    return this.#time;
  }

  advance(ms: number): void {
    this.#time += ms;
  }
}
