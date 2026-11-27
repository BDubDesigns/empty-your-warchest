import { Rng, type EventLogger } from '../../../core';
import { GameDataError, type BrewPotion, type Brewing, type BrewingFeel } from '../../../data';
import { offBy, type OffBy } from './advice';
import { hexToLab, labDistance, labToHex, mixLab, roundLab, type Lab } from './color';
import {
  mapBounds,
  mapPoint,
  potCloud,
  type CloudPoint,
  type MapBounds,
  type MapPoint,
} from './map';
import { reachFrom, type Reach } from './reach';

/** What water is called among the drops: it's a tool, not an item. */
export const WATER = 'water';

/** One thing on the shelf: an ingredient item, or water. */
export interface ShelfEntry {
  id: string;
  color: Lab;
  hex: string;
  strength: number;
  /** The way it pulls a colour ("red"), for advice; water has none. */
  tint?: string | undefined;
}

/** The shelf: the ingredients in data order, then water. */
export function shelfOf(rules: Pick<Brewing, 'ingredients' | 'water'>): ShelfEntry[] {
  return [
    ...rules.ingredients.map((entry) => ({
      id: entry.item,
      color: hexToLab(entry.color),
      hex: entry.color,
      strength: entry.strength,
      tint: entry.tint,
    })),
    {
      id: WATER,
      color: hexToLab(rules.water.color),
      hex: rules.water.color,
      strength: rules.water.strength,
    },
  ];
}

/** A colour from OKLCh: lightness, chroma and hue (degrees). */
export function lchToLab(L: number, chroma: number, hue: number): Lab {
  const radians = (hue * Math.PI) / 180;
  return { L, a: chroma * Math.cos(radians), b: chroma * Math.sin(radians) };
}

/**
 * A brew's target: anywhere in the potion's region (seeded), so brews differ visibly. Takes the
 * first three numbers from `rng`.
 */
export function targetFor(potion: BrewPotion, rng: Rng): Lab {
  const { L, chroma, hue } = potion.region;
  return lchToLab(
    rng.range(L.min, L.max),
    rng.range(chroma.min, chroma.max),
    rng.range(hue.min, hue.max),
  );
}

/** Stars for a brew `distance` from its target (OKLab): 0 past the one-star band (spoiled). */
export function starsFor(rules: Pick<Brewing, 'stars'>, distance: number): number {
  const { stars } = rules;
  if (distance <= stars.three) return 3;
  if (distance <= stars.two) return 2;
  return distance <= stars.one ? 1 : 0;
}

/** What a brew of `stars` bottles: potions and ingredients given back (none if spoiled). */
export function rewardFor(
  rules: Pick<Brewing, 'rewards'>,
  stars: number,
): { potions: number; refunds: number } {
  const { rewards } = rules;
  if (stars >= 3) return rewards.three;
  if (stars === 2) return rewards.two;
  return stars === 1 ? rewards.one : { potions: 0, refunds: 0 };
}

/** The colour of a pot holding `counts` drops of each shelf entry (by id), all stirred in. */
export function mixOf(
  shelf: readonly ShelfEntry[],
  counts: Record<string, number>,
): Lab | undefined {
  return mixLab(
    shelf.map((entry) => ({
      color: entry.color,
      weight: entry.strength * (counts[entry.id] ?? 0),
    })),
  );
}

/** Every pot that can be made within the fill: how many of each shelf entry, and its colour. */
export function everyMix(
  rules: Pick<Brewing, 'ingredients' | 'water' | 'maxFill'>,
): { counts: Record<string, number>; color: Lab }[] {
  const shelf = shelfOf(rules);
  const mixes: { counts: Record<string, number>; color: Lab }[] = [];
  const counts: number[] = new Array<number>(shelf.length).fill(0);
  const walk = (index: number, left: number): void => {
    if (index === shelf.length) {
      const byId = Object.fromEntries(shelf.map((entry, at) => [entry.id, counts[at] ?? 0]));
      const color = mixOf(shelf, byId);
      if (color) mixes.push({ counts: byId, color });
      return;
    }
    for (let count = 0; count <= left; count++) {
      counts[index] = count;
      walk(index + 1, left - count);
    }
  };
  walk(0, rules.maxFill);
  return mixes;
}

