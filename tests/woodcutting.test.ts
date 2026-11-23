import { describe, expect, it } from 'vitest';
import { MemoryStore, Rng } from '../src/core';
import type { Clearing } from '../src/data';
import {
  fallProgress,
  fallTimeToReach,
  fallTip,
  fitClearing,
  angleBeforeLift,
  chopDamage,
  nudgeAim,
  judgeSwing,
  markerPosition,
  nextTarget,
  trunkAngles,
  yellowWidth,
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

/** Canopies of radius 5: two canopies touch when centers are within 10. */
function clearing(
  trees: Clearing['trees'],
  canopyRadius = 5,
  trunkRadius = 5,
  canopyStart = 0,
): Clearing {
  return { id: 'test', width: 500, height: 500, canopyRadius, trunkRadius, canopyStart, trees };
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
    const steps = resolveChain(row, all(row), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a', 'b', 'c']);
    expect(steps.map((step) => step.depth)).toEqual([0, 1, 2]);
    expect(steps[1]).toMatchObject({ hitBy: 'a', hitAt: 80 });
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

  it('hits any tree whose trunk the falling canopy touches, inclusive', () => {
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
    expect(ids(resolveChain(landing, all(landing), 'faller', DOWN))).toEqual(['faller', 'under']);
  });

  it('hits a trunk, not a canopy: a standing canopy alone is out of reach', () => {
    // Canopies (radius 18) would overlap at 30 apart, but the trunk is beyond canopy + trunk.
    const apart = clearing(
      [
        { id: 'faller', x: 0, y: 0, height: 100 },
        { id: 'beside', x: 60, y: 30, height: 100 },
        { id: 'touched', x: 80, y: 20, height: 100 },
      ],
      18,
      4,
    );
    expect(
      treesHit(apart, all(apart), firstOf(apart.trees), RIGHT).map((hit) => hit.tree.id),
    ).toEqual(['touched']);
  });

  it('only the bare trunk sweeps below the canopy', () => {
    const low = clearing(
      [
        { id: 'faller', x: 0, y: 0, height: 100 },
        { id: 'byBase', x: 10, y: 20, height: 100 },
        { id: 'byTrunk', x: 15, y: 6, height: 100 },
        { id: 'byCanopy', x: 50, y: 15, height: 100 },
      ],
      18,
      4,
      0.3,
    );
    expect(
      treesHit(low, all(low), firstOf(low.trees), RIGHT)
        .map((hit) => hit.tree.id)
        .sort(),
    ).toEqual(['byCanopy', 'byTrunk']);
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

  it('knocks hit trees along the line from the ghost canopy through their center, like billiards', () => {
    const fork = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'center', x: 30, y: 0, height: 10 },
      { id: 'half', x: 60, y: 5, height: 10 },
      { id: 'edge', x: 90, y: -10, height: 10 },
    ]);
    const steps = resolveChain(fork, all(fork), 'a', RIGHT);
    const angleOf = (id: string) => degrees(steps.find((step) => step.tree === id)?.angle ?? NaN);
    expect(angleOf('center')).toBe(0);
    // Half-ball hit: 30° off, as in billiards
    expect(angleOf('half')).toBe(30);
    // Hit at the very edge: knocked off at right angles
    expect(angleOf('edge')).toBe(-90);
  });

  it('carries deflection down the chain', () => {
    const bend = clearing([
      { id: 'a', x: 0, y: 0, height: 100 },
      { id: 'b', x: 80, y: 5, height: 100 },
      { id: 'c', x: 150, y: 50, height: 100 },
    ]);
    const steps = resolveChain(bend, all(bend), 'a', RIGHT);
    expect(ids(steps)).toEqual(['a', 'b', 'c']);
    expect(degrees(steps[1]?.angle ?? NaN)).toBe(30);
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
    expect(ids(resolveChain(c, all(c), 'a1', angle)).slice(0, 4)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });
});

describe('chop bar', () => {
  const feel = data.woodcutting.feel;

  it('sweeps the marker end to end', () => {
    expect(markerPosition(0)).toBe(0);
    expect(markerPosition(0.5)).toBe(0.5);
    expect(markerPosition(1)).toBe(1);
    expect(markerPosition(1.25)).toBe(0.75);
  });

  it('narrows the yellow zone the harder the axe is pulled back', () => {
    expect(yellowWidth(0, feel)).toBeCloseTo(feel.perfectWindowLight);
    expect(yellowWidth(1, feel)).toBeCloseTo(feel.perfectWindow);
    expect(yellowWidth(0.5, feel)).toBeLessThan(yellowWidth(0.2, feel));
  });

  it('judges yellow, green and glancing around wherever the yellow zone is', () => {
    expect(judgeSwing(0.3, 0.3, 1, feel)).toBe('perfect');
    expect(judgeSwing(0.3 + feel.perfectWindow / 2 + 0.01, 0.3, 1, feel)).toBe('good');
    expect(judgeSwing(0.3 + feel.timingWindow / 2 + 0.01, 0.3, 1, feel)).toBe('glancing');
  });

  it('is more forgiving on a light pull than a hard one', () => {
    const justOff = 0.3 + feel.perfectWindow / 2 + 0.01;
    expect(judgeSwing(justOff, 0.3, 1, feel)).toBe('good');
    expect(judgeSwing(justOff, 0.3, 0, feel)).toBe('perfect');
  });

  it('deals more damage for a fuller pull, a bonus on yellow, half when glancing', () => {
    expect(chopDamage(1, 'good', feel)).toBe(feel.fullPullPoints);
    expect(chopDamage(0.05, 'good', feel)).toBe(1);
    expect(chopDamage(1, 'perfect', feel)).toBe(feel.fullPullPoints + feel.perfectBonus);
    expect(chopDamage(1, 'glancing', feel)).toBe(Math.floor(feel.fullPullPoints / 2));
    expect(chopDamage(0.5, 'good', feel)).toBeLessThan(chopDamage(1, 'good', feel));
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

describe('aiming', () => {
  it('ignores the finger rolling just before it lifts', () => {
    const samples = [
      { t: 1.0, angle: 0.5 },
      { t: 1.2, angle: 0.6 },
      { t: 1.35, angle: 0.9 },
      { t: 1.38, angle: 1.1 },
    ];
    expect(angleBeforeLift(samples, 1.4, 0.1)).toBe(0.6);
    expect(angleBeforeLift([{ t: 1.39, angle: 2 }], 1.4, 0.1)).toBe(2);
    expect(angleBeforeLift([], 1.4, 0.1)).toBeUndefined();
  });

  it('fine-tunes by a small step per tap, either way', () => {
    expect(degrees(nudgeAim(0, 1, 1))).toBe(1);
    expect(degrees(nudgeAim(Math.PI / 2, -1, 2))).toBe(88);
  });
});

describe('forked trees', () => {
  const fork = clearing([
    { id: 'f', x: 100, y: 100, height: 100, forks: [-30, 30] },
    { id: 'up', x: 186, y: 50, height: 50 },
    { id: 'down', x: 186, y: 150, height: 50 },
    { id: 'ahead', x: 190, y: 100, height: 50 },
  ]);

  it('falls as trunks fanned out around the fall direction', () => {
    expect(trunkAngles(firstOf(fork.trees), 0).map(degrees)).toEqual([-30, 30]);
    expect(trunkAngles({ id: 'plain', x: 0, y: 0, height: 1 }, 0)).toEqual([0]);
  });

  it('knocks over a tree on each trunk line, not the one between them', () => {
    const steps = resolveChain(fork, all(fork), 'f', RIGHT);
    expect(ids(steps).sort()).toEqual(['down', 'f', 'up']);
    expect(steps[0]?.trunks).toHaveLength(2);
  });
});

describe('aim guide (billiards ghost)', () => {
  const pair = clearing([
    { id: 'a', x: 0, y: 100, height: 100 },
    { id: 'b', x: 90, y: 105, height: 100 },
  ]);

  it('puts the ghost canopy where it first touches the nearest tree, on its near edge', () => {
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), RIGHT);
    // Canopies of radius 5 touch at 10 apart: 5 off the line, so √(10² − 5²) ≈ 8.66 short of b.
    expect(preview.ghost.x).toBeCloseTo(90 - Math.sqrt(75));
    expect(preview.ghost.y).toBeCloseTo(100);
    expect(Math.hypot(preview.ghost.x - 90, preview.ghost.y - 105)).toBeCloseTo(10);
    expect(preview.hit?.tree).toBe('b');
  });

  it("points the hit tree's arrow straight along the ghost-to-tree line, matching the chain", () => {
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), RIGHT);
    const chain = resolveChain(pair, all(pair), 'a', RIGHT);
    expect(preview.hit?.angle).toBeCloseTo(chain[1]?.angle ?? NaN);
    expect(degrees(preview.hit?.angle ?? NaN)).toBe(30);
    const target = firstOf(pair.trees.slice(1));
    const ghostToTree = Math.atan2(target.y - preview.ghost.y, target.x - preview.ghost.x);
    expect(preview.hit?.angle).toBeCloseTo(ghostToTree);
  });

  it('falls back to the full reach when nothing is in the way', () => {
    const preview = previewFall(pair, all(pair), firstOf(pair.trees), LEFT);
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
    feel.set('fallSeconds', 2);
    expect(feel.values.fallSeconds).toBe(2);
    expect(feel.isOverridden('fallSeconds')).toBe(true);
    expect(woodcuttingFeel(data.woodcutting.feel, store).values.fallSeconds).toBe(2);
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
