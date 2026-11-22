import { describe, expect, it } from 'vitest';
import { MemoryStore, Rng } from '../src/core';
import type { Clearing } from '../src/data';
import {
  fallProgress,
  fallTimeToReach,
  fallTip,
  fitClearing,
  judgeSwing,
  markerPosition,
  nextTarget,
  previewFall,
  resolveChain,
  swingScatter,
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
const STRAIGHT = { maxDeflection: 0 };

/** Canopies of radius 5: two canopies touch when centers are within 10. */
function clearing(trees: Clearing['trees'], canopyRadius = 5): Clearing {
  return { id: 'test', width: 500, height: 500, canopyRadius, trees };
}

const all = (c: Clearing) => new Set(c.trees.map((tree) => tree.id));
const ids = (steps: { tree: string }[]) => steps.map((step) => step.tree);
const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);

describe('chain resolution', () => {
  const row = clearing([
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'b', x: 90, y: 100, height: 100 },
    { id: 'c', x: 180, y: 100, height: 100 },
    { id: 'far', x: 400, y: 100, height: 100 },
  ]);

  it('knocks over every tree in line', () => {
    const steps = resolveChain(row, all(row), 'a', RIGHT, STRAIGHT);
    expect(ids(steps)).toEqual(['a', 'b', 'c']);
    expect(steps.map((step) => step.depth)).toEqual([0, 1, 2]);
    expect(steps[1]).toMatchObject({ hitBy: 'a', hitAt: 80 });
  });

  it('stops when the next tree is out of reach', () => {
    expect(ids(resolveChain(row, all(row), 'c', RIGHT, STRAIGHT))).toEqual(['c']);
  });

  it('only hits trees in front of the tree, not behind it', () => {
    expect(ids(resolveChain(row, all(row), 'b', LEFT, STRAIGHT))).toEqual(['b', 'a']);
    expect(ids(resolveChain(row, all(row), 'b', DOWN, STRAIGHT))).toEqual(['b']);
  });

  it('ignores trees that are already down', () => {
    const standing = new Set(['a', 'c', 'far']);
    expect(ids(resolveChain(row, standing, 'a', RIGHT, STRAIGHT))).toEqual(['a']);
  });

  it('hits any tree whose canopy the falling canopy touches, inclusive', () => {
    const near = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'edge', x: 50, y: 10, height: 50 },
      { id: 'miss', x: 60, y: 10.5, height: 50 },
    ]);
    expect(treesHit(near, all(near), firstOf(near.trees), RIGHT).map((hit) => hit.tree.id)).toEqual(
      ['edge'],
    );
  });

  it('hits a tree the canopy lands on even when the trunk line misses its center', () => {
    // The case from the first scrap test: the top landed across a canopy that didn't fall.
    const landing = clearing(
      [
        { id: 'faller', x: 0, y: 0, height: 90 },
        { id: 'under', x: 22, y: 80, height: 90 },
      ],
      18,
    );
    expect(ids(resolveChain(landing, all(landing), 'faller', DOWN, STRAIGHT))).toEqual([
      'faller',
      'under',
    ]);
  });

  it('branches when one tree hits two, nearest first', () => {
    const fork = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'near', x: 40, y: 5, height: 30 },
      { id: 'far', x: 80, y: -5, height: 30 },
    ]);
    const steps = resolveChain(fork, all(fork), 'a', RIGHT, STRAIGHT);
    expect(ids(steps)).toEqual(['a', 'near', 'far']);
    expect(steps.map((step) => step.depth)).toEqual([0, 1, 1]);
  });

  it('turns hit trees away by how far off-center they were hit', () => {
    const fork = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'center', x: 30, y: 0, height: 10 },
      { id: 'half', x: 60, y: 5, height: 10 },
      { id: 'edge', x: 90, y: -10, height: 10 },
    ]);
    const steps = resolveChain(fork, all(fork), 'a', RIGHT, { maxDeflection: 60 });
    const angleOf = (id: string) => degrees(steps.find((step) => step.tree === id)?.angle ?? NaN);
    expect(angleOf('center')).toBe(0);
    expect(angleOf('half')).toBe(30);
    expect(angleOf('edge')).toBe(-60);
  });

  it('carries deflection down the chain', () => {
    const bend = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'b', x: 80, y: 5, height: 100 },
      { id: 'c', x: 150, y: 50, height: 100 },
    ]);
    const steps = resolveChain(bend, all(bend), 'a', RIGHT, { maxDeflection: 60 });
    expect(ids(steps)).toEqual(['a', 'b', 'c']);
    expect(degrees(steps[1]?.angle ?? NaN)).toBe(30);
  });

  it('gives the same chain every time', () => {
    const c = firstOf(data.woodcutting.clearings);
    const rules = data.woodcutting.feel;
    const first = resolveChain(c, all(c), 'a1', Math.atan2(60, 70), rules);
    expect(resolveChain(c, all(c), 'a1', Math.atan2(60, 70), rules)).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });

  it('refuses a tree that is already down', () => {
    expect(() => resolveChain(row, new Set(['b']), 'a', RIGHT, STRAIGHT)).toThrow("isn't standing");
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
    expect(ids(resolveChain(c, all(c), 'a1', angle, data.woodcutting.feel)).slice(0, 4)).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
  });
});

