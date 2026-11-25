import { describe, expect, it } from 'vitest';
import {
  FiremakingRound,
  allFuelings,
  bestPull,
  doneness,
  fuelHeat,
  fullRackAnswers,
  generateFire,
  hardenAt,
  heatWith,
  nextLayers,
  openRacks,
  rackRules,
  starBonusSpears,
  starsFor,
  stavesOver,
  type Fire,
  type FiremakingEvent,
} from '../src/stations/firemaking';
import { data, testLogger } from './helpers';

const rules = data.firemaking;
/** The starting rack: 3 spots under 6 staves. */
const fr = rackRules(rules, 3);
const feel = rules.feel;
const STEP = 1 / 60;

/** A plain fire with these coals under each stave. */
function fireOf(base: number[]): Fire {
  return { seed: 1, base, answer: new Array<number>(fr.rack.spots).fill(0) };
}

/** A round over `fire`, recording its events and what it banked. */
function roundOver(fire: Fire, { staves = fr.rack.staves, layers = 1, logs = 99 } = {}) {
  const events: FiremakingEvent[] = [];
  const banked = { hardened: 0, charred: 0, burned: 0, bonus: 0 };
  const { logger } = testLogger();
  const round = new FiremakingRound(
    fire,
    fr,
    {
      logger,
      feel: () => feel,
      rules,
      logsAvailable: logs,
      burn: (count) => {
        banked.burned += count;
      },
      bank: (hardened, charred, bonus) => {
        banked.hardened += hardened;
        banked.charred += charred;
        banked.bonus += bonus;
        return hardened + bonus;
      },
      onEvent: (event) => events.push(event),
    },
    staves,
    layers,
  );
  return { round, events, banked, logger };
}

/** Cooks until `seconds` after the rack went on. */
function cookTo(round: FiremakingRound, seconds: number) {
  while (round.phase.kind === 'cook' && round.cooked < seconds - 1e-9) round.tick(STEP);
}

describe('the fire', () => {
  it('puts each spot under its own staves', () => {
    expect(stavesOver(fr, 0)).toEqual([0, 1]);
    expect(stavesOver(fr, 2)).toEqual([4, 5]);
  });

  it('heats a spot’s own staves a lot and spills a little onto the nearest each side', () => {
    const added = fuelHeat(fr, feel, [0, 2, 0]);
    expect(added).toEqual([
      0,
      2 * feel.spill,
      2 * feel.heatPerLog,
      2 * feel.heatPerLog,
      2 * feel.spill,
      0,
    ]);
  });

  it('cooks hotter staves faster, so their pull window is shorter', () => {
    const cool = hardenAt(fr, feel, 8);
    const hot = hardenAt(fr, feel, 12);
    expect(hot).toBeLessThan(cool);
    expect(hot * (feel.charRatio - 1)).toBeLessThan(cool * (feel.charRatio - 1));
    expect(doneness(fr, feel, 12, hot)).toBeCloseTo(1);
  });

  it('hardens the whole rack only when the hottest stave is under charRatio × the coldest', () => {
    const even = bestPull(fr, feel, [10, 10.5, 11, 11, 10.5, 10]);
    expect(even.hardened).toBe(6);
    expect(even.window).toBeGreaterThan(0);
    const lumpy = bestPull(fr, feel, [6, 6, 10, 10, 10, 10]);
    expect(lumpy.hardened).toBe(4);
    expect(lumpy.window).toBe(0);
    expect(lumpy.finishes).toEqual([
      'under',
      'under',
      'hardened',
      'hardened',
      'hardened',
      'hardened',
    ]);
  });

  it('can be evened out with fuel', () => {
    const fire = fireOf([10, 10, 5, 5, 10, 10]);
    expect(bestPull(fr, feel, fire.base).hardened).toBeLessThan(6);
    const answers = fullRackAnswers(fr, feel, fire);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0]?.logs[1]).toBe(2);
  });

  it('tries every way of filling the spots', () => {
    expect(allFuelings(fr)).toHaveLength((fr.rack.maxLogs + 1) ** fr.rack.spots);
  });

  it('always makes a fire with a full-rack answer that needs planned fuel, the same for a seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const fire = generateFire(fr, feel, seed);
      expect(fire.base).toHaveLength(fr.rack.staves);
      expect(Math.min(...fire.base)).toBeGreaterThanOrEqual(rules.generator.minHeat);
      const answer = bestPull(fr, feel, heatWith(fr, feel, fire, fire.answer));
      expect(answer.hardened).toBe(fr.rack.staves);
      expect(answer.window).toBeGreaterThanOrEqual(rules.generator.minWindow - 1e-9);
      expect(bestPull(fr, feel, fire.base).hardened).toBeLessThan(fr.rack.staves);
      const fullUp = new Array<number>(fr.rack.spots).fill(fr.rack.maxLogs);
      const maxed = bestPull(fr, feel, heatWith(fr, feel, fire, fullUp));
      expect(maxed.hardened).toBeLessThan(fr.rack.staves);
    }
    expect(generateFire(fr, feel, 42)).toEqual(generateFire(fr, feel, 42));
  });
});

