/** Synchronous key/value storage, so saves can be swapped out in tests. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function localStorageStore(): KeyValueStore {
  return {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => {
      localStorage.setItem(key, value);
    },
    remove: (key) => {
      localStorage.removeItem(key);
    },
  };
}

export class MemoryStore implements KeyValueStore {
  readonly #values = new Map<string, string>();

  get(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.#values.set(key, value);
  }

  remove(key: string): void {
    this.#values.delete(key);
  }
}