describe('chop bar', () => {
  const feel = data.woodcutting.feel;

  it('sweeps the marker end to end while the axe is held back', () => {
    expect(markerPosition(0, 1)).toBe(0);
    expect(markerPosition(0.5, 1)).toBe(0.5);
    expect(markerPosition(1, 1)).toBe(1);
    expect(markerPosition(1.25, 1)).toBe(0.75);
  });

  it('judges yellow, green and glancing around wherever the yellow zone is', () => {
    expect(judgeSwing(0.3, 0.3, feel)).toEqual({ result: 'perfect', points: feel.perfectPoints });
    expect(judgeSwing(0.3 + feel.perfectWindow / 2 + 0.01, 0.3, feel)).toEqual({
      result: 'good',
      points: feel.goodPoints,
    });
    expect(judgeSwing(0.3 + feel.timingWindow / 2 + 0.01, 0.3, feel)).toEqual({
      result: 'glancing',
      points: 0,
    });
    expect(judgeSwing(0.8, 0.8, feel).result).toBe('perfect');
  });

  it('moves the yellow zone to a new spot each chop, always with room for the green', () => {
    const rng = new Rng(9);
    const spots = Array.from({ length: 50 }, () => nextTarget(feel, rng));
    expect(new Set(spots.map((spot) => spot.toFixed(2))).size).toBeGreaterThan(10);
    for (const spot of spots) {
      expect(spot - feel.timingWindow / 2).toBeGreaterThanOrEqual(0);
      expect(spot + feel.timingWindow / 2).toBeLessThanOrEqual(1);
    }
    const replay = new Rng(9);
    expect(Array.from({ length: 50 }, () => nextTarget(feel, replay))).toEqual(spots);
  });

  it('keeps the aim on a perfect swing and knocks it off on sloppy ones, within the limits in data', () => {
    const rng = new Rng(1);
    expect(swingScatter('perfect', feel, rng)).toBe(0);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(swingScatter('good', feel, rng))).toBeLessThanOrEqual(
        (feel.goodScatter * Math.PI) / 180,
      );
      expect(Math.abs(swingScatter('glancing', feel, rng))).toBeLessThanOrEqual(
        (feel.glancingScatter * Math.PI) / 180,
      );
    }
  });

  it('drifts the same way for the same seed', () => {
    const drifts = (seed: number) => {
      const rng = new Rng(seed);
      return [swingScatter('good', feel, rng), swingScatter('glancing', feel, rng)];
    };
    expect(drifts(42)).toEqual(drifts(42));
  });
});

describe('aim guide (billiards ghost)', () => {
  const pair = clearing([
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'b', x: 90, y: 105, height: 100 },
  ]);

  it('puts the ghost canopy where it first touches the nearest tree, on its near edge', () => {
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), RIGHT, STRAIGHT);
    // Canopies of radius 5 touch at 10 apart: 5 off the line, so √(10² − 5²) ≈ 8.66 short of b.
    expect(preview.ghost.x).toBeCloseTo(90 - Math.sqrt(75));
    expect(preview.ghost.y).toBeCloseTo(100);
    expect(Math.hypot(preview.ghost.x - 90, preview.ghost.y - 105)).toBeCloseTo(10);
    expect(preview.hit?.tree).toBe('b');
  });

  it('shows which way the hit tree will go, matching the chain', () => {
    const rules = { maxDeflection: 60 };
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), RIGHT, rules);
    const chain = resolveChain(pair, all(pair), 'a', RIGHT, rules);
    expect(preview.hit?.angle).toBeCloseTo(chain[1]?.angle ?? NaN);
    expect(degrees(preview.hit?.angle ?? NaN)).toBe(30);
  });

  it('falls back to the full reach when nothing is in the way', () => {
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), LEFT, STRAIGHT);
    expect(preview.hit).toBeUndefined();
    expect(preview.ghost.x).toBeCloseTo(-100);
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
    expect(() =>
      dataWith((raw) => {
        raw.woodcutting.feel.timingWindow = 1;
        raw.woodcutting.feel.perfectWindow = 0.1;
      }),
    ).toThrow('green zone');
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
