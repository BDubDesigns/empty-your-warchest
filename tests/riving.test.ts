import { describe, expect, it } from 'vitest';
import {
  DEG,
  Lever,
  RivingRound,
  alongCheck,
  generateLog,
  grainsCut,
  middle,
  offCentre,
  grainsKept,
  logMultiplier,
  splitPiece,
  wholeLog,
  type RivingEvent,
} from '../src/stations/rive';
import type { RivingLog } from '../src/data';
import { data, testLogger } from './helpers';

const rules = data.riving;
const feel = rules.feel;
const STEP = 1 / 60;
const steady = (feel.bandLow + feel.bandHigh) / 2;

/** A plain test log, with these grains. */
function logWith(grains: RivingLog['grains'], checks: number[] = []): RivingLog {
  return { id: 'test_log', radius: 1, height: 1.6, rings: 12, checks, grains };
}

/** Levers at a steady `speed` (log lengths a second) until the lever ends, or `seconds` pass. */
function leverAt(lever: Lever, speed: number, seconds = 5) {
  let pixels = 0;
  for (let t = 0; t < seconds && !lever.result; t += STEP) {
    pixels += speed * feel.leverTravel * STEP;
    lever.drag(pixels);
    lever.tick(STEP);
  }
  return lever.result;
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

  it('a split too far off the middle is off centre; the first split never is', () => {
    const [half] = splitPiece(wholeLog(), 0);
    const tolerance = rules.centreTolerance * 180;
    expect(offCentre(rules, half, (90 + tolerance - 1) * DEG)).toBe(false);
    expect(offCentre(rules, half, (90 + tolerance + 1) * DEG)).toBe(true);
    expect(offCentre(rules, wholeLog(), 37 * DEG)).toBe(false);
  });

  it('a line through a grain cuts it; grains whole in kept staves multiply the log together', () => {
    const log = logWith([
      { kind: 'gold', angle: 22.5, width: 10 },
      { kind: 'rot', angle: 200, width: 12 },
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
    // ×3 × ½ × 2 = ×3.
    expect(logMultiplier(rules, log, kept)).toBe(3);
    // A grain in a piece that wasn't kept doesn't count.
    expect(grainsKept(log, staves.slice(0, 1), live)).toEqual([0]);
    // Gold and silver: ×6, the cap.
    expect(logMultiplier(rules, log, [0, 2])).toBe(Math.min(6, rules.multiplierCap));
  });

  it('a split along a check knows it', () => {
    const log = logWith([], [100, 280]);
    expect(alongCheck(rules, log, wholeLog(), 100 * DEG)).toBe(true);
    expect(alongCheck(rules, log, wholeLog(), 130 * DEG)).toBe(false);
  });
});

describe('random logs', () => {
  it('the same seed gives the same log, with grains kept apart', () => {
    const one = generateLog(rules, 1234);
    expect(generateLog(rules, 1234)).toEqual(one);
    for (let seed = 1; seed <= 30; seed++) {
      const log = generateLog(rules, seed);
      expect(log.grains.length).toBeLessThanOrEqual(rules.generator.grains.max);
      log.grains.forEach((grain, index) => {
        expect(rules.grainKinds.map((kind) => kind.id)).toContain(grain.kind);
        for (const other of log.grains.slice(index + 1)) {
          const gap = Math.abs(((grain.angle - other.angle + 540) % 360) - 180);
          expect(gap).toBeGreaterThanOrEqual((grain.width + other.width) / 2);
        }
      });
    }
  });
});

describe('levering', () => {
  it('a steady pull inside the band splits clean', () => {
    expect(leverAt(new Lever(() => feel, { onCheck: false }), steady)).toBe('clean');
  });

  it('yanking builds strain until it runs out; easing off lets it recover', () => {
    const yanked = new Lever(() => feel, { onCheck: false });
    expect(leverAt(yanked, feel.bandHigh * 3)).toBe('runout');
    const eased = new Lever(() => feel, { onCheck: false });
    leverAt(eased, feel.bandHigh * 1.5, 0.15);
    const strained = eased.strain;
    expect(strained).toBeGreaterThan(0);
    leverAt(eased, steady, 0.3);
    expect(eased.strain).toBeLessThan(strained);
  });

  it('along a check the same yank strains less', () => {
    const speed = feel.bandHigh + 1.2;
    expect(leverAt(new Lever(() => feel, { onCheck: false }), speed)).toBe('runout');
    expect(leverAt(new Lever(() => feel, { onCheck: true }), speed)).toBe('clean');
  });

  it('too slow and the crack binds', () => {
    expect(leverAt(new Lever(() => feel, { onCheck: false }), feel.bandLow * 0.3)).toBe('bound');
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

  /** Aims the current split at `angle` (default: the piece's middle), strikes and levers. */
  function rive(round: RivingRound, speed = steady, angle?: number) {
    const piece = round.current;
    if (!piece) throw new Error('Nothing to split');
    round.aimTo(angle ?? middle(piece));
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    let pixels = 0;
    for (let t = 0; t < 5 && round.phase.kind === 'lever'; t += STEP) {
      pixels += speed * feel.leverTravel * STEP;
      round.drag(pixels);
      round.tick(STEP);
    }
  }

  it('the froe starts off the middle, so lining it up is up to you', () => {
    const { round } = setup(logWith([]));
    rive(round, steady, 0);
    const piece = round.current;
    const phase = round.phase;
    if (!piece || phase.kind !== 'aim') throw new Error('Not aiming');
    expect(Math.abs(phase.angle - middle(piece))).toBeGreaterThan(0.001);
  });

  it('rives a plain log into 8 staves, halving each piece, and banks them', async () => {
    const { round, logger, banked } = setup(logWith([]));
    for (let split = 0; split < 7; split++) rive(round);
    expect(round.phase.kind).toBe('done');
    expect(round.staves).toBe(8);
    expect(banked()).toEqual({ worth: 8, staves: 8 });
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types.filter((type) => type === 'riving.split')).toHaveLength(7);
    expect(types).toContain('riving.logEnd');
  });

  it('a gold grain kept whole triples the whole log; rot left in halves it; XP is on the staves', () => {
    const gold = setup(logWith([{ kind: 'gold', angle: 22.5, width: 10 }]));
    rive(gold.round, steady, 0);
    while (gold.round.phase.kind === 'aim') rive(gold.round);
    expect(gold.banked()).toEqual({ worth: 24, staves: 8 });
    const rot = setup(logWith([{ kind: 'rot', angle: 22.5, width: 10 }]));
    rive(rot.round, steady, 0);
    while (rot.round.phase.kind === 'aim') rive(rot.round);
    expect(rot.banked()).toEqual({ worth: 4, staves: 8 });
  });

  it('cutting through a grain cancels it, good or bad', () => {
    const { round, banked, events } = setup(logWith([{ kind: 'rot', angle: 22.5, width: 10 }]));
    rive(round, steady, 22.5 * DEG);
    const split = events.find((event) => event.type === 'split');
    expect(split?.type === 'split' && split.cut).toEqual([0]);
    while (round.phase.kind === 'aim') rive(round);
    expect(banked()).toEqual({ worth: 8, staves: 8 });
  });

  it('off centre, the smaller side is lost and the bigger one carries on', () => {
    const { round } = setup(logWith([]));
    rive(round, steady, 0);
    const half = round.current;
    if (!half) throw new Error('No half');
    rive(round, steady, half.start + half.width * 0.3);
    expect(round.finished.map((entry) => entry.fate)).toEqual(['offcentre']);
  });

  it('a runout wastes only the short side; the other side carries on', () => {
    const { round } = setup(logWith([]));
    rive(round, feel.bandHigh * 3);
    expect(round.pieces).toHaveLength(1);
    expect(round.finished.map((entry) => entry.fate)).toEqual(['runout']);
    while (round.phase.kind === 'aim') rive(round);
    expect(round.staves).toBe(4);
  });

  it('a crack that binds waits for another strike, then carries on from where it got to', () => {
    const { round, events } = setup(logWith([]));
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    round.drag(feel.leverTravel * 0.3);
    for (let t = 0; t < feel.bindSeconds + 0.5 && round.phase.kind === 'lever'; t += STEP) {
      round.tick(STEP);
    }
    expect(round.phase.kind).toBe('bound');
    expect(events.map((event) => event.type)).toContain('bound');
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    let pixels = feel.leverTravel * 0.3;
    for (let t = 0; t < 5 && round.phase.kind === 'lever'; t += STEP) {
      pixels += steady * feel.leverTravel * STEP;
      round.drag(pixels - feel.leverTravel * 0.3);
      round.tick(STEP);
    }
    expect(round.pieces).toHaveLength(2);
  });

  it('leaving mid-log banks nothing', async () => {
    const { round, logger, banked } = setup(logWith([]));
    round.exit();
    expect(banked()).toBeUndefined();
    expect((await logger.readAll()).map((event) => event.type)).toContain('riving.leave');
  });
});
