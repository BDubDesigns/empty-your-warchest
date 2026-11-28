/** What a station can turn the top-left button into while it's open. */
export type BackOverride = { label: string; onTap: () => void } | 'hidden';

const DEFAULT_LABEL = 'Back to camp';

/**
 * The shell's top-left button: Back to camp everywhere but the camp. A station can turn it into
 * its own action for a while (woodcutting's End round) or hide it (while its own summary shows).
 */
export class BackButton {
  readonly #element: HTMLElement;
  readonly #back: () => void;
  #shown = false;
  #override: BackOverride | undefined;

  constructor(element: HTMLElement, back: () => void) {
    this.#element = element;
    this.#back = back;
    element.addEventListener('click', () => {
      this.press();
    });
    this.#render();
  }

  /** What a tap does (and what the phone's back does): the override's action, else Back to camp. */
  press(): void {
    const override = this.#override;
    if (override === undefined) this.#back();
    else if (override !== 'hidden') override.onTap();
  }

  /** Whether a station has turned the button into its own action (woodcutting's End round). */
  get hasAction(): boolean {
    return this.#override !== undefined && this.#override !== 'hidden';
  }

  /** Shown outside the camp (navigation decides). */
  setShown(shown: boolean): void {
    this.#shown = shown;
    this.#render();
  }

  /** Changes what the button does; `undefined` puts Back to camp back. */
  set(override: BackOverride | undefined): void {
    this.#override = override;
    this.#render();
  }

  #render(): void {
    const override = this.#override;
    this.#element.hidden = !this.#shown || override === 'hidden';
    this.#element.textContent =
      override === undefined || override === 'hidden' ? DEFAULT_LABEL : override.label;
  }
}