/** The nearest pot to `target` that can be made within the fill. */
export function bestAnswer(
  mixes: readonly { counts: Record<string, number>; color: Lab }[],
  target: Lab,
): { counts: Record<string, number>; distance: number } {
  let best = { counts: {} as Record<string, number>, distance: Infinity };
  for (const mix of mixes) {
    const distance = labDistance(mix.color, target);
    if (distance < best.distance) best = { counts: mix.counts, distance };
  }
  return best;
}

/** How many points along each of lightness, chroma and hue the answer check tries. */
const REGION_STEPS = 6;

/**
 * The worst a potion's target can be from its nearest answer anywhere in its region: checked on
 * a grid through the region, corners and edges included (6 points along each of L, chroma and
 * hue).
 */
export function worstAnswer(rules: Brewing, potion: BrewPotion): number {
  const mixes = everyMix(rules);
  const along = (range: { min: number; max: number }) =>
    Array.from(
      { length: REGION_STEPS },
      (_, step) => range.min + ((range.max - range.min) * step) / (REGION_STEPS - 1),
    );
  const { region } = potion;
  let worst = 0;
  for (const L of along(region.L)) {
    for (const chroma of along(region.chroma)) {
      for (const hue of along(region.hue)) {
        worst = Math.max(worst, bestAnswer(mixes, lchToLab(L, chroma, hue)).distance);
      }
    }
  }
  return worst;
}

/**
 * Fails loudly at startup if any potion's target, anywhere in its region, has no 3-star
 * answer within the fill from the shelf (like the fire pit's answer check).
 */
export function checkBrews(data: { brewing: Brewing }): void {
  const problems = data.brewing.potions.flatMap((potion) => {
    const worst = worstAnswer(data.brewing, potion);
    return worst > data.brewing.stars.three
      ? [`${potion.recipe}: a target can be ${worst.toFixed(3)} from any answer`]
      : [];
  });
  if (problems.length > 0) {
    throw new GameDataError(`Brews with no 3-star answer: ${problems.join('; ')}`);
  }
}

/**
 * A drop in the pot: what it was, how much of it is left (1, less once the ladle has scooped
 * some out) and how much of that is still unstirred (1 → 0).
 */
export interface Drop {
  id: string;
  amount: number;
  unmixed: number;
  /** Round time it went in (views animate it falling). */
  at: number;
}

export interface BrewResult {
  color: Lab;
  distance: number;
  stars: number;
  potions: number;
  /** The ingredient given back, if the stars earned one. */
  refund: string | undefined;
  seconds: number;
  /** Drops put in, how full the pot was at the end (a fraction after the ladle), and ladles used. */
  drops: number;
  fill: number;
  ladles: number;
  /** Potions that went into the warchest. */
  banked: number;
}

export type BrewPhase = 'brew' | 'done';

/** Things a view plays effects for. */
export type BrewEvent =
  | { type: 'drop'; drop: Drop; fill: number }
  | { type: 'full' }
  | { type: 'empty'; id: string }
  /** The ladle scooped `scooped` drops' worth out; the pot's left `fill` full. */
  | { type: 'ladle'; scooped: number; fill: number }
  /** The best stars still possible changed (down after a drop, back up after a ladle). */
  | { type: 'reach'; stars: number; was: number }
  | ({ type: 'bottled' } & BrewResult);

export interface BrewHooks {
  logger: EventLogger;
  /** Read every time, so live tuning applies at once. */
  feel: () => BrewingFeel;
  /** How many of an ingredient item the warchest holds. */
  stock: (item: string) => number;
  /** Takes one of an ingredient out of the warchest as it goes into the pot. */
  take: (item: string) => void;
  /**
   * Banks a bottled brew: `potions` runs of the recipe (with its XP per brew) and the `refund`
   * ingredient back. Returns the potions banked.
   */
  bank: (potions: number, refund: string | undefined) => number;
  onEvent?: (event: BrewEvent) => void;
}

/**
 * One brew at the cauldron, without any rendering: add drops from the shelf, stir to blend them,
 * bottle. Nothing comes back out but the ladle, which scoops some of everything out (lost) to
 * free fill. After every change it works out where the pot can still get to (`reach`). The pot's true colour is the mix of every drop; what shows is
 * the stirred part, with the unstirred drops swirling on top in their own colours. A view feeds it
 * taps, stirring and time, and draws it.
 */