describe('rack sizes', () => {
  it('grows a spot and 2 staves every 5 levels, from 3 spots up to 9 at 30', () => {
    expect(openRacks(rules, 1)).toEqual([3]);
    expect(openRacks(rules, 4)).toEqual([3]);
    expect(openRacks(rules, 5)).toEqual([3, 4]);
    expect(openRacks(rules, 30)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(openRacks(rules, 99)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(rackRules(rules, 9).rack).toMatchObject({ spots: 9, staves: 18 });
  });

  it('makes fair fires at every size', () => {
    for (const size of rules.rack.sizes) {
      const sized = rackRules(rules, size.spots);
      const { staves, spots, maxLogs } = sized.rack;
      for (let seed = 1; seed <= 60; seed++) {
        const fire = generateFire(sized, feel, seed);
        expect(fire.base).toHaveLength(staves);
        const answer = bestPull(sized, feel, heatWith(sized, feel, fire, fire.answer));
        expect(answer.hardened).toBe(staves);
        expect(answer.window).toBeGreaterThanOrEqual(rules.generator.minWindow - 1e-9);
        expect(bestPull(sized, feel, fire.base).hardened).toBeLessThan(staves);
        const fullUp = new Array<number>(spots).fill(maxLogs);
        expect(bestPull(sized, feel, heatWith(sized, feel, fire, fullUp)).hardened).toBeLessThan(
          staves,
        );
      }
    }
  });

  it('logs every answer only on racks small enough to search', async () => {
    const big = rackRules(rules, 9);
    const { logger } = testLogger();
    const hooks = {
      logger,
      feel: () => feel,
      rules,
      logsAvailable: 0,
      burn: () => undefined,
      bank: () => 0,
    };
    new FiremakingRound(generateFire(big, feel, 3), big, hooks, 18, 1);
    new FiremakingRound(generateFire(fr, feel, 3), fr, hooks, 6, 1);
    const [bigStart, smallStart] = await logger.readAll();
    expect(bigStart?.data).toMatchObject({ spots: 9 });
    expect(bigStart?.data).not.toHaveProperty('answers');
    expect(smallStart?.data).toHaveProperty('answers');
  });
});

describe('a rack', () => {
  it('cycles a spot 0 → 1 → 2 → 0 logs, never more than the warchest has', () => {
    const { round } = roundOver(fireOf([10, 10, 10, 10, 10, 10]), { logs: 3 });
    round.tapSpot(0);
    round.tapSpot(0);
    expect(round.logs).toEqual([2, 0, 0]);
    round.tapSpot(0);
    expect(round.logs).toEqual([0, 0, 0]);
    round.tapSpot(1);
    round.tapSpot(1);
    round.tapSpot(2);
    expect(round.logs).toEqual([0, 2, 1]);
    round.tapSpot(2);
    expect(round.logs).toEqual([0, 2, 0]);
  });

  it('burns the fuel when it goes on, and the fuel can’t change after', () => {
    const { round, banked, events } = roundOver(fireOf([10, 10, 5, 5, 10, 10]));
    round.tapSpot(1);
    round.tapSpot(1);
    round.lay();
    expect(banked.burned).toBe(2);
    expect(events.map((event) => event.type)).toEqual(['fuel', 'fuel', 'lay']);
    round.tapSpot(0);
    expect(round.logs).toEqual([0, 2, 0]);
  });

  it('pulled at the best moment hardens the whole rack for 3 stars', () => {
    const { round, banked, events } = roundOver(fireOf([10, 10, 5, 5, 10, 10]));
    round.tapSpot(1);
    round.tapSpot(1);
    const best = round.preview;
    expect(best.hardened).toBe(6);
    round.lay();
    cookTo(round, best.at + best.window / 2);
    round.pull();
    const pulled = events.at(-1);
    const bonus = Math.round(6 * rules.starBonus.three);
    expect(pulled).toMatchObject({ type: 'pulled', hardened: 6, under: 0, charred: 0, stars: 3 });
    expect(pulled).toMatchObject({ bonus, banked: 6 + bonus });
    expect(banked).toMatchObject({ hardened: 6, bonus });
    expect(round.phase.kind).toBe('done');
    // Off the fire, the staves stay as they came out.
    const done = round.doneness(0);
    expect(done).toBeGreaterThanOrEqual(1);
    round.tick(5);
    expect(round.doneness(0)).toBe(done);
  });

  it('pulled early leaves staves underdone, which cost stars but aren’t lost', () => {
    const { round, banked, events } = roundOver(fireOf([10, 10, 10, 10, 10, 9]));
    round.lay();
    cookTo(round, hardenAt(fr, feel, 10) + 0.05);
    round.pull();
    expect(events.at(-1)).toMatchObject({ hardened: 5, under: 1, charred: 0, stars: 2 });
    expect(banked).toMatchObject({ hardened: 5, charred: 0 });
  });

  it('left on, burns: charred staves are lost, and it comes off on its own', () => {
    const { round, banked, events } = roundOver(fireOf([10, 10, 10, 10, 10, 10]));
    round.lay();
    cookTo(round, 60);
    expect(round.phase.kind).toBe('done');
    expect(events.at(-1)).toMatchObject({ hardened: 0, charred: 6, stars: 1, burnt: true });
    expect(banked.charred).toBe(6);
  });

  it('stacks layers that cook the same, with stars from one layer', () => {
    const { round, events } = roundOver(fireOf([10, 10, 10, 10, 10, 9]), {
      staves: 10,
      layers: 2,
    });
    round.lay();
    cookTo(round, hardenAt(fr, feel, 10) + 0.05);
    round.pull();
    // Column 5 is underdone in the bottom layer; the top layer only has columns 0–3.
    expect(events.at(-1)).toMatchObject({ hardened: 9, under: 1, stars: 2 });
  });

  it('logs the start, the lay and the end with the feel values', async () => {
    const { round, logger } = roundOver(fireOf([10, 10, 10, 10, 10, 10]));
    round.lay();
    round.pull();
    const events = await logger.readAll();
    expect(events.map((event) => event.type)).toEqual([
      'firemaking.rackStart',
      'firemaking.lay',
      'firemaking.rackEnd',
    ]);
    expect(events[0]?.data).toMatchObject({ feel });
  });
});

describe('stars and the hot streak', () => {
  it('pays bonus spears for 2 and 3 stars, none for 1', () => {
    expect(starBonusSpears(rules, 20, 3)).toBe(Math.round(20 * rules.starBonus.three));
    expect(starBonusSpears(rules, 20, 2)).toBe(Math.round(20 * rules.starBonus.two));
    expect(starBonusSpears(rules, 20, 1)).toBe(0);
  });

  it('counts staves that didn’t harden', () => {
    expect(starsFor(rules, 0, 6)).toBe(3);
    expect(starsFor(rules, 2, 6)).toBe(2);
    expect(starsFor(rules, 3, 6)).toBe(1);
    // A third of a bigger rack's layer, too.
    expect(starsFor(rules, 6, 18)).toBe(2);
    expect(starsFor(rules, 7, 18)).toBe(1);
  });

  it('stacks deeper after 3 stars, up to the cap, and starts again after less', () => {
    expect(nextLayers(1, 3, 3)).toBe(2);
    expect(nextLayers(2, 3, 3)).toBe(3);
    expect(nextLayers(3, 3, 3)).toBe(3);
    expect(nextLayers(3, 2, 3)).toBe(1);
    expect(nextLayers(1, 3, 1)).toBe(1);
  });
});
