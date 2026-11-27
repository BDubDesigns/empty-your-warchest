import { starBonus, type EventLogger } from '../../../core';
import type { Firemaking, FiremakingFeel } from '../../../data';
import {
  bestPull,
  doneness,
  finishOf,
  fullRackAnswers,
  hardenAt,
  heatWith,
  type BestPull,
  type Finish,
  type Fire,
  type FireRules,
  type Rack,
} from './fire';

export type FiremakingPhase =
  /** Dropping logs into the fuel spots. */
  | { kind: 'plan' }
  /** The rack is on the fire, laid at round time `at`. */
  | { kind: 'cook'; at: number }
  /** Off the fire after `seconds` on it: the staves stay as they came out. */
  | { kind: 'done'; seconds: number };

/** How a rack came out. */
export interface RackResult {
  /** Each stave on the rack (layer by layer), as it came out. */
  finishes: Finish[];
  hardened: number;
  under: number;
  charred: number;
  /** The rack's fuel spots. */
  spots: number;
  /** Stars, from the bottom layer (the ones above cook just the same), and their bonus spears. */
  stars: number;
  bonus: number;
  /** Seconds the rack was on the fire, and the best moment there was. */
  seconds: number;
  best: BestPull;
  /** Left on until every stave charred. */
  burnt: boolean;
  /** Spears that went into the warchest. */
  banked: number;
}

/** Things a view plays effects for. */
export type FiremakingEvent =
  | { type: 'fuel'; spot: number; logs: number }
  | { type: 'lay' }
  | ({ type: 'pulled' } & RackResult);

export interface FiremakingHooks {
  logger: EventLogger;
  /** Read every time while planning, so live tuning applies at once. */
  feel: () => FiremakingFeel;
  rules: Firemaking;
  /** Fuel logs in the warchest: the spots can't hold more than this between them. */
  logsAvailable: number;
  /** Burns the fuel as the rack goes on. */
  burn: (logs: number) => void;
  /**
   * Banks a rack: runs the hardening recipe for the `hardened` staves (spears, with XP), adds the
   * `bonus` spears the stars earned, and loses the `charred` staves. Underdone staves stay staves.
   * Returns the spears banked.
   */
  bank: (hardened: number, charred: number, bonus: number) => number;
  onEvent?: (event: FiremakingEvent) => void;
}

/**
 * One rack of fire-hardening, without any rendering: drop logs into the spots under the rack to
 * even out the fire, lay the rack, and pull it when the staves are done. A hot streak stacks the
 * rack `layers` deep; every layer cooks the same. A view feeds it input and time, and draws it.
 */
export class FiremakingRound {
  readonly fire: Fire;
  /** The rack's size, and the rules its fire follows. */
  readonly rack: Rack;
  readonly #fireRules: FireRules;
  /** Staves on the rack (up to `layers` full rows), and how deep it's stacked. */
  readonly staves: number;
  readonly layers: number;
  /** Logs in each fuel spot. */
  readonly logs: number[];
  phase: FiremakingPhase = { kind: 'plan' };
  now = 0;
  readonly #hooks: FiremakingHooks;
  /** The heat and cooking, fixed when the rack goes on (so sliders apply from the next rack). */
  #cooking: { heats: number[]; feel: FiremakingFeel } | undefined;
  #fuelTaps = 0;

