import { describe, expect, it } from 'vitest';
import {
  DEG,
  Pump,
  RivingRound,
  bestPlan,
  cutLines,
  generateLog,
  openHeads,
  planFor,
  snapTurn,
  starsFor,
  survey,
  wedgesOf,
  type RivingEvent,
} from '../src/stations/rive';
import type { RivingLog } from '../src/data';
import { data, testLogger } from './helpers';

const rules = data.riving;
const feel = rules.feel;
const STEP = 1 / 60;

/** A plain test log, with these grains and knots. */
function logWith(grains: RivingLog['grains'], knots: RivingLog['knots'] = []): RivingLog {
  return { id: 'test_log', radius: 1, height: 1.6, rings: 12, grains, knots };
}

/** A pump for a `count`-way head among 4- to 16-way heads. */
function pump(count = 6) {
  return new Pump(() => feel, count, 4, 16);
}

/** Pumps `target` through: full swipes down and back up. */
function pumpThrough(target: Pump) {
  for (let stroke = 0; stroke < 20 && !target.through; stroke++) {
    target.pull(feel.pumpTravel);
    target.pull(0);
  }
  return target;
}

describe('the cut pattern', () => {
  it('a head cuts evenly spaced lines and makes that many equal wedges', () => {
    const lines = cutLines(6, 10 * DEG);
    expect(lines.map((line) => Math.round(line / DEG))).toEqual([10, 70, 130, 190, 250, 310]);
    const wedges = wedgesOf(4, 0);
    expect(wedges).toHaveLength(4);
    expect(wedges.every((wedge) => Math.abs(wedge.width - 90 * DEG) < 1e-9)).toBe(true);
  });

  it('a line through a grain cancels it; grains kept whole multiply every stave together', () => {
    const log = logWith([
      { kind: 'gold', angle: 45, width: 10 },
      { kind: 'rot', angle: 135, width: 10 },
      { kind: 'silver', angle: 225, width: 10 },
    ]);
    // A 4-way at 0°: lines at 0, 90, 180, 270 miss every grain: 4 × 3 × ½ × 2 = 12.
    const clear = planFor(rules, log, 4, 0);
    expect(clear.cut).toEqual([]);
    expect(clear.staves).toBe(4);
    expect(clear.multiplier).toBe(3);
    expect(clear.worth).toBe(12);
    // Turned 45°: a line runs through every grain.
    expect(planFor(rules, log, 4, 45 * DEG).cut).toEqual([0, 1, 2]);
    // A 6-way turned to 135°: only the rot is cut out.
    const rotOut = planFor(rules, log, 6, 135 * DEG);
    expect(rotOut.cut).toEqual([1]);
    expect(rotOut.worth).toBe(6 * Math.min(6, rules.multiplierCap));
  });

  it('multipliers are capped, and a fraction rounds down', () => {
    const log = logWith([
      { kind: 'gold', angle: 20, width: 10 },
      { kind: 'gold', angle: 110, width: 10 },
      { kind: 'rot', angle: 240, width: 10 },
    ]);
    // ×3 × 3 × ½ = 4½: 5 × 4½ = 22½, banked as 22.
    const plan = planFor(rules, log, 5, 60 * DEG);
    expect(plan.cut).toEqual([]);
    expect(plan.multiplier).toBe(4.5);
    expect(plan.worth).toBe(22);
    const four = [20, 110, 200, 290].map((angle) => ({ kind: 'gold', angle, width: 10 }));
    const capped = planFor(rules, logWith(four), 4, 60 * DEG);
    expect(capped.multiplier).toBe(Math.min(81, rules.multiplierCap));
  });

  it('a knot spoils the wedge it touches', () => {
    const log = logWith([{ kind: 'gold', angle: 45, width: 10 }], [{ angle: 135, width: 10 }]);
    const plan = planFor(rules, log, 4, 0);
    expect(plan.knotted).toEqual([1]);
    expect(plan.staves).toBe(3);
  });

  it('turns snap to whole steps, all the way round', () => {
    expect(snapTurn(rules, 30.4 * DEG) / DEG).toBeCloseTo(30);
    expect(snapTurn(rules, 30.6 * DEG) / DEG).toBeCloseTo(31);
    expect(snapTurn(rules, 359.7 * DEG)).toBeCloseTo(0);
    expect(snapTurn(rules, -1 * DEG) / DEG).toBeCloseTo(359);
  });

  it('the best split tries every open head at every whole step of turn', () => {
    // Gold and silver 90° apart: a 4-way keeps both (×6 = 24); a 6-way can't fit lines past
    // both without cutting one, so the 4-way wins on 4-6 heads.
    const log = logWith([
      { kind: 'gold', angle: 45, width: 20 },
      { kind: 'silver', angle: 135, width: 20 },
    ]);
    const best = bestPlan(rules, log, [4, 5, 6]);
    expect(best.worth).toBeGreaterThanOrEqual(24);
    expect(best.cut).toEqual([]);
    expect(bestPlan(rules, log, [4, 5, 6])).toEqual(best);
    // A plain log: the most pieces wins.
    expect(bestPlan(rules, logWith([]), [4, 5, 6]).count).toBe(6);
    // A 7-way's lines never land on whole steps again, so it's tried all the way round.
    const seven = bestPlan(rules, logWith([{ kind: 'gold', angle: 300, width: 12 }]), [7]);
    expect(Math.abs(seven.rotation / DEG - Math.round(seven.rotation / DEG))).toBeLessThan(1e-6);
    expect(seven.multiplier).toBe(3);
  });

  it('leeway: the most degrees in a row a head keeps 3 stars', () => {
    // A 4-way keeps 3 stars over a 20° silver while every line misses it (a line on its edge
    // misses): 55° to 125°, 71 whole steps.
    const log = logWith([{ kind: 'silver', angle: 45, width: 20 }]);
    const { leeway } = survey(rules, log, [4]);
    expect(leeway).toBe(71);
    // A line through the rot (81°–89°) puts the opposite one through the gold at 260°–268°
    // until 88°: 3 stars hangs on 88° and 89°.
    const tight = logWith([
      { kind: 'rot', angle: 85, width: 10 },
      { kind: 'gold', angle: 264, width: 8 },
    ]);
    expect(survey(rules, tight, [4]).leeway).toBe(2);
  });

  it('stars are shares of the best, and heads open by level', () => {
    expect(starsFor(rules, 100, 100)).toBe(3);
    expect(starsFor(rules, Math.ceil(100 * rules.stars.two), 100)).toBe(2);
    expect(starsFor(rules, Math.ceil(100 * rules.stars.one), 100)).toBe(1);
    expect(starsFor(rules, 0, 100)).toBe(0);
    const first = openHeads(rules, 1);
    expect(first).toEqual(
      rules.cutters.filter((cutter) => cutter.level === 1).map((cutter) => cutter.count),
    );
    expect(openHeads(rules, 99)).toHaveLength(rules.cutters.length);
  });
});

