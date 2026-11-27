import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core';
import {
  BrewRound,
  WATER,
  bestAnswer,
  everyMix,
  labDistance,
  mapBounds,
  reachBar,
  reachCells,
  reachFrom,
  shelfOf,
  starsFor,
  targetFor,
  type BrewEvent,
} from '../src/stations/brewing';
import { data, dataWith, testLogger } from './helpers';

const rules = data.brewing;
const potion = rules.potions[0];
if (!potion) throw new Error('No potion in data');
const shelf = shelfOf(rules);

function brew(
  seed = 5,
  stock: Record<string, number> = { red_cap: 20, moss: 20, woad: 20, ash: 20 },
  brewing = rules,
) {
  const { logger } = testLogger();
  const events: BrewEvent[] = [];
  const left = { ...stock };
  const banked: { potions: number; refund: string | undefined }[] = [];
  const round = new BrewRound(
    brewing,
    potion as NonNullable<typeof potion>,
    {
      logger,
      feel: () => brewing.feel,
      stock: (item) => left[item] ?? 0,
      take: (item) => {
        left[item] = (left[item] ?? 0) - 1;
      },
      bank: (potions, refund) => {
        banked.push({ potions, refund });
        return potions;
      },
      onEvent: (event) => events.push(event),
    },
    seed,
  );
  return { round, events, left, banked, logger };
}

function addAll(round: BrewRound, counts: Record<string, number>) {
  for (const [id, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) expect(round.add(id)).toBe(true);
  }
}

/**
 * Brandon's second playtest: a dark target whose best answer has no moss, opened with red cap,
 * moss and woad out of habit, which puts 3 stars out of reach within the fill.
 */
function playtestSeed(): number {
  const mixes = everyMix(rules);
  for (let seed = 1; seed <= 400; seed++) {
    const answer = bestAnswer(
      mixes,
      targetFor(potion as NonNullable<typeof potion>, new Rng(seed)),
    );
    if ((answer.counts.moss ?? 0) > 0) continue;
    const { round } = brew(seed);
    addAll(round, { red_cap: 1, moss: 1, woad: 1 });
    if (round.bestStars < 3) return seed;
  }
  throw new Error('No playtest-like target in 400 seeds');
}

describe('what the pot can still reach', () => {
  it('from an empty pot, is every pot the fill allows, and its best is the best answer', () => {
    const { round } = brew(11);
    const mixes = everyMix(rules);
    expect(round.reach.colors).toHaveLength(mixes.length);
    expect(round.reach.best.distance).toBeCloseTo(bestAnswer(mixes, round.target).distance, 12);
    expect(round.bestStars).toBe(3);
  });

  it('includes the pot as it stands, and once full is only that', () => {
    const { round } = brew();
    addAll(round, { red_cap: 2, woad: 3 });
    const mixed = round.mixed;
    if (!mixed) throw new Error('Nothing in the pot');
    expect(round.reach.colors.some((color) => labDistance(color, mixed) < 1e-12)).toBe(true);
    for (let i = 0; i < rules.maxFill; i++) round.add(WATER);
    expect(round.full).toBe(true);
    expect(round.reach.colors).toHaveLength(1);
    const distance = round.bottle()?.distance;
    expect(round.reach.best.distance).toBeCloseTo(distance ?? Infinity, 12);
    expect(round.reach.best.add).toEqual({});
  });

  it('only gets worse as drops go in', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { round } = brew(seed);
      let best = round.reach.best.distance;
      for (const id of ['moss', 'red_cap', 'woad', WATER, 'ash', 'moss', 'woad']) {
        round.add(id);
        expect(round.reach.best.distance).toBeGreaterThanOrEqual(best - 1e-12);
        best = round.reach.best.distance;
      }
    }
  });

  it('is honest: adding the best drops still possible and bottling scores exactly that', () => {
    const { round } = brew(playtestSeed());
    addAll(round, { red_cap: 1, moss: 1, woad: 1 });
    const best = round.reach.best;
    addAll(round, best.add);
    expect(round.bottle()?.distance).toBeCloseTo(best.distance, 12);
  });

  it('counts only what the warchest holds', () => {
    const { round } = brew(11, { red_cap: 20, moss: 20, woad: 0, ash: 20 });
    const without = everyMix(rules).filter((mix) => (mix.counts.woad ?? 0) === 0);
    expect(round.reach.colors).toHaveLength(without.length);
    expect(round.reach.best.distance).toBeCloseTo(bestAnswer(without, round.target).distance, 12);
    expect(round.reach.best.add.woad).toBeUndefined();
  });

  it('says the moment 3 stars goes out of reach (Brandon’s plum)', async () => {
    const { round, events, logger } = brew(playtestSeed());
    round.add('red_cap');
    round.add('moss');
    round.add('woad');
    expect(round.bestStars).toBe(2);
    expect(round.reach.best.distance).toBeGreaterThan(rules.stars.three);
    expect(events).toContainEqual({ type: 'reach', stars: 2, was: 3 });
    const drops = (await logger.readAll()).filter((event) => event.type === 'brewing.drop');
    expect(drops.map((event) => event.data?.bestStars)).toContain(2);
    expect(drops.at(-1)?.data).toMatchObject({
      best: expect.any(Number) as number,
      bestAdd: expect.any(Object) as object,
    });
  });

  it('is cheap: an empty pot’s reach and map take a few ms (about 2 on a desktop)', () => {
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      const reach = reachFrom(shelf, {}, rules.maxFill, () => 20, { L: 0.5, a: 0.03, b: -0.03 });
      reachCells(
        mapBounds(
          shelf.map((entry) => entry.color),
          0.03,
        ),
        reach.colors,
        0.5,
        rules.stars.two,
        40,
      );
    }
    // A loose bound (a phone is slower than this machine): it guards against a blow-up.
    expect((performance.now() - start) / 10).toBeLessThan(50);
  });
});

