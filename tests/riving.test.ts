import { describe, expect, it } from 'vitest';
import {
  DEG,
  Press,
  RivingRound,
  bestPlan,
  cutLines,
  generateLog,
  openHeads,
  planFor,
  starsFor,
  wedgesOf,
  type PressSetup,
  type RivingEvent,
} from '../src/stations/rive';
import type { RivingLog } from '../src/data';
import { data, testLogger } from './helpers';

const rules = data.riving;
const feel = rules.feel;
const STEP = 1 / 60;

/** A plain test log, with these grains, checks and knots. */
function logWith(
  grains: RivingLog['grains'],
  checks: number[] = [],
  knots: RivingLog['knots'] = [],
): RivingLog {
  return { id: 'test_log', radius: 1, height: 1.6, rings: 12, checks, grains, knots };
}

/** A pull for a head like this one. */
function press(setup: Partial<PressSetup> = {}) {
  return new Press(() => feel, { count: 6, checkLines: 0, knotLines: 0, seed: 1, ...setup });
}

/**
 * Pulls `target` through, keeping the lever `lead` of the log ahead of the head, and leaning
 * `steer` times against where the bubble was `lag` seconds ago (0: no leaning).
 */
function pullThrough(target: Press, lead: number, steer = 0, lag = 0.25) {
  const seen: number[] = [];
  for (let t = 0; t < 30 && !target.through; t += STEP) {
    target.drag((target.progress + lead) * feel.leverTravel);
    seen.push(target.offset);
    const late = seen[Math.max(0, seen.length - 1 - Math.round(lag / STEP))] ?? 0;
    target.lean(Math.max(-1, Math.min(1, -late * steer)));
    target.tick(STEP);
  }
  return target;
}

/** Pieces lost on average over `runs` seeds. */
function averageLosses(setup: Partial<PressSetup>, lead: number, steer: number, runs = 100) {
  let losses = 0;
  for (let seed = 1; seed <= runs; seed++) {
    losses += pullThrough(press({ ...setup, seed }), lead, steer).losses;
  }
  return losses / runs;
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
    const capped = planFor(rules, logWith(log.grains.slice(0, 2)), 4, 60 * DEG);
    expect(capped.multiplier).toBe(rules.multiplierCap);
  });

  it('a knot spoils the wedge it touches; lost wedges take their grains with them', () => {
    const log = logWith([{ kind: 'gold', angle: 45, width: 10 }], [], [{ angle: 135, width: 10 }]);
    const plan = planFor(rules, log, 4, 0);
    expect(plan.knotted).toEqual([1]);
    expect(plan.staves).toBe(3);
    // Wedge 0 (0°–90°) holds the gold: lose it and the ×3 goes too.
    const lost = planFor(rules, log, 4, 0, [0]);
    expect(lost.staves).toBe(2);
    expect(lost.multiplier).toBe(1);
  });

  it('lines along checks are counted', () => {
    const log = logWith([], [90, 270]);
    expect(planFor(rules, log, 4, 0).checkLines).toBe(2);
    expect(planFor(rules, log, 4, 30 * DEG).checkLines).toBe(0);
  });

  it('the best split tries every open head at every turn', () => {
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
  it('the same seed gives the same log, with grains kept apart', () => {
    const one = generateLog(rules, 1234);
    expect(generateLog(rules, 1234)).toEqual(one);
    for (let seed = 1; seed <= 40; seed++) {
      const log = generateLog(rules, seed);
      expect(log.grains.length).toBeLessThanOrEqual(rules.generator.grains.max);
      expect(log.knots.length).toBeLessThanOrEqual(rules.generator.knots.max);
      log.grains.forEach((grain, index) => {
        expect(rules.grainKinds.map((kind) => kind.id)).toContain(grain.kind);
        for (const other of log.grains.slice(index + 1)) {
          const gap = Math.abs(((grain.angle - other.angle + 540) % 360) - 180);
          expect(gap).toBeGreaterThan((grain.width + other.width) / 2);
        }
      });
    }
  });
});