describe('random logs', () => {
  const heads = [4, 5, 6];
  const value = (kind: string) => rules.grainKinds.find((entry) => entry.id === kind);

  it('the same seed gives the same log: good and bad grains, each as wide as its kind allows', () => {
    const one = generateLog(rules, 1234, heads);
    expect(generateLog(rules, 1234, heads)).toEqual(one);
    for (let seed = 1; seed <= 40; seed++) {
      const log = generateLog(rules, seed, heads);
      const good = log.grains.filter((grain) => (value(grain.kind)?.multiplier ?? 1) > 1);
      const bad = log.grains.filter((grain) => (value(grain.kind)?.multiplier ?? 1) < 1);
      expect(good.length).toBeGreaterThanOrEqual(1);
      expect(bad.length).toBeGreaterThanOrEqual(1);
      expect(good.length).toBeLessThanOrEqual(rules.generator.good.max);
      expect(bad.length).toBeLessThanOrEqual(rules.generator.bad.max);
      log.grains.forEach((grain, index) => {
        const kind = value(grain.kind);
        expect(grain.width).toBeGreaterThanOrEqual(Math.floor(kind?.width.min ?? 0));
        expect(grain.width).toBeLessThanOrEqual(Math.ceil(kind?.width.max ?? 0));
        for (const other of log.grains.slice(index + 1)) {
          const gap = Math.abs(((grain.angle - other.angle + 540) % 360) - 180);
          expect(gap).toBeGreaterThan((grain.width + other.width) / 2);
        }
      });
    }
  });

  it('a wide grain only fits a head with few pieces', () => {
    // A 60° gold can't sit inside an 8-way's 45° wedges, but fits a 5-way's 72°.
    const log = logWith([{ kind: 'gold', angle: 90, width: 60 }]);
    expect(bestPlan(rules, log, [8]).multiplier).toBe(1);
    expect(bestPlan(rules, log, [5]).multiplier).toBe(3);
    expect(bestPlan(rules, log, [5, 8]).count).toBe(5);
  });

  it('most logs are a real choice you can find: the biggest head often is not the best', () => {
    let notBiggest = 0;
    let easy = 0;
    let fiddly = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const log = generateLog(rules, seed * 7919, heads);
      const result = survey(rules, log, heads);
      if (result.best.count !== 6) notBiggest += 1;
      if (result.easy > rules.generator.easyShare) easy += 1;
      if (result.leeway < rules.generator.leeway) fiddly += 1;
    }
    expect(notBiggest).toBeGreaterThan(12);
    expect(easy).toBeLessThan(10);
    expect(fiddly).toBeLessThanOrEqual(1);
  });
});