describe('the reach on the map', () => {
  const { round } = brew(11);
  const within = rules.stars.two;

  it('marks cells by the nearest reachable pot (thinned: at most a patch’s width over)', () => {
    const cells = 40;
    const near = reachCells(round.map, round.reach.colors, round.target.L, within, cells);
    const { map } = round;
    const size = (map.half * 2) / cells;
    let lit = 0;
    near.forEach((distance, at) => {
      if (!Number.isFinite(distance)) return;
      lit++;
      const a = map.a - map.half + ((at % cells) + 0.5) * size;
      const b = map.b + map.half - (Math.floor(at / cells) + 0.5) * size;
      const cell = { L: round.target.L, a, b };
      const nearest = Math.min(...round.reach.colors.map((color) => labDistance(color, cell)));
      // A patch is a third of a cell across: its diagonal is all the thinning can add.
      expect(distance).toBeGreaterThanOrEqual(nearest - 1e-6);
      expect(distance).toBeLessThanOrEqual(nearest + (size / 3) * Math.SQRT2 + 1e-6);
      expect(distance).toBeLessThanOrEqual(within + 1e-6);
    });
    // Some of the map can be reached from an empty pot, and its far corners can't.
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(near.length);
    expect(near[0]).toBe(Infinity);
  });

  it('lights the target exactly while 3 stars can be had', () => {
    const at = ({ reach, target }: BrewRound) => {
      // A one-cell map round the target.
      const bounds = { a: target.a, b: target.b, half: 1e-6, low: 0, high: 1 };
      return reachCells(bounds, reach.colors, target.L, rules.stars.three, 1)[0] ?? Infinity;
    };
    expect(at(round)).toBeLessThanOrEqual(rules.stars.three);
    const { round: lost } = brew(playtestSeed());
    addAll(lost, { red_cap: 1, moss: 1, woad: 1 });
    expect(at(lost)).toBe(Infinity);
    lost.ladle();
    expect(at(lost)).toBeLessThanOrEqual(rules.stars.three);
  });

  it('lights the lightness bar round reachable lightnesses at the target’s colour', () => {
    const rows = 48;
    const bar = reachBar(
      round.map,
      round.reach.colors,
      round.target.a,
      round.target.b,
      within,
      rows,
    );
    const lit = [...bar].filter((distance) => Number.isFinite(distance));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThan(rows);
    for (const distance of lit) expect(distance).toBeLessThanOrEqual(within + 1e-6);
  });
});

