import type { Screen } from './screen';

/**
 * Shows one screen at a time. Switches run in order, so rapid taps can't
 * leave two screens visible or skip a mount.
 */
export class ScreenSwitcher<Id extends string> {
  readonly #screens: Readonly<Record<Id, Screen>>;
  readonly #onChange: ((id: Id) => void) | undefined;
  readonly #mounted = new Set<Id>();
  #current: Id | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(screens: Readonly<Record<Id, Screen>>, onChange?: (id: Id) => void) {
    this.#screens = screens;
    this.#onChange = onChange;
  }

  get current(): Id | undefined {
    return this.#current;
  }

  /** Whether the screen has been shown before (so showing it again needs no loading). */
  isMounted(id: Id): boolean {
    return this.#mounted.has(id);
  }

  show(id: Id): Promise<void> {
    const next = this.#queue.then(() => this.#switchTo(id));
    // A failed switch must not block later ones; the caller still sees the error.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #switchTo(id: Id): Promise<void> {
    if (id === this.#current) return;
    const next = this.#screens[id];
    if (!this.#mounted.has(id)) {
      await next.mount();
      this.#mounted.add(id);
    }
    // Leave the old screen only once the new one is ready, so nothing goes blank while loading.
    if (this.#current !== undefined) this.#screens[this.#current].leave();
    next.enter();
    this.#current = id;
    this.#onChange?.(id);
  }
}
