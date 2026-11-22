import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/core';
import type { Clearing } from '../src/data';
import {
  fallProgress,
  fallTimeToReach,
  fallTip,
  fitClearing,
  judgeChop,
  meterPosition,
  resolveChain,
  treesHit,
  woodcuttingFeel,
} from '../src/stations/woodcutting';
import { data, dataWith } from './helpers';

function firstOf<T>(list: readonly T[]): T {
  const [item] = list;
  if (item === undefined) throw new Error('Empty list');
  return item;
}

const RIGHT = 0;
const DOWN = Math.PI / 2;
const LEFT = Math.PI;

function clearing(trees: Clearing['trees'], hitRadius = 10): Clearing {
  return { id: 'test', width: 500, height: 500, hitRadius, trees };
}

const all = (c: Clearing) => new Set(c.trees.map((tree) => tree.id));
const ids = (steps: { tree: string }[]) => steps.map((step) => step.tree);

describe('chain resolution', () => {
  const row = clearing([
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'b', x: 90, y: 100, height: 100 },
    { id: 'c', x: 180, y: 100, height: 100 },
    { id: 'far', x: 400, y: 100, height: 100 },
  ]);

  it('knocks over every tree in line, each falling the same way', () => {
    const steps = resolveChain(row, all(row), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a', 'b', 'c']);
    expect(steps.map((step) => step.depth)).toEqual([0, 1, 2]);
    expect(steps.every((step) => step.angle === RIGHT)).toBe(true);
    expect(steps[1]).toMatchObject({ hitBy: 'a', hitAt: 90 });
  });

  it('stops when the next tree is out of reach', () => {
    expect(ids(resolveChain(row, all(row), 'c', RIGHT))).toEqual(['c']);
  });

  it('only hits trees in front of the tree, not behind it', () => {
    expect(ids(resolveChain(row, all(row), 'b', LEFT))).toEqual(['b', 'a']);
    expect(ids(resolveChain(row, all(row), 'b', DOWN))).toEqual(['b']);
  });

  it('ignores trees that are already down', () => {
    const standing = new Set(['a', 'c', 'far']);
    expect(ids(resolveChain(row, standing, 'a', RIGHT))).toEqual(['a']);
  });

  it('uses the hit radius from data, inclusive', () => {
    const near = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'edge', x: 50, y: 10, height: 50 },
      { id: 'miss', x: 60, y: 10.5, height: 50 },
    ]);
    expect(treesHit(near, all(near), firstOf(near.trees), RIGHT).map((hit) => hit.tree.id)).toEqual(
      ['edge'],
    );
  });

  it('branches when one tree hits two, nearest first', () => {
    const fork = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'near', x: 40, y: 5, height: 30 },
      { id: 'far', x: 80, y: -5, height: 30 },
    ]);
    const steps = resolveChain(fork, all(fork), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a', 'near', 'far']);
    expect(steps.map((step) => step.depth)).toEqual([0, 1, 1]);
  });

  it('gives the same chain every time', () => {
    const c = firstOf(data.woodcutting.clearings);
    const first = resolveChain(c, all(c), 'a1', Math.atan2(60, 70));
    expect(resolveChain(c, all(c), 'a1', Math.atan2(60, 70))).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });

  it('refuses a tree that is already down', () => {
    expect(() => resolveChain(row, new Set(['b']), 'a', RIGHT)).toThrow("isn't standing");
  });

  it('puts the fallen top exactly one tree height away', () => {
    const tip = fallTip({ id: 't', x: 10, y: 20, height: 50 }, DOWN);
    expect(tip.x).toBeCloseTo(10);
    expect(tip.y).toBeCloseTo(70);
  });
});

describe('the hand-made clearing', () => {
  it('has the diagonal chain it was laid out for', () => {
    const c = firstOf(data.woodcutting.clearings);
    const angle = Math.atan2(170 - 110, 140 - 70);
    expect(ids(resolveChain(c, all(c), 'a1', angle))).toEqual(['a1', 'a2', 'a3', 'a4']);
  });
});

