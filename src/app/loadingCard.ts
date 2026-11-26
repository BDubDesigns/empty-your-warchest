/** Something to show while waiting, and take away after. */
export interface Notice {
  show(): void;
  hide(): void;
}

/**
 * Waits for `work`, showing `notice` only if it takes longer than `delayMs` (so a quick load never
 * flashes it), and hiding it once the work is done or has failed. Resolves to whether it showed.
 */
export async function noticeIfSlow(
  work: Promise<void>,
  delayMs: number,
  notice: Notice,
): Promise<boolean> {
  const state = { shown: false };
  const timer = setTimeout(() => {
    state.shown = true;
    notice.show();
  }, delayMs);
  try {
    await work;
  } finally {
    clearTimeout(timer);
    if (state.shown) notice.hide();
  }
  return state.shown;
}

/**
 * A small card over the camp while a station's screen loads: a spinner and where you're going.
 * Its backdrop takes taps, so the camp can't start a second station meanwhile.
 */
export class LoadingCard implements Notice {
  readonly #overlay: HTMLElement;
  readonly #text: HTMLElement;

  constructor(parent: HTMLElement) {
    this.#overlay = document.createElement('div');
    this.#overlay.className = 'loading-overlay';
    this.#overlay.hidden = true;
    const card = document.createElement('div');
    card.className = 'loading-card';
    card.setAttribute('role', 'status');
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    this.#text = document.createElement('div');
    this.#text.className = 'loading-text';
    card.append(spinner, this.#text);
    this.#overlay.append(card);
    parent.append(this.#overlay);
  }

  /** Sets what the card says the next time it shows. */
  setText(text: string): void {
    this.#text.textContent = text;
  }

  show(): void {
    this.#overlay.hidden = false;
  }

  hide(): void {
    this.#overlay.hidden = true;
  }
}
