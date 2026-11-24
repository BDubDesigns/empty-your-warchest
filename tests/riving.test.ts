import { describe, expect, it } from 'vitest';
import {
  DEG,
  Lever,
  RivingRound,
  alongCheck,
  generateLog,
  grainsCut,
  grainsKept,
  logMultiplier,
  middle,
  sizeOf,
  splitPiece,
  throughKnot,
  touchesKnot,
  splittable,
  thinSide,
  unevenness,
  wholeLog,
  type LeverSetup,
  type RivingEvent,
} from '../src/stations/rive';
import type { RivingLog } from '../src/data';
import { data, testLogger } from './helpers';

const rules = data.riving;
const feel = rules.feel;
const STEP = 1 / 60;
/** A steady lever: about one log length a second. */
const steady = 1;

/** A plain test log, with these grains and knots. */
function logWith(
  grains: RivingLog['grains'],
  checks: number[] = [],
  knots: RivingLog['knots'] = [],
): RivingLog {
  return { id: 'test_log', radius: 1, height: 1.6, rings: 12, checks, grains, knots };
}

/** A lever for a split like this one. */
function lever(setup: Partial<LeverSetup> = {}) {
  return new Lever(() => feel, {
    unevenness: 0,
    width: 180,
    onCheck: false,
    throughKnot: false,
    seed: 1,
    ...setup,
  });
}

/**
 * Levers at a steady `speed` (log lengths a second) until the lever ends, leaning `steer` times
 * against wherever the bubble has drifted (0: no leaning).
 */
function leverAt(target: Lever, speed: number, steer = 0, seconds = 5) {
  let pixels = 0;
  for (let t = 0; t < seconds && !target.result; t += STEP) {
    pixels += speed * feel.leverTravel * STEP;
    target.drag(pixels);
    target.lean(-target.offset * steer);
    target.tick(STEP);
  }
  return target.result;
}

describe('pieces', () => {
  it('the first split crosses the whole log; later ones halve a piece along a radius', () => {
    const [a, b] = splitPiece(wholeLog(), 10 * DEG);
    expect(a.width).toBeCloseTo(Math.PI);
    expect(b.start).toBeCloseTo(190 * DEG);
    const [c, d] = splitPiece(a, 100 * DEG);
    expect(c.width).toBeCloseTo(90 * DEG);
    expect(d.width).toBeCloseTo(90 * DEG);
    expect(d.depth).toBe(2);
  });

  it('a piece is kindling, a stave or a slab by its width; uneven splits know their thin side', () => {
    const piece = (degrees: number) => ({ id: 'p', start: 0, width: degrees * DEG, depth: 1 });
    expect(sizeOf(rules, piece(rules.stave.min - 1))).toBe('kindling');
    expect(sizeOf(rules, piece(45))).toBe('stave');
    expect(sizeOf(rules, piece(90))).toBe('slab');
    // An even eighth can still be split into two staves; a thinner stave can't.
    expect(splittable(rules, piece(45))).toBe(true);
    expect(splittable(rules, piece(30))).toBe(false);
    const quarter = piece(90);
    expect(unevenness(quarter, 45 * DEG)).toBeCloseTo(0);
    expect(unevenness(quarter, 30 * DEG)).toBeCloseTo(1 / 3);
    expect(thinSide(splitPiece(quarter, 30 * DEG))).toBe(0);
    expect(unevenness(wholeLog(), 37 * DEG)).toBe(0);
  });

  it('a line through a grain cuts it; grains whole in kept staves multiply the log together', () => {
    const log = logWith([
      { kind: 'gold', angle: 22.5, width: 10 },
      { kind: 'silver', angle: 200, width: 12 },
      { kind: 'silver', angle: 300, width: 10 },
    ]);
    const live = new Set([0, 1, 2]);
    expect(grainsCut(log, wholeLog(), 20 * DEG, live)).toEqual([0, 1]);
    expect(grainsCut(log, wholeLog(), 60 * DEG, live)).toEqual([]);
    const staves = [
      { id: 'x', start: 0, width: 45 * DEG, depth: 3 },
      { id: 'y', start: 180 * DEG, width: 45 * DEG, depth: 3 },
      { id: 'z', start: 270 * DEG, width: 45 * DEG, depth: 3 },
    ];
    const kept = grainsKept(log, staves, live);
    expect(kept).toEqual([0, 1, 2]);
    // ×3 × 2 × 2 = ×12, capped.
    expect(logMultiplier(rules, log, kept)).toBe(Math.min(12, rules.multiplierCap));
    // A grain in a piece that wasn't kept doesn't count.
    expect(grainsKept(log, staves.slice(0, 1), live)).toEqual([0]);
    expect(logMultiplier(rules, log, [0])).toBe(3);
  });

  it('a knot spoils any piece it touches; a line through it knows it', () => {
    const log = logWith([], [], [{ angle: 30, width: 10 }]);
    expect(touchesKnot(log, { id: 'a', start: 0, width: 45 * DEG, depth: 3 })).toBe(true);
    // Just touching its edge counts.
    expect(touchesKnot(log, { id: 'b', start: 34 * DEG, width: 45 * DEG, depth: 3 })).toBe(true);
    expect(touchesKnot(log, { id: 'c', start: 40 * DEG, width: 45 * DEG, depth: 3 })).toBe(false);
    expect(throughKnot(log, wholeLog(), 30 * DEG)).toBe(true);
    expect(throughKnot(log, wholeLog(), 60 * DEG)).toBe(false);
  });

  it('a split along a check knows it', () => {
    const log = logWith([], [100, 280]);
    expect(alongCheck(rules, log, wholeLog(), 100 * DEG)).toBe(true);
    expect(alongCheck(rules, log, wholeLog(), 130 * DEG)).toBe(false);
  });
});