describe('chop meter', () => {
  const feel = data.woodcutting.feel;

  it('bounces the cursor end to end', () => {
    expect(meterPosition(0, 1)).toBe(0);
    expect(meterPosition(0.5, 1)).toBe(0.5);
    expect(meterPosition(1, 1)).toBe(1);
    expect(meterPosition(1.25, 1)).toBe(0.75);
    expect(meterPosition(2, 1)).toBe(0);
  });

  it('judges perfect, good and miss from the windows in data', () => {
    expect(judgeChop(0.5, feel)).toEqual({ result: 'perfect', points: feel.perfectPoints });
    expect(judgeChop(0.5 + feel.perfectWindow / 2 + 0.01, feel)).toEqual({
      result: 'good',
      points: feel.goodPoints,
    });
    expect(judgeChop(0.5 + feel.timingWindow / 2 + 0.01, feel)).toEqual({
      result: 'miss',
      points: 0,
    });
  });

  it('follows the windows when they change', () => {
    const wide = { ...feel, timingWindow: 0.9 };
    expect(judgeChop(0.9, wide).result).toBe('good');
    expect(judgeChop(0.9, feel).result).toBe('miss');
  });
});

describe('fall timing', () => {
  const ease = data.woodcutting.feel.fallEase;

  it('starts slow and speeds up', () => {
    expect(fallProgress(0, ease)).toBe(0);
    expect(fallProgress(1, ease)).toBeCloseTo(1);
    const firstHalf = fallProgress(0.5, ease) - fallProgress(0, ease);
    const secondHalf = fallProgress(1, ease) - fallProgress(0.5, ease);
    expect(secondHalf).toBeGreaterThan(firstHalf * 2);
  });

  it('knows when the top reaches a point on the fall line', () => {
    const t = fallTimeToReach(60, 100, ease);
    expect(fallProgress(t, ease)).toBeCloseTo(0.6);
    expect(fallTimeToReach(100, 100, ease)).toBeCloseTo(1);
  });
});

describe('clearing data', () => {
  it('fits the clearing on a phone screen, centered', () => {
    const c = firstOf(data.woodcutting.clearings);
    const fit = fitClearing(412, 915, c);
    expect(c.width * fit.scale).toBeLessThanOrEqual(412);
    expect(fit.offsetX).toBeCloseTo((412 - c.width * fit.scale) / 2);
  });

  it('rejects a tree outside the clearing and a perfect window wider than the timing window', () => {
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.clearings[0]?.trees.push({ id: 'out', x: 900, y: 10, height: 50 });
      }),
    ).toThrow('outside the clearing');
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.feel.perfectWindow = 0.8;
      }),
    ).toThrow('perfect window');
  });
});

describe('live tuning', () => {
  it('overrides data values on this device until reset', () => {
    const store = new MemoryStore();
    const feel = woodcuttingFeel(data.woodcutting.feel, store);
    let changes = 0;
    feel.onChange(() => changes++);
    feel.set('fallSeconds', 1.5);
    expect(feel.values.fallSeconds).toBe(1.5);
    expect(feel.isOverridden('fallSeconds')).toBe(true);
    expect(woodcuttingFeel(data.woodcutting.feel, store).values.fallSeconds).toBe(1.5);
    feel.reset();
    expect(feel.values).toEqual(data.woodcutting.feel);
    expect(store.get('warchest.tuning.woodcutting')).toBeNull();
    expect(changes).toBe(2);
  });

  it('ignores junk in storage', () => {
    const store = new MemoryStore();
    store.set('warchest.tuning.woodcutting', '{"fallSeconds":"fast","nope":3,"chainDelay":0.3}');
    const feel = woodcuttingFeel(data.woodcutting.feel, store);
    expect(feel.values.fallSeconds).toBe(data.woodcutting.feel.fallSeconds);
    expect(feel.values.chainDelay).toBe(0.3);
  });
});
