import { byId, type GameData } from '../data';
import { Inventory, type Stack } from './inventory';
import type { EventLogger } from './logger';
import { craft, type CraftOutcome, type CraftResult } from './recipes';
import type { GameState } from './state';
import { XpCurve } from './xp';

/** The running game: warchest, skills and recipes, driven by the data. */
export class Game {
  readonly data: GameData;
  readonly xpCurve: XpCurve;
  readonly #logger: EventLogger;
  readonly #listeners = new Set<() => void>();
  #inventory: Inventory;
  #xp: Map<string, number>;
  #lastSeenAt: number;

  constructor(data: GameData, state: GameState, logger: EventLogger) {
    this.data = data;
    this.xpCurve = new XpCurve(data.tuning.xpCurve);
    this.#logger = logger;
    this.#inventory = new Inventory(data, state.inventory);
    this.#xp = new Map(Object.entries(state.skills));
    this.#lastSeenAt = state.lastSeenAt;
  }

  get inventory(): Inventory {
    return this.#inventory;
  }

  get lastSeenAt(): number {
    return this.#lastSeenAt;
  }

  set lastSeenAt(time: number) {
    this.#lastSeenAt = time;
    this.#changed();
  }

  xp(skillId: string): number {
    byId(this.data.skills, skillId);
    return this.#xp.get(skillId) ?? 0;
  }

  level(skillId: string): number {
    return this.xpCurve.levelForXp(this.xp(skillId));
  }

  addXp(skillId: string, amount: number): void {
    if (amount < 0) throw new RangeError(`XP can't go down, got ${amount}`);
    const before = this.level(skillId);
    this.#xp.set(skillId, this.xp(skillId) + amount);
    const after = this.level(skillId);
    if (after > before) this.#logger.log('skill.levelUp', { skill: skillId, level: after });
    this.#changed();
  }

  /** Sets a skill to exactly the start of a level. For the debug menu. */
  setLevel(skillId: string, level: number): void {
    byId(this.data.skills, skillId);
    this.#xp.set(skillId, this.xpCurve.xpForLevel(level));
    this.#changed();
  }

  addItems(itemId: string, count: number, quality?: string): void {
    this.#inventory.add(itemId, count, quality);
    this.#changed();
  }

  /** Runs a recipe and pays its XP to the station's skill. */
  craft(recipeId: string, outcome?: CraftOutcome): CraftResult {
    const recipe = byId(this.data.recipes, recipeId);
    const station = byId(this.data.stations, recipe.station);
    const result = craft(this.#inventory, recipe, outcome);
    this.#logger.log('recipe.craft', {
      recipe: recipe.id,
      consumed: result.consumed,
      produced: result.produced,
      xp: result.xp,
    });
    this.addXp(station.skill, result.xp);
    return result;
  }

  /** Replaces everything with `state`, e.g. after a save reset. */
  replaceState(state: GameState): void {
    this.#inventory = new Inventory(this.data, state.inventory);
    this.#xp = new Map(Object.entries(state.skills));
    this.#lastSeenAt = state.lastSeenAt;
    this.#changed();
  }

  snapshot(): GameState {
    const inventory: Stack[] = this.#inventory.stacks();
    return {
      inventory,
      skills: Object.fromEntries(this.data.skills.map((skill) => [skill.id, this.xp(skill.id)])),
      lastSeenAt: this.#lastSeenAt,
    };
  }

  /** Calls `listener` after every change. Returns a function that unsubscribes. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
