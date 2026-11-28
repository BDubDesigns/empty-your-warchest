/** The card the guard shows: what leaving would lose, and Keep playing / Leave. */
export interface LeavePrompt {
  /** Shows the card, saying `cost`; `answer(true)` is Leave, `answer(false)` is Keep playing. */
  show(cost: string, answer: (leave: boolean) => void): void;
  hide(): void;
}

export interface LeaveGuardDeps {
  /** What leaving the screen now would lose; `undefined` when nothing (leave at once). */
  cost(): string | undefined;
  /** Where the player is, for the log: the station id, or "warchest". */
  where(): string;
  prompt: LeavePrompt;
  /** Goes back to the camp. */
  leave(): void;
  log(type: string, data: Record<string, unknown>): void;
}

/**
 * Stands between "Back to camp" (the top-left button, or the phone's back) and leaving. When the
 * screen says leaving would lose something, the player is asked first; otherwise it leaves at once.
 */
export class LeaveGuard {
  readonly #deps: LeaveGuardDeps;
  #cost: string | undefined;

  constructor(deps: LeaveGuardDeps) {
    this.#deps = deps;
  }

  /** Whether the card is up. */
  get asking(): boolean {
    return this.#cost !== undefined;
  }

  /** Back to camp asked for: leaves, or asks first if that would lose something. */
  request(): void {
    if (this.asking) return;
    const cost = this.#deps.cost();
    if (cost === undefined) {
      this.#deps.leave();
      return;
    }
    this.#cost = cost;
    this.#deps.prompt.show(cost, (leave) => {
      this.#answer(leave);
    });
  }

  /**
   * The phone's back: as Back to camp, except with the card up it counts as Keep playing (the
   * way back closes a dialog). Logged either way.
   */
  phoneBack(): void {
    this.#deps.log('app.backButton', { station: this.#deps.where(), asking: this.asking });
    if (this.asking) this.#answer(false);
    else this.request();
  }

  /** The screen changed under the card (the round ended, or the player left another way). */
  dismiss(): void {
    if (!this.asking) return;
    this.#cost = undefined;
    this.#deps.prompt.hide();
  }

  #answer(leave: boolean): void {
    const cost = this.#cost;
    if (cost === undefined) return;
    this.#cost = undefined;
    this.#deps.prompt.hide();
    this.#deps.log('app.leaveAsk', { station: this.#deps.where(), lost: cost, confirmed: leave });
    if (leave) this.#deps.leave();
  }
}

/** "1 spear", "12 spears". */
export function countOf(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}
