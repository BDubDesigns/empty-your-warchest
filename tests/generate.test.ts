import { describe, expect, it } from 'vitest';
import {
  bestChain,
  clearingPar,
  generateClearing,
  resolveChain,
  starsFor,
  tutorialPlan,
} from '../src/stations/woodcutting';
import { data } from './helpers';

const woodcutting = data.woodcutting;
const { generator } = woodcutting;

describe('generateClearing', () => {
  it('gives the same clearing for the same seed, and a different one for another', () => {
    const a = generateClearing(woodcutting, 1234);
    expect(generateClearing(woodcutting, 1234)).toEqual(a);
    expect(generateClearing(woodcutting, 99).clearing.trees).not.toEqual(a.clearing.trees);
  });

  it('places trees by the rules, and always has a good chain', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { clearing, par } = generateClearing(woodcutting, seed);
      const { trees } = clearing;
      expect(trees.length).toBeGreaterThanOrEqual(generator.trees.min - 2);
      expect(trees.length).toBeLessThanOrEqual(generator.trees.max);
      for (const tree of trees) {
        expect(tree.x).toBeGreaterThanOrEqual(generator.margin);
        expect(tree.x).toBeLessThanOrEqual(clearing.width - generator.margin);
        expect(tree.y).toBeGreaterThanOrEqual(generator.margin);
        expect(tree.y).toBeLessThanOrEqual(clearing.height - generator.margin);
        for (const other of trees) {
          if (other === tree) continue;
          expect(Math.hypot(other.x - tree.x, other.y - tree.y)).toBeGreaterThanOrEqual(
            generator.spacing,
          );
        }
      }
      const all = new Set(trees.map((tree) => tree.id));
      expect(bestChain(clearing, all, generator.aimSamples)?.length).toBeGreaterThanOrEqual(
        generator.minBestChain,
      );
      // Par is at least a log per tree.
      expect(par).toBeGreaterThanOrEqual(trees.length);
    }
  });
});

describe('bestChain and par', () => {
  const { clearing } = tutorialPlan(woodcutting);
  const all = new Set(clearing.trees.map((tree) => tree.id));

  it('finds a real chain that holds with the aim a little off', () => {
    const best = bestChain(clearing, all, generator.aimSamples);
    if (!best) throw new Error('No chain found');
    // The tutorial's diagonal run is 4 trees.
    expect(best.length).toBeGreaterThanOrEqual(4);
    const step = (Math.PI * 2) / generator.aimSamples;
    for (const angle of [best.angle - step, best.angle, best.angle + step]) {
      expect(resolveChain(clearing, all, best.tree, angle).length).toBeGreaterThanOrEqual(
        best.length,
      );
    }
  });

  it('par fells every tree, biggest chains first', () => {
    const par = clearingPar(clearing, woodcutting.chainExponent, generator.aimSamples);
    expect(par).toBeGreaterThanOrEqual(16 + clearing.trees.length - 4);
    expect(tutorialPlan(woodcutting).par).toBe(par);
  });
});

describe('starsFor', () => {
  const thresholds = { two: 0.5, three: 0.8 };
  it('gives 1 star for any banked chain and more as logs near par', () => {
    expect(starsFor(0, 40, thresholds)).toBe(0);
    expect(starsFor(1, 40, thresholds)).toBe(1);
    expect(starsFor(19, 40, thresholds)).toBe(1);
    expect(starsFor(20, 40, thresholds)).toBe(2);
    expect(starsFor(32, 40, thresholds)).toBe(3);
    expect(starsFor(60, 40, thresholds)).toBe(3);
  });
});
