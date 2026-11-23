import type { Game } from '../../core';
import { generateClearing, tutorialPlan, type ClearingPlan } from './logic/generate';
import { woodcuttingSkill } from './logic/unlocks';

/** The one-time flag for having played the woodcutting tutorial clearing. */
export const WOODCUTTING_TUTORIAL = 'tutorial.woodcutting';

/** What the next round should play instead of the usual pick; set from the debug menu. */
export type ClearingRequest = { kind: 'seed'; seed: number } | { kind: 'tutorial' };

/**
 * Decides each round's clearing: the hand-made tutorial the first time ever, then a new random
 * one every round. The debug menu can ask for a given seed (to replay a layout) or the tutorial.
 */
export class ClearingPicker {
  readonly #game: Game;
  readonly #newSeed: () => number;
  readonly #listeners = new Set<() => void>();
  #request: ClearingRequest | undefined;
  #current: ClearingPlan | undefined;

  constructor(game: Game, newSeed: () => number = () => (Math.random() * 2 ** 32) >>> 0) {
    this.#game = game;
    this.#newSeed = newSeed;
  }

  /** The clearing being played (or played last), if any. */
  get current(): ClearingPlan | undefined {
    return this.#current;
  }

  get request(): ClearingRequest | undefined {
    return this.#request;
  }

  /** Plays this next round instead (once). */
  requestNext(request: ClearingRequest): void {
    this.#request = request;
    this.#changed();
  }

  /** The clearing for a new round. */
  next(): ClearingPlan {
    const woodcutting = this.#game.data.woodcutting;
    const request = this.#request;
    this.#request = undefined;
    const tutorial =
      request?.kind === 'tutorial' ||
      (request === undefined && !this.#game.hasDone(WOODCUTTING_TUTORIAL));
    this.#current = tutorial
      ? tutorialPlan(woodcutting)
      : generateClearing(
          woodcutting,
          request?.kind === 'seed' ? request.seed : this.#newSeed(),
          this.#game.level(woodcuttingSkill(this.#game.data)),
        );
    this.#changed();
    return this.#current;
  }

  /** The round is over: once the tutorial has been played, rounds are random from then on. */
  finished(): void {
    if (this.#current?.tutorial) this.#game.markDone(WOODCUTTING_TUTORIAL);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