describe('random logs', () => {
  it('the same seed gives the same log, with grains and knots kept apart', () => {
    const one = generateLog(rules, 1234);
    expect(generateLog(rules, 1234)).toEqual(one);
    const apart = (a: { angle: number; width: number }, b: { angle: number; width: number }) =>
      Math.abs(((a.angle - b.angle + 540) % 360) - 180) - (a.width + b.width) / 2;
    let hard = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const log = generateLog(rules, seed);
      expect(log.grains.length).toBeLessThanOrEqual(rules.generator.grains.max);
      expect(log.knots.length).toBeGreaterThanOrEqual(rules.generator.knots.min);
      expect(log.knots.length).toBeLessThanOrEqual(rules.generator.knots.max);
      const marks = [...log.grains, ...log.knots];
      marks.forEach((mark, index) => {
        for (const other of marks.slice(index + 1)) expect(apart(mark, other)).toBeGreaterThan(0);
      });
      log.grains.forEach((grain) => {
        expect(rules.grainKinds.map((kind) => kind.id)).toContain(grain.kind);
      });
      // Hard: a grain too close to a knot to fit a stave between them.
      const close = log.grains.some((grain) =>
        log.knots.some((knot) => apart(grain, knot) < rules.stave.min),
      );
      if (close) hard++;
    }
    // Most logs make you choose; some are easy.
    expect(hard).toBeGreaterThan(20);
    expect(hard).toBeLessThan(55);
  });
});

describe('levering', () => {
  it('an even split runs straight: no leaning needed', () => {
    expect(leverAt(lever(), steady)).toBe('clean');
  });

  it('an uneven split pulls to the thin side: lean against it or it runs out', () => {
    const uneven = { unevenness: 0.5 };
    expect(leverAt(lever(uneven), steady)).toBe('thin');
    expect(leverAt(lever(uneven), steady, 4)).toBe('clean');
  });

  it('leaning too hard runs it out to the thick side', () => {
    const target = lever();
    let pixels = 0;
    for (let t = 0; t < 5 && !target.result; t += STEP) {
      pixels += steady * feel.leverTravel * STEP;
      target.drag(pixels);
      target.lean(-1);
      target.tick(STEP);
    }
    expect(target.result).toBe('thick');
  });

  it('faster pulls harder; a check pulls less; a knot pulls more; narrow pieces and knots wobble', () => {
    const slow = lever({ unevenness: 0.3 });
    const fast = lever({ unevenness: 0.3 });
    leverAt(slow, 0.5, 0, 0.3);
    leverAt(fast, 2, 0, 0.3);
    expect(fast.pull).toBeGreaterThan(slow.pull);
    expect(lever({ unevenness: 0.3, onCheck: true }).pull).toBeLessThan(
      lever({ unevenness: 0.3 }).pull,
    );
    expect(lever({ width: 180 }).wobble).toBe(0);
    expect(lever({ width: 45 }).wobble).toBeGreaterThan(0);
    expect(lever({ unevenness: 0.3, throughKnot: true }).pull).toBeGreaterThan(
      lever({ unevenness: 0.3 }).pull,
    );
    expect(lever({ throughKnot: true }).wobble).toBeGreaterThan(0);
  });

  it('the same seed wobbles the same way', () => {
    const one = lever({ width: 40, seed: 9 });
    const two = lever({ width: 40, seed: 9 });
    leverAt(one, steady, 0, 0.6);
    leverAt(two, steady, 0, 0.6);
    expect(two.offset).toBe(one.offset);
  });
});