export class BrewRound {
  readonly rules: Brewing;
  readonly potion: BrewPotion;
  readonly seed: number;
  readonly target: Lab;
  readonly shelf: ShelfEntry[];
  /** The colour map round the shelf's colours. */
  readonly map: MapBounds;
  readonly drops: Drop[] = [];
  phase: BrewPhase = 'brew';
  now = 0;
  result: BrewResult | undefined;
  readonly #hooks: BrewHooks;
  readonly #rng: Rng;
  readonly #byId: Map<string, ShelfEntry>;
  /** Turns of stirring asked for and not yet done (stirring has a top speed). */
  #stirOwed = 0;
  /** Turns stirred since the last `brewing.stir` log, and in all. */
  #stirred = 0;
  #stirTotal = 0;
  #ladles = 0;
  /** Where the pot can still get to: replaced (not changed) on every drop and ladle. */
  #reach: Reach;

  constructor(rules: Brewing, potion: BrewPotion, hooks: BrewHooks, seed: number) {
    this.rules = rules;
    this.potion = potion;
    this.seed = seed;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.target = targetFor(potion, this.#rng);
    this.shelf = shelfOf(rules);
    this.#byId = new Map(this.shelf.map((entry) => [entry.id, entry]));
    this.map = mapBounds(
      this.shelf.map((entry) => entry.color),
      rules.map.margin,
    );
    const answer = bestAnswer(everyMix(rules), this.target);
    this.#reach = this.#reachNow();
    this.#log('brewing.start', {
      recipe: potion.recipe,
      seed,
      target: roundLab(this.target),
      targetHex: labToHex(this.target),
      targetMap: roundMap(mapPoint(this.map, this.target)),
      answer: answer.counts,
      answerDistance: round3(answer.distance),
      stock: Object.fromEntries(
        rules.ingredients.map((entry) => [entry.item, hooks.stock(entry.item)]),
      ),
      feel: hooks.feel(),
    });
  }

  get feel(): BrewingFeel {
    return this.#hooks.feel();
  }

  /** How full the pot is, in drops (a fraction once the ladle has been used). */
  get fill(): number {
    let fill = 0;
    for (const drop of this.drops) fill += drop.amount;
    return snap(fill);
  }

  /** Whole drops that can still go in. */
  get room(): number {
    return Math.max(Math.floor(snap(this.rules.maxFill - this.fill)), 0);
  }

  get full(): boolean {
    return this.room < 1;
  }

  /** How much of each shelf entry is in the pot, in drops (fractions after the ladle). */
  get counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const drop of this.drops) counts[drop.id] = (counts[drop.id] ?? 0) + drop.amount;
    for (const id of Object.keys(counts)) counts[id] = snap(counts[id] ?? 0);
    return counts;
  }

  /** Where the pot can still get to with the room left: every colour, and the best of them. */
  get reach(): Reach {
    return this.#reach;
  }

  /** The most stars still possible without the ladle (0 when even one star is out of reach). */
  get bestStars(): number {
    return starsFor(this.rules, this.#reach.best.distance);
  }

  /** Ladles left this brew. */
  get ladlesLeft(): number {
    return Math.max(this.rules.ladle.uses - this.#ladles, 0);
  }

  /** The ladle needs something in the pot, and a use left. */
  get canLadle(): boolean {
    return this.phase === 'brew' && this.ladlesLeft > 0 && this.fill > 0;
  }

  /** The pot's true colour: every drop, stirred or not. */
  get mixed(): Lab | undefined {
    return mixOf(this.shelf, this.counts);
  }

  /** What shows under the swirls: the stirred part only. */
  get shown(): Lab | undefined {
    return mixLab(
      this.drops.map((drop) => ({
        color: this.entry(drop.id).color,
        weight: this.entry(drop.id).strength * drop.amount * (1 - drop.unmixed),
      })),
    );
  }

  /** Share of the pot (by strength) still unstirred, 0–1. */
  get unmixed(): number {
    let total = 0;
    let left = 0;
    for (const drop of this.drops) {
      const strength = this.entry(drop.id).strength * drop.amount;
      total += strength;
      left += strength * drop.unmixed;
    }
    return total > 0 ? left / total : 0;
  }

  /** The pot on the colour map: a cloud of its drops, drawn in to one point as it's stirred. */
  get cloud(): CloudPoint[] {
    const mixed = this.mixed;
    if (!mixed) return [];
    return potCloud(
      mixed,
      this.drops.map((drop) => {
        const entry = this.entry(drop.id);
        return {
          color: entry.color,
          weight: entry.strength * drop.amount,
          unmixed: drop.unmixed,
        };
      }),
    );
  }

  /** Stirred enough for the map to show which star ring the pot is in. */
  get revealed(): boolean {
    return this.fill > 0 && this.unmixed <= this.feel.revealUnmixed;
  }

  /** The star ring round the target the pot's true colour is in (0 outside them all). */
  get ring(): number {
    const mixed = this.mixed;
    return mixed ? starsFor(this.rules, labDistance(mixed, this.target)) : 0;
  }

  /** Which way the pot's true colour is off from the target (lightness and colour apart). */
  get off(): OffBy | undefined {
    const mixed = this.mixed;
    return mixed ? offBy(this.rules, this.shelf, mixed, this.target) : undefined;
  }

  /** Where the pot's true colour sits on the map, for the logs. */
  #where(): { map: MapPoint | null; ring: number } {
    const mixed = this.mixed;
    return { map: mixed ? roundMap(mapPoint(this.map, mixed)) : null, ring: this.ring };
  }

  entry(id: string): ShelfEntry {
    const entry = this.#byId.get(id);
    if (!entry) throw new Error(`"${id}" isn't on the shelf`);
    return entry;
  }

  /** How many more of a shelf entry can go in: water never runs out. */
  left(id: string): number {
    return id === WATER ? Infinity : Math.max(this.#hooks.stock(id), 0);
  }

  /** A tap on the shelf: one drop of it into the pot, if there's room and some left. */
  add(id: string): boolean {
    if (this.phase !== 'brew' || !this.#byId.has(id)) return false;
    if (this.full) {
      this.#hooks.onEvent?.({ type: 'full' });
      return false;
    }
    if (id !== WATER) {
      if (this.#hooks.stock(id) < 1) {
        this.#hooks.onEvent?.({ type: 'empty', id });
        return false;
      }
      this.#hooks.take(id);
    }
    const drop: Drop = { id, amount: 1, unmixed: 1, at: this.now };
    this.drops.push(drop);
    const was = this.bestStars;
    this.#reach = this.#reachNow();
    const after = this.mixed;
    this.#log('brewing.drop', {
      seed: this.seed,
      ingredient: id,
      fill: round3(this.fill),
      color: after && roundLab(after),
      hex: after && labToHex(after),
      distance: after && round3(labDistance(after, this.target)),
      ...this.#best(),
      seconds: round2(this.now),
    });
    this.#hooks.onEvent?.({ type: 'drop', drop, fill: this.fill });
    this.#reachChanged(was);
    return true;
  }

  /**
   * The ladle: scoops `ladle.scoop` drops' worth out (no more than `ladle.most` of the pot),
   * evenly from everything in it, so the colour stays and the fill frees up. What it takes is lost.
   */
  ladle(): boolean {
    if (!this.canLadle) return false;
    const { ladle } = this.rules;
    const before = this.fill;
    const counts = this.counts;
    const scooped = Math.min(ladle.scoop, before * ladle.most);
    const keep = 1 - scooped / before;
    for (const drop of this.drops) drop.amount *= keep;
    this.#ladles += 1;
    const was = this.bestStars;
    const bestBefore = this.#reach.best.distance;
    this.#reach = this.#reachNow();
    const after = this.mixed;
    this.#log('brewing.ladle', {
      seed: this.seed,
      scooped: round3(scooped),
      lost: roundCounts(
        Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count * (1 - keep)])),
      ),
      fillBefore: round3(before),
      fill: round3(this.fill),
      counts: roundCounts(this.counts),
      ladlesLeft: this.ladlesLeft,
      hex: after && labToHex(after),
      distance: after && round3(labDistance(after, this.target)),
      bestBefore: finite3(bestBefore),
      bestStarsBefore: was,
      ...this.#best(),
      unmixed: round3(this.unmixed),
      seconds: round2(this.now),
    });
    this.#hooks.onEvent?.({ type: 'ladle', scooped, fill: this.fill });
    this.#reachChanged(was);
    return true;
  }

  #reachNow(): Reach {
    return reachFrom(this.shelf, this.counts, this.room, (id) => this.left(id), this.target);
  }

  /** The best still possible, for the logs. */
  #best(): { best: number | null; bestStars: number; bestAdd: Record<string, number> } {
    const { best } = this.#reach;
    return { best: finite3(best.distance), bestStars: this.bestStars, bestAdd: best.add };
  }

  #reachChanged(was: number): void {
    const stars = this.bestStars;
    if (stars !== was) this.#hooks.onEvent?.({ type: 'reach', stars, was });
  }

  /** The spoon swept `radians` round the pot (either way); it blends in as time allows. */
  stir(radians: number): void {
    if (this.phase !== 'brew') return;
    this.#stirOwed += Math.abs(radians) / (Math.PI * 2);
  }

  /** The finger came off the pot: logs the stirring since the last time. */
  endStir(): void {
    this.#stirOwed = 0;
    if (this.#stirred <= 0) return;
    this.#log('brewing.stir', {
      seed: this.seed,
      turns: round2(this.#stirred),
      unmixed: round3(this.unmixed),
      revealed: this.revealed,
      ...this.#where(),
      fill: this.fill,
      seconds: round2(this.now),
    });
    this.#stirred = 0;
  }

  /** Turns stirred this brew. */
  get stirTurns(): number {
    return this.#stirTotal;
  }

  tick(dt: number): void {
    this.now += dt;
    if (this.phase !== 'brew' || this.#stirOwed <= 0) return;
    const feel = this.feel;
    const turns = Math.min(this.#stirOwed, feel.maxTurnsPerSecond * dt);
    this.#stirOwed = Math.min(this.#stirOwed - turns, feel.maxTurnsPerSecond * 0.25);
    this.#stirred += turns;
    this.#stirTotal += turns;
    const blend = feel.stirPerTurn * turns;
    for (const drop of this.drops) drop.unmixed = Math.max(drop.unmixed - blend, 0);
  }

  /** Bottles the pot: scored by its true colour against the target. Needs at least one drop. */
  bottle(): BrewResult | undefined {
    const color = this.mixed;
    if (this.phase !== 'brew' || !color) return undefined;
    this.endStir();
    const distance = labDistance(color, this.target);
    const stars = starsFor(this.rules, distance);
    const reward = rewardFor(this.rules, stars);
    // Given back: one of the drops put in (water isn't an item), picked by the seeded RNG.
    const items = this.drops.filter((drop) => drop.id !== WATER).map((drop) => drop.id);
    const refund = reward.refunds > 0 && items.length > 0 ? this.#rng.pick(items) : undefined;
    this.phase = 'done';
    const banked = reward.potions > 0 ? this.#hooks.bank(reward.potions, refund) : 0;
    const result: BrewResult = {
      color,
      distance,
      stars,
      potions: reward.potions,
      refund,
      seconds: this.now,
      drops: this.drops.length,
      fill: round3(this.fill),
      ladles: this.#ladles,
      banked,
    };
    this.result = result;
    this.#log('brewing.bottle', {
      seed: this.seed,
      recipe: this.potion.recipe,
      color: roundLab(color),
      hex: labToHex(color),
      target: roundLab(this.target),
      targetHex: labToHex(this.target),
      distance: round3(distance),
      stars,
      ...this.#where(),
      off: roundOff(offBy(this.rules, this.shelf, color, this.target)),
      potions: reward.potions,
      banked,
      refund: refund ?? null,
      counts: roundCounts(this.counts),
      drops: this.drops.length,
      fill: round3(this.fill),
      ladles: this.#ladles,
      unmixed: round3(this.unmixed),
      stirTurns: round2(this.#stirTotal),
      seconds: round2(this.now),
    });
    this.#end('bottled');
    this.#hooks.onEvent?.({ type: 'bottled', ...result });
    return result;
  }

  /** Leaving mid-brew: what went in is lost. */
  exit(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.#end('left');
  }

  #end(reason: 'bottled' | 'left'): void {
    this.#log('brewing.end', {
      seed: this.seed,
      reason,
      fill: round3(this.fill),
      counts: roundCounts(this.counts),
      ladles: this.#ladles,
      stars: this.result?.stars ?? null,
      seconds: round2(this.now),
    });
  }

  #log(type: string, data: Record<string, unknown>): void {
    this.#hooks.logger.log(type, data);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Rounds away float dust (a ladled pot's drops add up to 6.9999999…). */
function snap(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function roundOff(off: OffBy): Record<string, unknown> {
  return { ...off, light: round3(off.light), colour: round3(off.colour) };
}

function finite3(value: number): number | null {
  return Number.isFinite(value) ? round3(value) : null;
}

function roundCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, round3(count)]));
}

function roundMap(point: MapPoint): MapPoint {
  return { x: round3(point.x), y: round3(point.y), l: round3(point.l) };
}
