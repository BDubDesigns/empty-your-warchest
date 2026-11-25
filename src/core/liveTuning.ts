import type { KeyValueStore } from './storage';

/** One number the debug menu can change live, with its slider range. */
export interface Tunable {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Juice and timing rather than how it plays: folded under "More" in the debug menu. */
  more?: boolean;
}

type Overrides<T> = Partial<Record<keyof T, number>>;

/**
 * Numbers from data that can be overridden live on the phone (debug menu sliders).
 * Overrides are kept on this device until reset; the data stays the source of truth.
 */
export class LiveTuning<T extends Record<string, number>> {
  readonly name: string;
  readonly defaults: Readonly<T>;
  readonly tunables: readonly Tunable[];
  readonly #store: KeyValueStore;
  readonly #listeners = new Set<() => void>();
  #overrides: Overrides<T>;

  constructor(name: string, defaults: T, tunables: readonly Tunable[], store: KeyValueStore) {
    this.name = name;
    this.defaults = defaults;
    this.tunables = tunables;
    this.#store = store;
    this.#overrides = this.#load();
  }

  get values(): T {
    return { ...this.defaults, ...this.#overrides };
  }

  isOverridden(key: keyof T): boolean {
    return key in this.#overrides;
  }

  set(key: keyof T & string, value: number): void {
    if (!(key in this.defaults)) throw new Error(`Unknown tuning "${key}" in ${this.name}`);
    const others = Object.entries(this.#overrides).filter(([other]) => other !== key);
    const next = value === this.defaults[key] ? others : [...others, [key, value]];
    this.#overrides = Object.fromEntries(next) as Overrides<T>;
    this.#save();
  }

  reset(): void {
    this.#overrides = {};
    this.#save();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get #key(): string {
    return `warchest.tuning.${this.name}`;
  }

  #load(): Overrides<T> {
    try {
      const saved = JSON.parse(this.#store.get(this.#key) ?? '{}') as Record<string, unknown>;
      // Debug-only data: keep the numbers that still match a known key, drop the rest.
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([key, value]) =>
            key in this.defaults && typeof value === 'number' && Number.isFinite(value),
        ),
      ) as Overrides<T>;
    } catch {
      return {};
    }
  }

  #save(): void {
    if (Object.keys(this.#overrides).length === 0) this.#store.remove(this.#key);
    else this.#store.set(this.#key, JSON.stringify(this.#overrides));
    for (const listener of this.#listeners) listener();
  }
}
