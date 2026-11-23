import { describe, expect, it } from 'vitest';
import {
  fastFallUnlocked,
  forestAt,
  generateClearing,
  unlocksBetween,
  woodcuttingSkill,
} from '../src/stations/woodcutting';
import { data, dataWith } from './helpers';

const woodcutting = data.woodcutting;

describe('woodcutting unlocks', () => {
  it('trains the skill of the felling recipe’s station', () => {
    expect(woodcuttingSkill(data)).toBe('woodcutting');
  });

  it('grows the forest as levels unlock it, later unlocks winning', () => {
    expect(forestAt(woodcutting, 1)).toEqual({
      trees: woodcutting.generator.trees,
      forkedShare: woodcutting.generator.forkedShare,
    });
    expect(forestAt(woodcutting, 10).trees).toEqual({ min: 16, max: 20 });
    expect(forestAt(woodcutting, 35)).toEqual({ trees: { min: 16, max: 20 }, forkedShare: 0.2 });
    expect(forestAt(woodcutting, 99).trees).toEqual({ min: 18, max: 22 });
  });

  it('unlocks the fast-fall switch at its level', () => {
    expect(fastFallUnlocked(woodcutting, 19)).toBe(false);
    expect(fastFallUnlocked(woodcutting, 20)).toBe(true);
  });

  it('lists what a level-up unlocks', () => {
    expect(unlocksBetween(woodcutting, 9, 21).map((unlock) => unlock.level)).toEqual([10, 20]);
    expect(unlocksBetween(woodcutting, 10, 10)).toEqual([]);
  });

  it('makes bigger clearings at higher levels, the same for the same seed and level', () => {
    const counts = (level: number) =>
      Array.from({ length: 12 }, (_, seed) => generateClearing(woodcutting, seed + 1, level))
        .map((plan) => plan.clearing.trees.length)
        .reduce((sum, count) => sum + count, 0);
    expect(counts(40)).toBeGreaterThan(counts(1));
    expect(generateClearing(woodcutting, 5, 40)).toEqual(generateClearing(woodcutting, 5, 40));
  });

  it('rejects unlocks out of level order', () => {
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.unlocks = [...raw.woodcutting.unlocks].reverse();
      }),
    ).toThrow(/level order/);
  });
});