describe('RivingRound', () => {
  function setup(log: RivingLog, seed = 7) {
    const { logger } = testLogger();
    const events: RivingEvent[] = [];
    let banked: { worth: number; staves: number } | undefined;
    const round = new RivingRound(
      log,
      {
        logger,
        feel: () => feel,
        rules,
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

  /**
   * Aims the current split at `angle` (default: the piece's middle), strikes, and levers at
   * `speed`, leaning `steer` times against the bubble's drift.
   */
  function rive(round: RivingRound, speed = steady, angle?: number, steer = 4) {
    const piece = round.current;
    if (!piece) throw new Error('Nothing to split');
    round.aimTo(angle ?? middle(piece));
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    let pixels = 0;
    for (let t = 0; t < 5 && round.phase.kind === 'lever'; t += STEP) {
      const phase = round.phase;
      pixels += speed * feel.leverTravel * STEP;
      round.drag(pixels);
      round.lean(-phase.lever.offset * steer);
      round.tick(STEP);
    }
  }

  /** Halves every slab until only staves are left. */
  function halveToStaves(round: RivingRound) {
    for (let split = 0; split < 20 && !round.canFinish && round.phase.kind === 'aim'; split++) {
      rive(round);
    }
  }

  it('halving to eighths and keeping them gives 8 staves', async () => {
    const { round, logger, banked } = setup(logWith([]));
    halveToStaves(round);
    expect(round.canFinish).toBe(true);
    expect(round.pieces).toHaveLength(8);
    round.finish();
    expect(round.phase.kind).toBe('done');
    expect(banked()).toEqual({ worth: 8, staves: 8 });
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types.filter((type) => type === 'riving.split')).toHaveLength(7);
    expect(types).toContain('riving.logEnd');
  });

  it('greed: splitting the eighths again gives up to 16 thinner staves', () => {
    const { round, banked } = setup(logWith([]));
    halveToStaves(round);
    while (round.phase.kind === 'aim') rive(round, 0.6, undefined, 6);
    expect(round.phase.kind).toBe('done');
    expect(banked()?.staves).toBeGreaterThan(8);
    expect(round.maxStaves).toBe(Math.floor(360 / rules.stave.min));
  });

  it('too thin a slice is kindling', () => {
    const { round } = setup(logWith([]));
    rive(round, steady, 0);
    const half = round.current;
    if (!half) throw new Error('No half');
    rive(round, 0.4, half.start + 15 * DEG, 8);
    expect(round.finished.map((entry) => entry.fate)).toContain('kindling');
  });

  it('a gold grain kept whole triples the whole log; XP is on the staves', () => {
    const gold = setup(logWith([{ kind: 'gold', angle: 22.5, width: 10 }]));
    rive(gold.round, steady, 0);
    halveToStaves(gold.round);
    gold.round.finish();
    expect(gold.banked()).toEqual({ worth: 24, staves: 8 });
  });

  it('a stave touching a knot is knotted and does not count', async () => {
    const { round, banked, logger } = setup(logWith([], [], [{ angle: 22.5, width: 10 }]));
    rive(round, steady, 0);
    halveToStaves(round);
    expect(round.stavesReady).toBe(7);
    round.finish();
    expect(round.finished.filter((entry) => entry.fate === 'knotted')).toHaveLength(1);
    expect(banked()).toEqual({ worth: 7, staves: 7 });
    const end = (await logger.readAll()).find((event) => event.type === 'riving.logEnd');
    expect(end?.data).toMatchObject({ knotted: 1 });
  });

  it('the aim preview shows what a cut does: grains it cancels, knots it runs through, knotted sides', () => {
    const { round } = setup(
      logWith([{ kind: 'gold', angle: 120, width: 10 }], [], [{ angle: 22.5, width: 10 }]),
    );
    round.aimTo(22.5 * DEG);
    expect(round.aimPreview?.throughKnot).toBe(true);
    expect(round.aimPreview?.knotted).toEqual([true, true]);
    expect(round.aimPreview?.multiplierNow).toBe(3);
    expect(round.aimPreview?.multiplierAfter).toBe(3);
    round.aimTo(120 * DEG);
    expect(round.aimPreview?.throughKnot).toBe(false);
    expect(round.aimPreview?.multiplierAfter).toBe(1);
  });

  it('cutting through a grain cancels it', () => {
    const { round, banked, events } = setup(logWith([{ kind: 'gold', angle: 22.5, width: 10 }]));
    rive(round, steady, 22.5 * DEG);
    const split = events.find((event) => event.type === 'split');
    expect(split?.type === 'split' && split.cut).toEqual([0]);
    halveToStaves(round);
    round.finish();
    expect(banked()).toEqual({ worth: 8, staves: 8 });
  });

  it('a runout loses the thin side; the thick side carries on', () => {
    const { round } = setup(logWith([]));
    rive(round, steady, 0);
    const half = round.current;
    if (!half) throw new Error('No half');
    rive(round, steady, half.start + 60 * DEG, 0);
    const lost = round.finished.find((entry) => entry.fate === 'runout');
    expect(Math.round((lost?.piece.width ?? 0) / DEG)).toBe(60);
    expect(round.pieces.some((piece) => Math.round(piece.width / DEG) === 120)).toBe(true);
  });

  it('leaving mid-log banks nothing', async () => {
    const { round, logger, banked } = setup(logWith([]));
    round.exit();
    expect(banked()).toBeUndefined();
    expect((await logger.readAll()).map((event) => event.type)).toContain('riving.leave');
  });
});