describe('the ladle', () => {
  it('scoops some of everything out: the colour stays, the fill frees up', () => {
    const { round, events } = brew();
    addAll(round, { red_cap: 2, moss: 1, woad: 2, ash: 1 });
    const before = round.mixed;
    const unmixed = round.unmixed;
    expect(round.ladle()).toBe(true);
    const after = round.mixed;
    if (!before || !after) throw new Error('Nothing in the pot');
    expect(labDistance(before, after)).toBeLessThan(1e-12);
    expect(round.unmixed).toBeCloseTo(unmixed, 12);
    expect(round.fill).toBe(6 - rules.ladle.scoop);
    expect(round.room).toBe(rules.maxFill - 6 + rules.ladle.scoop);
    expect(round.counts.red_cap).toBeCloseTo(2 * (1 - rules.ladle.scoop / 6), 12);
    expect(events).toContainEqual({ type: 'ladle', scooped: rules.ladle.scoop, fill: round.fill });
  });

  it('never takes more than its share of a small pot', () => {
    const { round } = brew();
    addAll(round, { red_cap: 1, woad: 1 });
    round.ladle();
    expect(round.fill).toBeCloseTo(2 * (1 - rules.ladle.most), 12);
    expect(round.mixed).toBeDefined();
  });

  it('goes as many times a brew as the data says, and not on an empty or bottled pot', () => {
    const { round } = brew();
    expect(round.canLadle).toBe(false);
    expect(round.ladle()).toBe(false);
    addAll(round, { red_cap: 4, woad: 4 });
    for (let i = 0; i < rules.ladle.uses; i++) expect(round.ladle()).toBe(true);
    expect(round.ladlesLeft).toBe(0);
    expect(round.ladle()).toBe(false);
    const { round: bottled } = brew();
    bottled.add('red_cap');
    bottled.bottle();
    expect(bottled.ladle()).toBe(false);
    const none = dataWith((raw) => {
      raw.brewing.ladle.uses = 0;
    }).brewing;
    const { round: noLadle } = brew(5, undefined, none);
    noLadle.add('red_cap');
    expect(noLadle.ladle()).toBe(false);
  });

  it('fills up in whole drops after a fractional scoop', () => {
    const { round } = brew();
    addAll(round, { red_cap: 1, woad: 2 });
    round.ladle();
    // 3 drops, half scooped: 1.5 in the pot, room for 8 whole drops (9.5 is as full as it gets).
    expect(round.fill).toBeCloseTo(1.5, 12);
    expect(round.room).toBe(8);
    for (let i = 0; i < 8; i++) expect(round.add(WATER)).toBe(true);
    expect(round.full).toBe(true);
    expect(round.add(WATER)).toBe(false);
    expect(round.fill).toBeCloseTo(9.5, 12);
  });

  it('brings 3 stars back into reach in Brandon’s plum, and the brew bottles 3 stars', () => {
    const { round, events, banked } = brew(playtestSeed());
    addAll(round, { red_cap: 1, moss: 1, woad: 1 });
    expect(round.bestStars).toBe(2);
    expect(round.ladle()).toBe(true);
    expect(round.bestStars).toBe(3);
    expect(events).toContainEqual({ type: 'reach', stars: 3, was: 2 });
    addAll(round, round.reach.best.add);
    const result = round.bottle();
    expect(result?.stars).toBe(3);
    expect(result?.potions).toBe(rules.rewards.three.potions);
    expect(result?.ladles).toBe(1);
    expect(result?.drops).toBe(round.drops.length);
    expect(result?.fill).toBeCloseTo(round.fill, 3);
    // The ingredient back is one of the items put in, whole.
    expect(banked).toHaveLength(1);
    expect(['red_cap', 'moss', 'woad', 'ash']).toContain(banked[0]?.refund);
    expect(starsFor(rules, result?.distance ?? 1)).toBe(3);
  });

  it('logs what it scooped and lost, and the best still possible before and after', async () => {
    const { round, logger } = brew(playtestSeed());
    addAll(round, { red_cap: 1, moss: 1, woad: 1 });
    round.ladle();
    round.bottle();
    const events = await logger.readAll();
    const ladle = events.find((event) => event.type === 'brewing.ladle');
    expect(ladle?.data).toMatchObject({
      scooped: 1.5,
      lost: { red_cap: 0.5, moss: 0.5, woad: 0.5 },
      fillBefore: 3,
      fill: 1.5,
      counts: { red_cap: 0.5, moss: 0.5, woad: 0.5 },
      ladlesLeft: rules.ladle.uses - 1,
      bestStarsBefore: 2,
      bestStars: 3,
    });
    const bottle = events.find((event) => event.type === 'brewing.bottle');
    expect(bottle?.data).toMatchObject({ ladles: 1, drops: 3, fill: 1.5 });
  });

  it('replays the same with a ladle in it', () => {
    const play = () => {
      const { round } = brew(42);
      addAll(round, { red_cap: 2, moss: 1, woad: 3 });
      round.ladle();
      addAll(round, { woad: 1, ash: 2 });
      return { result: round.bottle(), counts: round.counts };
    };
    expect(play()).toEqual(play());
  });
});