describe('the pump', () => {
  it('each full swipe down is a stroke; the last one goes through', () => {
    const target = pump(4);
    expect(target.strokes).toBe(feel.pumpsFew);
    expect(target.pull(feel.pumpTravel / 2)).toBeUndefined();
    expect(target.handle).toBeCloseTo(0.5);
    expect(target.pull(feel.pumpTravel)).toBe('stroke');
    expect(target.done).toBe(1);
    // Held at the bottom, it doesn't stroke again until the handle comes back up.
    expect(target.pull(feel.pumpTravel * 3)).toBeUndefined();
    expect(target.done).toBe(1);
    pumpThrough(target);
    expect(target.through).toBe(true);
    expect(target.progress).toBe(1);
  });

  it('past the bottom stop, the finger carries the stroke: back up a little re-arms it', () => {
    const target = pump(4);
    target.pull(feel.pumpTravel * 3);
    // Halfway back up from where the finger got to, not from where it started.
    target.pull(feel.pumpTravel * 2.5);
    expect(target.handle).toBeCloseTo(0.5);
    expect(target.pull(feel.pumpTravel * 3)).toBe('stroke');
  });

  it('lifting the finger re-arms it too', () => {
    const target = pump(4);
    target.pull(feel.pumpTravel);
    target.release();
    expect(target.handle).toBe(0);
    expect(target.pull(feel.pumpTravel)).toBe('stroke');
    expect(target.done).toBe(2);
  });

  it('more pieces take more strokes', () => {
    expect(pump(16).strokes).toBe(feel.pumpsMany);
    expect(pump(10).strokes).toBeGreaterThanOrEqual(feel.pumpsFew);
    expect(pump(10).strokes).toBeLessThanOrEqual(feel.pumpsMany);
  });
});

describe('RivingRound', () => {
  function setup(log: RivingLog, heads = [4, 5, 6], seed = 7) {
    const { logger } = testLogger();
    const events: RivingEvent[] = [];
    let banked: { worth: number; staves: number } | undefined;
    const round = new RivingRound(
      log,
      {
        logger,
        feel: () => feel,
        rules,
        heads,
        bank: (worth, staves) => {
          banked = { worth, staves };
          return worth;
        },
        onEvent: (event) => events.push(event),
      },
      seed,
    );
    return { round, logger, events, banked: () => banked };
  }

  /** Strikes, then pumps the head through. */
  function rive(round: RivingRound) {
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    for (let stroke = 0; stroke < 20 && round.phase.kind === 'pump'; stroke++) {
      round.pull(feel.pumpTravel);
      round.release();
      round.tick(STEP);
    }
  }

  it('pick a head, turn the cuts, strike and pump: the log banks staves × grains, plus stars', async () => {
    const log = logWith([{ kind: 'gold', angle: 45, width: 10 }]);
    const { round, banked, events, logger } = setup(log);
    round.choose(4);
    round.turnTo(0);
    expect(round.plan.worth).toBe(12);
    rive(round);
    expect(round.phase.kind).toBe('done');
    const strokes = events.filter((event) => event.type === 'stroke');
    expect(strokes).toHaveLength(feel.pumpsFew - 1);
    const done = events.find((event) => event.type === 'done');
    if (done?.type !== 'done') throw new Error('No done event');
    // The best on 4–6 heads: a 6-way keeping the gold, 18. 12 is two-thirds of it.
    expect(done.best.worth).toBe(18);
    expect(done.stars).toBe(starsFor(rules, 12, 18));
    const bonus =
      done.stars >= 3 ? rules.starBonus.three : done.stars >= 2 ? rules.starBonus.two : 0;
    expect(banked()).toEqual({ worth: 12 + Math.floor(12 * bonus), staves: 4 });
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining(['riving.logStart', 'riving.strike', 'riving.logEnd']),
    );
  });

  it('the best split gets 3 stars, and every piece comes out', () => {
    const log = logWith([{ kind: 'silver', angle: 100, width: 14 }]);
    const { round, events } = setup(log);
    round.choose(round.best.count);
    round.turnTo(round.best.rotation);
    rive(round);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type === 'done' && done.stars).toBe(3);
    expect(done?.type === 'done' && done.plan.staves).toBe(round.best.count);
  });

  it('the cuts turn in whole steps, from the start', () => {
    const { round } = setup(logWith([]));
    const whole = (radians: number) => Math.abs(radians / DEG - Math.round(radians / DEG));
    expect(whole(round.rotation)).toBeLessThan(1e-6);
    round.turnTo(30.4 * DEG);
    expect(round.rotation / DEG).toBeCloseTo(30);
    round.nudge(1);
    expect(round.rotation / DEG).toBeCloseTo(31);
    round.nudge(-1);
    round.nudge(-1);
    expect(round.rotation / DEG).toBeCloseTo(29);
  });

  it('only open heads can be picked, and only while planning', () => {
    const { round } = setup(logWith([]));
    round.choose(16);
    expect(round.count).not.toBe(16);
    round.choose(5);
    expect(round.count).toBe(5);
    round.strike();
    round.choose(4);
    round.turnTo(1);
    expect(round.count).toBe(5);
  });

  it('leaving mid-log banks nothing', async () => {
    const { round, logger, banked } = setup(logWith([]));
    round.exit();
    expect(banked()).toBeUndefined();
    expect((await logger.readAll()).map((event) => event.type)).toContain('riving.leave');
  });
});
