import { byId, type GameData } from '../data';
import { Inventory, type Stack } from './inventory';
import type { EventLogger } from './logger';
import { craft, type CraftOutcome, type CraftResult } from './recipes';
import type { GameState } from './state';
import { doWork, jobStation, workerCount, type WorkResult, type WorkState } from './workers';
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
  #done: Set<string>;
  #work: WorkState;

  constructor(data: GameData, state: GameState, logger: EventLogger) {
    this.data = data;
    this.xpCurve = new XpCurve(data.tuning.xpCurve);
    this.#logger = logger;
    this.#inventory = new Inventory(data, state.inventory);
    this.#xp = new Map(Object.entries(state.skills));
    this.#lastSeenAt = state.lastSeenAt;
    this.#done = new Set(state.done);
    this.#work = fitCrew(data, state.work, this.workers);
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

  /** Whether the player has done a one-time thing, e.g. 'tutorial.woodcutting'. */
  hasDone(key: string): boolean {
    return this.#done.has(key);
  }

  markDone(key: string): void {
    if (this.#done.has(key)) return;
    this.#done.add(key);
    this.#logger.log('game.done', { key });
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

  addItems(itemId: string, count: number): void {
    this.#inventory.add(itemId, count);
    this.#changed();
  }

  /**
   * Takes items out of the warchest (e.g. logs burned as fuel, spears spent in a run). Throws if
   * there aren't enough.
   */
  removeItems(itemId: string, count: number): void {
    this.#inventory.remove(itemId, count);
    this.#changed();
  }

  /**
   * Runs a recipe and pays its XP to the station's skill.
   * `awardXp: false` skips the XP, for mini games still in their feel-test stage.
   */
  craft(
    recipeId: string,
    outcome?: CraftOutcome,
    options: { awardXp?: boolean } = {},
  ): CraftResult {
    const recipe = byId(this.data.recipes, recipeId);
    const station = byId(this.data.stations, recipe.station);
    const result = craft(this.#inventory, recipe, outcome);
    const xp = options.awardXp === false ? 0 : result.xp;
    this.#logger.log('recipe.craft', {
      recipe: recipe.id,
      consumed: result.consumed,
      produced: result.produced,
      xp,
    });
    if (xp > 0) this.addXp(station.skill, xp);
    else this.#changed();
    return { ...result, xp };
  }

  // Workers

  /** Workers you have, from the workers' skill level. */
  get workers(): number {
    return workerCount(this.data, this.level(this.data.workers.skill));
  }

  /** Workers at `stationId`. */
  crew(stationId: string): number {
    return this.#work.crew[stationId] ?? 0;
  }

  /** Workers not at any station. */
  get freeWorkers(): number {
    const working = Object.values(this.#work.crew).reduce((sum, count) => sum + count, 0);
    return Math.max(this.workers - working, 0);
  }

  /** Moves a worker to (`+1`) or off (`-1`) a station with a job, if there's one to move. */
  assignWorker(stationId: string, change: 1 | -1): void {
    const hasJob = this.data.workers.jobs.some((job) => jobStation(this.data, job) === stationId);
    const now = this.crew(stationId);
    if (!hasJob || (change > 0 && this.freeWorkers === 0) || (change < 0 && now === 0)) return;
    this.#work.crew = { ...this.#work.crew, [stationId]: now + change };
    this.#logger.log('workers.assign', { station: stationId, crew: now + change });
    this.#changed();
  }

  /** The least of an item the workers leave in the warchest. */
  minimum(itemId: string): number {
    return this.#work.minimums[itemId] ?? 0;
  }

  setMinimum(itemId: string, count: number): void {
    byId(this.data.items, itemId);
    const next = Math.max(Math.round(count), 0);
    this.#work.minimums = { ...this.#work.minimums, [itemId]: next };
    this.#logger.log('workers.minimum', { item: itemId, count: next });
    this.#changed();
  }

  /**
   * The workers' work over `minutes` (playing and away): what they make goes on their stations'
   * piles, waiting to be collected. `away` is how much of it was time away, for the log.
   */
  work(minutes: number, away = 0): WorkResult {
    const result = doWork(this.data, this.#inventory, this.#work, minutes);
    this.#logger.log('workers.work', {
      minutes: Math.round(minutes * 100) / 100,
      away: Math.round(away * 100) / 100,
      stations: result.stations.map(({ station, workers, made, used, xp, short }) => ({
        station,
        workers,
        made,
        used,
        xp,
        ...(short && { short }),
      })),
    });
    this.#changed();
    return result;
  }

  /** What a station's workers have made and not had collected yet. */
  pile(stationId: string): readonly Stack[] {
    return this.#work.piles[stationId] ?? [];
  }

  /** XP waiting on a station's pile. */
  pileXp(stationId: string): number {
    return this.#work.xp[stationId] ?? 0;
  }

  /**
   * Collects a station's pile into the warchest and pays its XP. Returns what was collected (the
   * view pours it in).
   */
  collect(stationId: string): { items: Stack[]; xp: number } {
    const items = this.pile(stationId).filter((stack) => stack.count > 0);
    const xp = this.pileXp(stationId);
    if (items.length === 0 && xp === 0) return { items: [], xp: 0 };
    for (const stack of items) this.#inventory.add(stack.item, stack.count);
    this.#work.piles = { ...this.#work.piles, [stationId]: [] };
    this.#work.xp = { ...this.#work.xp, [stationId]: 0 };
    this.#logger.log('workers.collect', { station: stationId, items, xp });
    const station = byId(this.data.stations, stationId);
    if (xp > 0) this.addXp(station.skill, xp);
    else this.#changed();
    return { items, xp };
  }

  /** Replaces everything with `state`, e.g. after a save reset. */
  replaceState(state: GameState): void {
    this.#inventory = new Inventory(this.data, state.inventory);
    this.#xp = new Map(Object.entries(state.skills));
    this.#lastSeenAt = state.lastSeenAt;
    this.#done = new Set(state.done);
    this.#work = fitCrew(this.data, state.work, this.workers);
    this.#changed();
  }

  snapshot(): GameState {
    const inventory: Stack[] = this.#inventory.stacks();
    return {
      inventory,
      skills: Object.fromEntries(this.data.skills.map((skill) => [skill.id, this.xp(skill.id)])),
      lastSeenAt: this.#lastSeenAt,
      work: {
        crew: { ...this.#work.crew },
        carry: { ...this.#work.carry },
        minimums: { ...this.#work.minimums },
        piles: Object.fromEntries(
          Object.entries(this.#work.piles).map(([station, pile]) => [
            station,
            pile.map((stack) => ({ ...stack })),
          ]),
        ),
        xp: { ...this.#work.xp },
      },
      done: [...this.#done],
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

/**
 * A saved crew fitted to the data: stations without a job have no workers, and if there are more
 * workers out than you have (e.g. after a data change), the last jobs give theirs back first.
 */
function fitCrew(data: GameData, work: WorkState, workers: number): WorkState {
  const crew: Record<string, number> = {};
  let left = workers;
  for (const job of data.workers.jobs) {
    const station = jobStation(data, job);
    const count = Math.min(work.crew[station] ?? 0, left);
    crew[station] = count;
    left -= count;
  }
  return {
    crew,
    carry: { ...work.carry },
    minimums: { ...work.minimums },
    piles: Object.fromEntries(
      Object.entries(work.piles).map(([station, pile]) => [
        station,
        pile.map((stack) => ({ ...stack })),
      ]),
    ),
    xp: { ...work.xp },
  };
}
