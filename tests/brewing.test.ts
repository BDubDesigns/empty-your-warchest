import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core';
import {
  BrewRound,
  WATER,
  bestAnswer,
  checkBrews,
  everyMix,
  hexToLab,
  labDistance,
  labToHex,
  lchToLab,
  mapBounds,
  mapPoint,
  mapScale,
  mixLab,
  rewardFor,
  starsFor,
  targetFor,
  worstAnswer,
  type BrewEvent,
} from '../src/stations/brewing';
import { data, dataWith, testLogger } from './helpers';

const rules = data.brewing;
const potion = rules.potions[0];
if (!potion) throw new Error('No potion in data');

function brew(
  seed = 5,
  stock: Record<string, number> = { red_cap: 20, moss: 20, woad: 20, ash: 20 },
) {
  const { logger } = testLogger();
  const events: BrewEvent[] = [];
  const left = { ...stock };
  const banked: { potions: number; refund: string | undefined }[] = [];
  const round = new BrewRound(
    rules,
    potion as NonNullable<typeof potion>,
    {
      logger,
      feel: () => rules.feel,
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

/** Stirs until every drop is blended in. */
function stirAll(round: BrewRound) {
  for (let i = 0; i < 600 && round.unmixed > 0; i++) {
    round.stir(Math.PI);
    round.tick(1 / 30);
  }
  round.endStir();
}

describe('colour maths (OKLab)', () => {
  it('round-trips colours through OKLab', () => {
    for (const hex of ['#c65530', '#a3c23a', '#3b3936', '#e4ecee', '#000000', '#ffffff']) {
      expect(labToHex(hexToLab(hex))).toBe(hex);
    }
    expect(hexToLab('#ffffff').L).toBeCloseTo(1, 3);
    expect(hexToLab('#000000').L).toBeCloseTo(0, 3);
  });

  it('measures distance in OKLab', () => {
    const red = hexToLab('#d8301e');
    expect(labDistance(red, red)).toBe(0);
    expect(labDistance(red, hexToLab('#000000'))).toBeGreaterThan(0.5);
  });

  it('mixes by strength-weighted average', () => {
    const a = { L: 0.2, a: 0.1, b: 0 };
    const b = { L: 0.8, a: -0.1, b: 0.2 };
    expect(
      mixLab([
        { color: a, weight: 1 },
        { color: b, weight: 1 },
      ]),
    ).toEqual({
      L: 0.5,
      a: 0,
      b: 0.1,
    });
    expect(
      mixLab([
        { color: a, weight: 3 },
        { color: b, weight: 1 },
      ])?.L,
    ).toBeCloseTo(0.35);
    expect(mixLab([])).toBeUndefined();
  });

  it('water lightens, ash darkens and dulls', () => {
    const red = { red_cap: 4 };
    const mixes = everyMix(rules);
    const find = (counts: Record<string, number>) =>
      mixes.find((mix) =>
        Object.entries({ red_cap: 0, moss: 0, woad: 0, ash: 0, [WATER]: 0, ...counts }).every(
          ([id, count]) => (mix.counts[id] ?? 0) === count,
        ),
      )?.color;
    const base = find(red);
    const watered = find({ ...red, [WATER]: 2 });
    const ashed = find({ ...red, ash: 2 });
    if (!base || !watered || !ashed) throw new Error('Missing mixes');
    const chroma = (lab: { a: number; b: number }) => Math.hypot(lab.a, lab.b);
    expect(watered.L).toBeGreaterThan(base.L);
    expect(ashed.L).toBeLessThan(base.L);
    expect(chroma(ashed)).toBeLessThan(chroma(base));
  });
});

describe('solvability', () => {
  it('has a 3-star answer within the fill for every target in the region', () => {
    expect(worstAnswer(rules, potion)).toBeLessThanOrEqual(rules.stars.three);
    expect(() => {
      checkBrews(data);
    }).not.toThrow();
  });

  it('has a 3-star answer for many seeded targets', () => {
    const mixes = everyMix(rules);
    for (let seed = 1; seed <= 200; seed++) {
      const target = targetFor(potion, new Rng(seed));
      expect(bestAnswer(mixes, target).distance).toBeLessThanOrEqual(rules.stars.three);
    }
  });

  it('fails loudly when the fill is too small to reach the target', () => {
    const small = dataWith((raw) => {
      raw.brewing.maxFill = 1;
    });
    expect(() => {
      checkBrews(small);
    }).toThrow('no 3-star answer');
  });

  it('picks each target in the potion’s region, the same for a seed, and spread across it', () => {
    const a = targetFor(potion, new Rng(9));
    expect(targetFor(potion, new Rng(9))).toEqual(a);
    const { region } = potion;
    const targets = Array.from({ length: 200 }, (_, seed) => targetFor(potion, new Rng(seed + 1)));
    for (const target of targets) {
      const chroma = Math.hypot(target.a, target.b);
      const hue = (Math.atan2(target.b, target.a) * 180) / Math.PI;
      expect(target.L).toBeGreaterThanOrEqual(region.L.min);
      expect(target.L).toBeLessThanOrEqual(region.L.max);
      expect(chroma).toBeGreaterThanOrEqual(region.chroma.min - 1e-9);
      expect(chroma).toBeLessThanOrEqual(region.chroma.max + 1e-9);
      const turned = ((hue % 360) + 360) % 360;
      const inHue = [turned, turned + 360].some(
        (h) => h >= region.hue.min - 1e-6 && h <= region.hue.max + 1e-6,
      );
      expect(inHue).toBe(true);
    }
    // Brews differ visibly: some pairs of targets are further apart than the 2-star band.
    const spread = Math.max(...targets.map((target) => labDistance(target, a)));
    expect(spread).toBeGreaterThan(rules.stars.two);
    const up = lchToLab(0.5, 0.1, 90);
    expect(up.L).toBe(0.5);
    expect(up.a).toBeCloseTo(0, 9);
    expect(up.b).toBeCloseTo(0.1, 9);
  });

  it('needs red caps and woad for every Sense target, and moss for some', () => {
    const mixes = everyMix(rules);
    let moss = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { counts } = bestAnswer(mixes, targetFor(potion, new Rng(seed)));
      expect(counts.red_cap).toBeGreaterThan(0);
      expect(counts.woad).toBeGreaterThan(0);
      if ((counts.moss ?? 0) > 0) moss++;
    }
    expect(moss).toBeGreaterThan(0);
  });

  it('refuses two potions whose regions overlap', () => {
    expect(() =>
      dataWith((raw) => {
        const first = raw.brewing.potions[0];
        if (first) raw.brewing.potions.push({ ...first });
      }),
    ).toThrow('Overlaps');
  });
});

describe('the colour map', () => {
  const shelf = rules.ingredients.map((entry) => hexToLab(entry.color));
  const bounds = mapBounds([...shelf, hexToLab(rules.water.color)], rules.map.margin);

  it('holds every shelf colour, a margin in from its edges', () => {
    for (const color of shelf) {
      const point = mapPoint(bounds, color);
      for (const at of [point.x, point.y]) {
        expect(at).toBeGreaterThan(0);
        expect(at).toBeLessThan(1);
      }
    }
  });

  it('puts red to the right, blue down, yellow-green up; ash low and water high', () => {
    const at = (hex: string) => mapPoint(bounds, hexToLab(hex));
    const red = at('#d8301e');
    const woad = at(rules.ingredients.find((entry) => entry.item === 'woad')?.color ?? '');
    const moss = at('#a3c23a');
    expect(red.x).toBeGreaterThan(moss.x);
    expect(woad.y).toBeGreaterThan(moss.y);
    expect(woad.y).toBeGreaterThan(red.y);
    expect(at(rules.water.color).l).toBeCloseTo(1);
    expect(at('#3b3936').l).toBeCloseTo(0);
    expect(mapScale(bounds, bounds.half * 2)).toBe(1);
  });

  it('shows an unstirred pot as a cloud at its drops’ colours, and a stirred one as a point', () => {
    const { round } = brew();
    round.add('red_cap');
    round.add('woad');
    const cloud = round.cloud;
    expect(cloud).toHaveLength(2);
    expect(labDistance(cloud[0]?.color ?? hexToLab('#000000'), hexToLab('#d8301e'))).toBeLessThan(
      1e-9,
    );
    expect(round.revealed).toBe(false);
    stirAll(round);
    const mixed = round.mixed;
    if (!mixed) throw new Error('Nothing in the pot');
    for (const point of round.cloud) expect(labDistance(point.color, mixed)).toBeLessThan(1e-9);
    expect(round.revealed).toBe(true);
    expect(round.ring).toBe(starsFor(rules, labDistance(mixed, round.target)));
  });

  it('logs the pot’s place on the map and its ring after each stir and at bottling', async () => {
    const { round, logger } = brew(11);
    const answer = bestAnswer(everyMix(rules), round.target);
    for (const [id, count] of Object.entries(answer.counts)) {
      for (let i = 0; i < count; i++) round.add(id);
    }
    stirAll(round);
    round.bottle();
    const events = await logger.readAll();
    const stir = events.find((event) => event.type === 'brewing.stir');
    const bottle = events.find((event) => event.type === 'brewing.bottle');
    expect(stir?.data).toMatchObject({ ring: 3, revealed: true });
    expect(stir?.data?.map).toEqual({
      x: expect.any(Number) as number,
      y: expect.any(Number) as number,
      l: expect.any(Number) as number,
    });
    expect(bottle?.data).toMatchObject({ ring: 3, stars: 3 });
    expect(bottle?.data?.map).toEqual(stir?.data?.map);
  });
});

describe('stars and rewards', () => {
  it('gives stars by distance band, and spoils past one star', () => {
    expect(starsFor(rules, 0)).toBe(3);
    expect(starsFor(rules, rules.stars.three)).toBe(3);
    expect(starsFor(rules, rules.stars.two)).toBe(2);
    expect(starsFor(rules, rules.stars.one)).toBe(1);
    expect(starsFor(rules, rules.stars.one + 0.001)).toBe(0);
  });

  it('bottles 1, 1 + an ingredient, 2 + an ingredient (Brandon)', () => {
    expect(rewardFor(rules, 1)).toEqual({ potions: 1, refunds: 0 });
    expect(rewardFor(rules, 2)).toEqual({ potions: 1, refunds: 1 });
    expect(rewardFor(rules, 3)).toEqual({ potions: 2, refunds: 1 });
    expect(rewardFor(rules, 0)).toEqual({ potions: 0, refunds: 0 });
  });
});

describe('a brew', () => {
  it('takes each ingredient out of the warchest as it drops in; water is free', () => {
    const { round, left } = brew();
    expect(round.add('red_cap')).toBe(true);
    expect(round.add(WATER)).toBe(true);
    expect(left.red_cap).toBe(19);
    expect(round.fill).toBe(2);
    expect(round.left(WATER)).toBe(Infinity);
  });

  it('won’t add past the fill or without stock', () => {
    const { round, events } = brew(5, { red_cap: 1, moss: 0, ash: 0 });
    expect(round.add('moss')).toBe(false);
    expect(events).toContainEqual({ type: 'empty', id: 'moss' });
    round.add('red_cap');
    expect(round.add('red_cap')).toBe(false);
    for (let i = 0; i < rules.maxFill; i++) round.add(WATER);
    expect(round.fill).toBe(rules.maxFill);
    expect(round.add(WATER)).toBe(false);
    expect(events).toContainEqual({ type: 'full' });
  });

  it('shows only the stirred part: unstirred drops swirl until stirred in', () => {
    const { round } = brew();
    round.add('red_cap');
    round.add('moss');
    expect(round.shown).toBeUndefined();
    expect(round.unmixed).toBe(1);
    stirAll(round);
    expect(round.unmixed).toBe(0);
    const shown = round.shown;
    const mixed = round.mixed;
    if (!shown || !mixed) throw new Error('Nothing in the pot');
    expect(labDistance(shown, mixed)).toBeLessThan(1e-9);
  });

  it('stirs no faster than its top speed', () => {
    const { round } = brew();
    round.add('red_cap');
    round.stir(Math.PI * 2 * 10);
    round.tick(1);
    expect(round.stirTurns).toBeCloseTo(rules.feel.maxTurnsPerSecond);
  });

  it('bottles the best answer for 3 stars, 2 potions and an ingredient back', () => {
    const { round, banked } = brew(11);
    const answer = bestAnswer(everyMix(rules), round.target);
    for (const [id, count] of Object.entries(answer.counts)) {
      for (let i = 0; i < count; i++) round.add(id);
    }
    stirAll(round);
    const result = round.bottle();
    expect(result?.stars).toBe(3);
    expect(result?.potions).toBe(2);
    expect(banked).toHaveLength(1);
    expect(['red_cap', 'moss', 'woad', 'ash']).toContain(banked[0]?.refund);
    // The refund is one of the items put in.
    expect(answer.counts[banked[0]?.refund ?? ''] ?? 0).toBeGreaterThan(0);
  });

  it('spoils a brew far off the colour: nothing is banked', () => {
    const { round, banked } = brew();
    for (let i = 0; i < 5; i++) round.add(WATER);
    const result = round.bottle();
    expect(result?.stars).toBe(0);
    expect(banked).toHaveLength(0);
  });

  it('logs start, drops, stirring, bottling and the end', async () => {
    const { round, logger } = brew();
    round.add('red_cap');
    stirAll(round);
    round.bottle();
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types).toEqual([
      'brewing.start',
      'brewing.drop',
      'brewing.stir',
      'brewing.bottle',
      'brewing.end',
    ]);
  });

  it('replays the same brew from the same seed', () => {
    const play = () => {
      const { round } = brew(42);
      round.add('red_cap');
      round.add('red_cap');
      round.add('moss');
      return { target: round.target, result: round.bottle() };
    };
    expect(play()).toEqual(play());
  });
});