  constructor(
    fire: Fire,
    rules: FireRules,
    hooks: FiremakingHooks,
    staves: number,
    layers: number,
  ) {
    if (staves < 1) throw new Error('A rack needs at least one stave');
    this.fire = fire;
    this.rack = rules.rack;
    this.#fireRules = rules;
    this.staves = staves;
    this.layers = layers;
    this.#hooks = hooks;
    this.logs = new Array<number>(rules.rack.spots).fill(0);
    const feel = hooks.feel();
    const answerWindow = bestPull(rules, feel, heatWith(rules, feel, fire, fire.answer)).window;
    // Every full-rack answer, on racks small enough to search.
    const answers =
      rules.rack.spots <= rules.generator.searchSpots
        ? fullRackAnswers(rules, feel, fire)
        : undefined;
    this.#log('firemaking.rackStart', {
      seed: fire.seed,
      spots: rules.rack.spots,
      base: fire.base.map(round2),
      answer: fire.answer,
      answerWindow: round2(answerWindow),
      ...(answers && {
        answers: answers.length,
        bestWindow: round2(answers[0]?.window ?? 0),
      }),
      staves,
      layers,
      logsAvailable: hooks.logsAvailable,
      feel,
    });
  }

  get rules(): Firemaking {
    return this.#hooks.rules;
  }

  get feel(): FiremakingFeel {
    return this.#cooking?.feel ?? this.#hooks.feel();
  }

  /** Staves along one layer of the rack. */
  get columns(): number {
    return this.rack.staves;
  }

  /** The heat under each stave of a layer: as planned, or as it was when the rack went on. */
  get heats(): number[] {
    return this.#cooking?.heats ?? heatWith(this.#fireRules, this.feel, this.fire, this.logs);
  }

  /** The best pull for the fuel as it stands: the live preview. */
  get preview(): BestPull {
    return bestPull(this.rules, this.feel, this.heats);
  }

  get logsPlaced(): number {
    return this.logs.reduce((sum, count) => sum + count, 0);
  }

  /** Seconds the rack has been on the fire (or was, once it's off). */
  get cooked(): number {
    if (this.phase.kind === 'cook') return this.now - this.phase.at;
    return this.phase.kind === 'done' ? this.phase.seconds : 0;
  }

  /** How far along stave `column` of a layer is: 1 is hardened, `charRatio` charred. */
  doneness(column: number): number {
    const heat = this.heats[column] ?? 0;
    return doneness(this.rules, this.feel, heat, this.cooked);
  }

  // Planning

  /**
   * A tap on a fuel spot: one more log, and past the most it holds (or the logs there are),
   * back to none.
   */
  tapSpot(spot: number): void {
    if (this.phase.kind !== 'plan' || spot < 0 || spot >= this.logs.length) return;
    const now = this.logs[spot] ?? 0;
    const spare = this.#hooks.logsAvailable - this.logsPlaced;
    const next = now < this.rack.maxLogs && spare > 0 ? now + 1 : 0;
    this.logs[spot] = next;
    this.#fuelTaps += 1;
    this.#hooks.onEvent?.({ type: 'fuel', spot, logs: next });
  }

  /** Lays the rack on the fire: the fuel is burned and the cook starts. */
  lay(): void {
    if (this.phase.kind !== 'plan') return;
    const feel = { ...this.#hooks.feel() };
    const heats = heatWith(this.#fireRules, feel, this.fire, this.logs);
    const preview = bestPull(this.rules, feel, heats);
    this.#cooking = { heats, feel };
    if (this.logsPlaced > 0) this.#hooks.burn(this.logsPlaced);
    this.#log('firemaking.lay', {
      seed: this.fire.seed,
      spots: this.rack.spots,
      logs: [...this.logs],
      logsUsed: this.logsPlaced,
      answer: this.fire.answer,
      heats: heats.map(round2),
      bestAt: round2(preview.at),
      bestHardened: preview.hardened,
      window: round2(preview.window),
      fuelTaps: this.#fuelTaps,
      planSeconds: round2(this.now),
    });
    this.phase = { kind: 'cook', at: this.now };
    this.#hooks.onEvent?.({ type: 'lay' });
  }

  // Cooking and the pull

  tick(dt: number): void {
    this.now += dt;
    if (this.phase.kind !== 'cook') return;
    // Left on until the coldest stave has charred: the rack comes off on its own.
    const coldest = Math.min(...this.heats);
    if (this.cooked >= hardenAt(this.rules, this.feel, coldest) * this.feel.charRatio) {
      this.#finish(true);
    }
  }

  /** The handle is pulled: the rack comes off the fire now. */
  pull(): void {
    if (this.phase.kind === 'cook') this.#finish(false);
  }

  /** Leaving mid-rack: the fuel is burned, but the staves aren't used up. */
  exit(): void {
    if (this.phase.kind === 'done') return;
    this.#log('firemaking.leave', {
      seed: this.fire.seed,
      phase: this.phase.kind,
      logsUsed: this.phase.kind === 'cook' ? this.logsPlaced : 0,
      seconds: round2(this.now),
    });
  }

  #finish(burnt: boolean): void {
    const feel = this.feel;
    const seconds = this.cooked;
    const best = this.preview;
    const finishes = Array.from({ length: this.staves }, (_, index) =>
      finishOf(feel, this.doneness(index % this.columns)),
    );
    const count = (finish: Finish) => finishes.filter((value) => value === finish).length;
    const hardened = count('hardened');
    const under = count('under');
    const charred = count('charred');
    const bottom = finishes.slice(0, this.columns);
    const missed = bottom.filter((finish) => finish !== 'hardened').length;
    const stars = starsFor(this.rules, missed, this.columns);
    const bonus = starBonusSpears(this.rules, hardened, stars);
    this.phase = { kind: 'done', seconds };
    const banked = this.#hooks.bank(hardened, charred, bonus);
    const result: RackResult = {
      finishes,
      hardened,
      under,
      charred,
      spots: this.rack.spots,
      stars,
      bonus,
      seconds,
      best,
      burnt,
      banked,
    };
    this.#log('firemaking.rackEnd', {
      seed: this.fire.seed,
      spots: this.rack.spots,
      staves: this.staves,
      layers: this.layers,
      hardened,
      under,
      charred,
      stars,
      bonus,
      burnt,
      seconds: round2(seconds),
      bestAt: round2(best.at),
      // Positive is late, negative early.
      offBest: round2(seconds - best.at),
      bestHardened: best.hardened,
      window: round2(best.window),
      logsUsed: this.logsPlaced,
      banked,
    });
    this.#hooks.onEvent?.({ type: 'pulled', ...result });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}

/** Stars for a rack with `missed` of a layer's `columns` staves that didn't harden. */
export function starsFor(
  rules: Pick<Firemaking, 'stars'>,
  missed: number,
  columns: number,
): number {
  if (missed <= 0) return 3;
  return missed <= columns * rules.stars.twoMissedShare ? 2 : 1;
}

/** Bonus spears for a rack's stars: a share of the spears hardened, none below 2 stars. */
export function starBonusSpears(
  rules: Pick<Firemaking, 'starBonus'>,
  hardened: number,
  stars: number,
): number {
  return starBonus(hardened, stars, rules.starBonus);
}

/**
 * The hot streak after a rack: a 3-star rack stacks the next one a layer deeper (up to
 * `streakCap` layers); anything less starts again from one. Returns the next rack's layers.
 */
export function nextLayers(layers: number, stars: number, streakCap: number): number {
  return stars >= 3 ? Math.min(layers + 1, Math.max(streakCap, 1)) : 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
