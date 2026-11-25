import { z } from 'zod';
import type { GameData } from '../data';
import type { Clock } from './clock';
import { Inventory } from './inventory';
import { newGameState, type GameState } from './state';
import type { KeyValueStore } from './storage';

/**
 * Bump when GameState's shape changes. There is no save migration before launch:
 * a save from another version, or one that no longer fits the data, is discarded.
 */
export const SAVE_VERSION = 1;
const SAVE_KEY = 'warchest.save';

const saveFileSchema = z.object({
  version: z.number(),
  savedAt: z.number(),
  state: z.object({
    // A stack's old quality tier (removed in M5-0) is dropped on load, so tiers merge.
    inventory: z.array(z.object({ item: z.string(), count: z.number().int().positive() })),
    skills: z.record(z.string(), z.number().nonnegative()),
    lastSeenAt: z.number(),
    // Added after version 1 with a default, so earlier saves still load.
    done: z.array(z.string()).default([]),
  }),
});

export type LoadResult =
  | { status: 'new'; state: GameState }
  | { status: 'loaded'; state: GameState }
  | { status: 'discarded'; state: GameState; reason: string };

/** One save slot. */
export class SaveStore {
  readonly #store: KeyValueStore;
  readonly #data: GameData;
  readonly #clock: Clock;

  constructor(store: KeyValueStore, data: GameData, clock: Clock) {
    this.#store = store;
    this.#data = data;
    this.#clock = clock;
  }

  load(): LoadResult {
    const raw = this.#store.get(SAVE_KEY);
    if (raw === null) return { status: 'new', state: this.#fresh() };
    try {
      return { status: 'loaded', state: this.#parse(raw) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { status: 'discarded', state: this.#fresh(), reason };
    }
  }

  save(state: GameState): void {
    const file = { version: SAVE_VERSION, savedAt: this.#clock.now(), state };
    this.#store.set(SAVE_KEY, JSON.stringify(file));
  }

  /** Deletes the save and returns a fresh state. */
  reset(): GameState {
    this.#store.remove(SAVE_KEY);
    return this.#fresh();
  }

  #fresh(): GameState {
    return newGameState(this.#data, this.#clock.now());
  }

  #parse(raw: string): GameState {
    const file = saveFileSchema.parse(JSON.parse(raw));
    if (file.version !== SAVE_VERSION) {
      throw new Error(`Save is version ${file.version}; this build uses ${SAVE_VERSION}`);
    }
    // Throws on items that no longer exist in the data.
    const inventory = new Inventory(this.#data, file.state.inventory).stacks();

    const saved = Object.keys(file.state.skills).sort().join(',');
    const current = this.#data.skills
      .map((skill) => skill.id)
      .sort()
      .join(',');
    if (saved !== current) throw new Error(`Save has skills [${saved}]; the data has [${current}]`);

    return {
      inventory,
      skills: file.state.skills,
      lastSeenAt: file.state.lastSeenAt,
      done: [...new Set(file.state.done)],
    };
  }
}
