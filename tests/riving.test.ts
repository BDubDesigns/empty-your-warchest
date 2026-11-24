import { describe, expect, it } from 'vitest';
import {
  DEG,
  Lever,
  RivingRound,
  alongCheck,
  fateOf,
  splitPiece,
  throughKnot,
  wholeLog,
  type RivingEvent,
} from '../src/stations/rive';
import type { RivingLog } from '../src/data';
import { data, testLogger } from './helpers';

const rules = data.riving;
const feel = rules.feel;
const logOf = (id: string): RivingLog => {
  const log = rules.logs.find((entry) => entry.id === id);
  if (!log) throw new Error(`No log ${id}`);
  return log;
};
const STEP = 1 / 60;

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

  it('knots have a width: lines through them run out, and staves touching them are spoiled', () => {
    const log = logOf('knotty_log');
    // Straight across at 0°: fine, but the next halving at 45° runs through the first knot.
    expect(throughKnot(log, wholeLog(), 0)).toBe(false);
    const [half] = splitPiece(wholeLog(), 0);
    expect(throughKnot(log, half, 45 * DEG)).toBe(true);
    // At 29° + 45° steps both knots sit in the one stave from 29° to 74°.
    const quarter = splitPiece(splitPiece(wholeLog(), 29 * DEG)[0], 119 * DEG)[0];
    expect(throughKnot(log, quarter, 74 * DEG)).toBe(false);
    const [knotted, clean] = splitPiece(quarter, 74 * DEG);
    expect(fateOf(rules, log, knotted)).toBe('knot');
    expect(fateOf(rules, log, clean)).toBe('stave');
  });

  it('a stave too thin to use is spoiled', () => {
    const log = logOf('straight_log');
    const quarter = splitPiece(splitPiece(wholeLog(), 0)[0], 90 * DEG)[0];
    const [thin, wide] = splitPiece(quarter, 10 * DEG);
    expect(fateOf(rules, log, thin)).toBe('thin');
    expect(fateOf(rules, log, wide)).toBe('stave');
  });

  it('a split along a check knows it', () => {
    const log = logOf('checked_log');
    expect(alongCheck(rules, log, wholeLog(), 100 * DEG)).toBe(true);
    expect(alongCheck(rules, log, wholeLog(), 130 * DEG)).toBe(false);
  });
});

describe('levering', () => {
  const steady = (feel.bandLow + feel.bandHigh) / 2;

  it('a steady pull inside the band splits clean', () => {
    expect(leverAt(new Lever(() => feel, { onCheck: false }), steady)).toBe('clean');
  });

  it('yanking builds strain until it runs out; easing off lets it recover', () => {
    const yanked = new Lever(() => feel, { onCheck: false });
    expect(leverAt(yanked, feel.bandHigh * 3)).toBe('runout');
    expect(yanked.peakStrain).toBeCloseTo(1, 1);
    const eased = new Lever(() => feel, { onCheck: false });
    leverAt(eased, feel.bandHigh * 1.5, 0.15);
    const strained = eased.strain;
    expect(strained).toBeGreaterThan(0);
    leverAt(eased, steady, 0.3);
    expect(eased.strain).toBeLessThan(strained);
  });

  it('along a check the same yank strains less', () => {
    const speed = feel.bandHigh + 1.2;
    const plain = new Lever(() => feel, { onCheck: false });
    const checked = new Lever(() => feel, { onCheck: true });
    expect(leverAt(plain, speed)).toBe('runout');
    expect(leverAt(checked, speed)).toBe('clean');
  });

  it('too slow and the crack binds, and a knot on the line runs out partway', () => {
    expect(leverAt(new Lever(() => feel, { onCheck: false }), feel.bandLow * 0.3)).toBe('bound');
    const knotted = new Lever(() => feel, { onCheck: false, knotAt: 0.5 });
    expect(leverAt(knotted, steady)).toBe('runout');
    expect(knotted.progress).toBeGreaterThanOrEqual(0.5);
    expect(knotted.progress).toBeLessThan(1);
  });
});

describe('RivingRound', () => {
  function setup(logId: string) {
    const { logger } = testLogger();
    const events: RivingEvent[] = [];
    let banked: number | undefined;
    const round = new RivingRound(logOf(logId), {
      logger,
      feel: () => feel,
      rules,
      bank: (staves) => {
        banked = staves;
        return staves;
      },
      onEvent: (event) => events.push(event),
    });
    return { round, logger, events, banked: () => banked };
  }

  /** Strikes and levers the current split at `speed`. */
  function rive(round: RivingRound, speed: number) {
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    let pixels = 0;
    for (let t = 0; t < 5 && round.phase.kind === 'lever'; t += STEP) {
      pixels += speed * feel.leverTravel * STEP;
      round.drag(pixels);
      round.tick(STEP);
    }
  }

  it('rives a clean log into 8 staves, halving each piece, and banks them', async () => {
    const { round, logger, banked, events } = setup('straight_log');
    const steady = (feel.bandLow + feel.bandHigh) / 2;
    for (let split = 0; split < 7; split++) {
      expect(round.phase.kind).toBe('aim');
      rive(round, steady);
    }
    expect(round.phase.kind).toBe('done');
    expect(round.staves).toBe(8);
    expect(banked()).toBe(8);
    expect(events.filter((event) => event.type === 'split')).toHaveLength(7);
    const types = (await logger.readAll()).map((event) => event.type);
    expect(types).toContain('riving.logStart');
    expect(types.filter((type) => type === 'riving.split')).toHaveLength(7);
    expect(types).toContain('riving.logEnd');
  });

  it('a runout wastes only the short side; the other side carries on', () => {
    const { round, events } = setup('straight_log');
    rive(round, feel.bandHigh * 3);
    const split = events.find((event) => event.type === 'split');
    expect(split?.type === 'split' && split.result).toBe('runout');
    expect(round.pieces).toHaveLength(1);
    expect(round.finished.map((entry) => entry.fate)).toEqual(['runout']);
    // The rest gives at most 4.
    const steady = (feel.bandLow + feel.bandHigh) / 2;
    while (round.phase.kind === 'aim') rive(round, steady);
    expect(round.staves).toBe(4);
  });

  it('a crack that binds waits for another strike, then carries on from where it got to', () => {
    const { round, events } = setup('straight_log');
    round.strike();
    round.tick(feel.strikeSeconds + STEP);
    round.drag(feel.leverTravel * 0.3);
    for (let t = 0; t < feel.bindSeconds + 0.5 && round.phase.kind === 'lever'; t += STEP) {
      round.tick(STEP);
    }
    expect(round.phase.kind).toBe('bound');
    expect(events.map((event) => event.type)).toContain('bound');
    const steady = (feel.bandLow + feel.bandHigh) / 2;
    rive(round, steady);
    expect(round.pieces).toHaveLength(2);
    expect(round.staves).toBe(0);
  });

  it('leaving mid-log banks nothing', async () => {
    const { round, logger, banked } = setup('straight_log');
    round.exit();
    expect(banked()).toBeUndefined();
    expect((await logger.readAll()).map((event) => event.type)).toContain('riving.leave');
  });
});
