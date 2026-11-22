import { describe, expect, it } from 'vitest';
import { XpCurve } from '../src/core';
import { data, dataWith } from './helpers';

const curve = new XpCurve(data.tuning.xpCurve);

describe('XP curve', () => {
  it('matches the RuneScape table', () => {
    expect(curve.xpForLevel(1)).toBe(0);
    expect(curve.xpForLevel(2)).toBe(83);
    expect(curve.xpForLevel(10)).toBe(1_154);
    expect(curve.xpForLevel(50)).toBe(101_333);
    expect(curve.xpForLevel(92)).toBe(6_517_253);
    expect(curve.xpForLevel(99)).toBe(13_034_431);
  });

  it('turns XP into levels at the exact thresholds', () => {
    expect(curve.levelForXp(0)).toBe(1);
    expect(curve.levelForXp(82)).toBe(1);
    expect(curve.levelForXp(83)).toBe(2);
    expect(curve.levelForXp(13_034_430)).toBe(98);
    expect(curve.levelForXp(13_034_431)).toBe(99);
    expect(curve.levelForXp(200_000_000)).toBe(99);
  });

  it('costs about 10% more XP per level once past the early levels', () => {
    const cost = (level: number) => curve.xpForLevel(level + 1) - curve.xpForLevel(level);
    expect(cost(80) / cost(79)).toBeCloseTo(1.104, 2);
  });

  it('rejects levels outside 1–99', () => {
    expect(() => curve.xpForLevel(0)).toThrow(RangeError);
    expect(() => curve.xpForLevel(100)).toThrow(RangeError);
  });

  it('follows the constants in data', () => {
    const tuned = dataWith((raw) => {
      raw.tuning.xpCurve.base = 150;
      raw.tuning.xpCurve.maxLevel = 50;
    });
    const tunedCurve = new XpCurve(tuned.tuning.xpCurve);
    expect(tunedCurve.maxLevel).toBe(50);
    expect(tunedCurve.xpForLevel(2)).toBeLessThan(curve.xpForLevel(2));
    expect(tunedCurve.levelForXp(13_034_431)).toBe(50);
  });
});
