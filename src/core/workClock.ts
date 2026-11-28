import type { Game } from './game';
import type { WorkResult } from './workers';

const MINUTE = 60_000;

/** A stretch of the workers' work, banked: what they did, and how much of it was time away. */
export interface BankedWork {
  result: WorkResult;
  /** Minutes away that counted (each stretch away capped at the data's `awayCapMinutes`). */
  away: number;
  /** Minutes really away, before the cap. */
  awayReal: number;
}

/**
 * Keeps the workers' time: time playing always counts, time away counts up to the cap. It's only
 * banked when asked (at the camp), so the workers never use the log on the block or the staves on
 * the rack mid-round. `lastSeenAt` is kept fresh while the game is open, so a crash or a closed tab
 * doesn't count time spent playing as time away.
 */
export class WorkClock {
  readonly #game: Game;
  #playing = 0;
  #away = 0;
  #awayReal = 0;
  #lastTick: number;
  readonly #listeners = new Set<() => void>();

  /** Starts the clock at `now`, owing the time away since the save's `lastSeenAt`. */
  constructor(game: Game, now: number) {
    this.#game = game;
    this.#lastTick = now;
    this.#cameBack(now);
  }

  /** Minutes owed so far, playing and away. */
  get owed(): number {
    return this.#playing + this.#away;
  }

  /**
   * Minutes owed at `now`, counting the playing time since the last tick, without ticking (which
   * saves): what the farm adds to its banked clock to show its crops growing live.
   */
  owedAt(now: number): number {
    return this.owed + Math.max(now - this.#lastTick, 0) / MINUTE;
  }

  /** Counts time playing up to `now`. Call every so often while the game is open. */
  tick(now: number): void {
    this.#playing += Math.max(now - this.#lastTick, 0) / MINUTE;
    this.#lastTick = now;
    this.#game.lastSeenAt = now;
  }

  /** The game went into the background: playing time stops counting here. */
  hidden(now: number): void {
    this.tick(now);
  }

  /** Back from the background: the time away counts, up to the cap. */
  visible(now: number): void {
    this.#cameBack(now);
  }

  /** Debug: as if away for another `ms`. */
  skip(ms: number): void {
    this.#addAway(ms / MINUTE);
    for (const listener of this.#listeners) listener();
  }

  /** Calls `listener` when time is skipped, so it can be banked at once. */
  onSkip(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Banks everything owed up to `now` into the warchest. Undefined if nothing is owed. */
  bank(now: number): BankedWork | undefined {
    this.tick(now);
    const minutes = this.owed;
    if (minutes <= 0) return undefined;
    const banked = {
      result: this.#game.work(minutes, this.#away),
      away: this.#away,
      awayReal: this.#awayReal,
    };
    this.#playing = this.#away = this.#awayReal = 0;
    return banked;
  }

  #cameBack(now: number): void {
    this.#addAway(Math.max(now - this.#game.lastSeenAt, 0) / MINUTE);
    this.#lastTick = now;
    this.#game.lastSeenAt = now;
  }

  #addAway(minutes: number): void {
    this.#awayReal += minutes;
    this.#away += Math.min(minutes, this.#game.data.workers.awayCapMinutes);
  }
}
