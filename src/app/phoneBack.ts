/** The part of `window.history` the phone's back handling uses. */
export interface HistoryLike {
  pushState(state: unknown, unused: string): void;
  back(): void;
}

/**
 * Makes the phone's (or browser's) back button act like Back to camp. One history entry is pushed
 * while the player is away from the camp, so back lands on the same page and fires `popstate`
 * instead of leaving the game. At the camp there is no entry, so back does what it always did.
 *
 * The invariant: an entry exists exactly while away from the camp. When back pops it, it's pushed
 * again at once, and only goes for good when the player really leaves (the shell then pops it).
 */
export class PhoneBack {
  readonly #history: HistoryLike;
  readonly #onBack: () => void;
  #entry = false;
  /** Pops the shell asked for itself, whose `popstate` isn't the player pressing back. */
  #own = 0;

  constructor(history: HistoryLike, onBack: () => void) {
    this.#history = history;
    this.#onBack = onBack;
  }

  /** Whether our entry is in the history now. */
  get entry(): boolean {
    return this.#entry;
  }

  /** The player is now away from the camp (or back at it). */
  follow(away: boolean): void {
    if (away && !this.#entry) {
      this.#history.pushState({ warchest: 'away' }, '');
      this.#entry = true;
    } else if (!away && this.#entry) {
      this.#entry = false;
      this.#own += 1;
      this.#history.back();
    }
  }

  /** `popstate`: the phone's back, unless it's one of our own pops. */
  popped(away: boolean): void {
    if (this.#own > 0) {
      this.#own -= 1;
      return;
    }
    if (!away) return;
    // The back popped our entry: put it back, then let the shell decide whether to leave.
    this.#history.pushState({ warchest: 'away' }, '');
    this.#onBack();
  }
}
