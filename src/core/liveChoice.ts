import type { KeyValueStore } from './storage';

/** One option of a choice, with the name the debug menu shows. */
export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** What the debug menu needs from a choice, whatever its options are. */
export interface Choice<T extends string = string> {
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T;
  /** A line under the buttons, if the choice has more to say (what Auto picked, say). */
  readonly detail?: string;
  set(value: T): void;
  onChange(listener: (value: T) => void): () => void;
}

/**
 * A pick between a few named options, kept on this device (e.g. the woodcutting tree style). The
 * debug menu shows every choice as buttons; whatever uses it listens for changes.
 */
export class LiveChoice<T extends string> implements Choice<T> {
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly #key: string;
  readonly #fallback: T;
  readonly #store: KeyValueStore;
  readonly #listeners = new Set<(value: T) => void>();
  #picked: T | undefined;

  constructor(
    key: string,
    label: string,
    options: readonly ChoiceOption<T>[],
    fallback: T,
    store: KeyValueStore,
  ) {
    this.#key = key;
    this.label = label;
    this.options = options;
    this.#fallback = fallback;
    this.#store = store;
    this.#picked = this.#load();
  }

  get value(): T {
    return this.#picked ?? this.#fallback;
  }

  /** Something picked a value (the player, or code deciding for good), so it's not the default. */
  get picked(): boolean {
    return this.#picked !== undefined;
  }

  set(value: T): void {
    if (!this.options.some((option) => option.value === value)) {
      throw new Error(`Unknown option "${value}" for ${this.label}`);
    }
    const changed = value !== this.value;
    this.#picked = value;
    try {
      this.#store.set(this.#key, value);
    } catch {
      // Not saved; it still applies until the page reloads.
    }
    if (changed) for (const listener of this.#listeners) listener(value);
  }

  onChange(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #load(): T | undefined {
    let saved: string | null = null;
    try {
      saved = this.#store.get(this.#key);
    } catch {
      // No storage: use the default.
    }
    return this.options.find((option) => option.value === saved)?.value;
  }
}