describe('the pull', () => {
  it('drives through, faster under more pressure', () => {
    const hard = pullThrough(press({ count: 4 }), 1, 3);
    const gentle = pullThrough(press({ count: 4 }), 0.05, 3);
    expect(hard.through && gentle.through).toBe(true);
    expect(hard.seconds).toBeLessThan(gentle.seconds);
    expect(hard.seconds).toBeGreaterThanOrEqual(feel.driveSeconds - 0.05);
  });

  it('more pieces wander more; checks calm it; knots shake it', () => {
    expect(press({ count: 12 }).wobble).toBeGreaterThan(press({ count: 4 }).wobble);
    expect(press({ count: 6, checkLines: 6 }).wobble).toBeLessThan(press({ count: 6 }).wobble);
    expect(press({ count: 6, knotLines: 1 }).wobble).toBeGreaterThan(press({ count: 6 }).wobble);
  });

  it('leaning against the bubble saves pieces; greedy heads still lose some', () => {
    expect(averageLosses({ count: 4 }, 1, 2.5)).toBe(0);
    expect(averageLosses({ count: 8 }, 1, 2.5)).toBeLessThan(averageLosses({ count: 8 }, 1, 0));
    expect(averageLosses({ count: 16 }, 0.1, 2.5)).toBeGreaterThan(0.5);
  });

  it('a lost piece starts the bubble again from the middle', () => {
    const target = press({ count: 6 });
    target.drag(feel.leverTravel * 0.2);
    target.lean(1);
    let result;
    for (let t = 0; t < 5 && result !== 'lost'; t += STEP) result = target.tick(STEP);
    expect(result).toBe('lost');
    expect(target.losses).toBe(1);
    expect(target.offset).toBe(0);
  });

  it('the same seed wanders the same way', () => {
    const one = pullThrough(press({ count: 10, seed: 9 }), 0.5);
    const two = pullThrough(press({ count: 10, seed: 9 }), 0.5);
    expect(two.offset).toBe(one.offset);
    expect(two.losses).toBe(one.losses);
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

  /** Strikes, then pulls the head through, leaning `steer` times against the bubble. */
  function rive(round: RivingRound, lead = 0.2, steer = 3) {
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    for (let t = 0; t < 30 && round.phase.kind === 'press'; t += STEP) {
      const phase = round.phase;
      round.drag((phase.press.progress + lead) * feel.leverTravel);
      round.lean(-phase.press.offset * steer);
      round.tick(STEP);
    }
  }

  it('pick a head, turn the cuts, strike and pull: the log banks staves × grains, plus stars', async () => {
    const log = logWith([{ kind: 'gold', angle: 45, width: 10 }]);
    const { round, banked, events, logger } = setup(log);
    round.choose(4);
    round.turnTo(0);
    expect(round.plan.worth).toBe(12);
    rive(round);
    expect(round.phase.kind).toBe('done');
    const done = events.find((event) => event.type === 'done');
    if (done?.type !== 'done') throw new Error('No done event');
    // The best on 4–6 heads: a 6-way keeping the gold, 18. 12 is 2 stars (two-thirds).
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

  it('the best split with a clean pull gets 3 stars', () => {
    const log = logWith([{ kind: 'silver', angle: 100, width: 14 }]);
    const { round, events } = setup(log);
    round.choose(round.best.count);
    round.turnTo(round.best.rotation);
    rive(round, 0.05, 3);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type === 'done' && done.stars).toBe(3);
  });

  it('pieces lost in the pull are gone, with any grain in them', () => {
    const { round, events } = setup(logWith([]), [4, 5, 6, 16]);
    round.choose(16);
    rive(round, 1, 0);
    const lost = events.filter((event) => event.type === 'lost');
    expect(lost.length).toBeGreaterThan(0);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type === 'done' && done.plan.staves).toBe(16 - lost.length);
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
