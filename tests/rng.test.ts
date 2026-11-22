import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core';

const sequence = (rng: Rng, n = 5) => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(sequence(new Rng(42))).toEqual(sequence(new Rng(42)));
    expect(sequence(new Rng('clearing-7'))).toEqual(sequence(new Rng('clearing-7')));
  });

  it('gives different sequences for different seeds', () => {
    expect(sequence(new Rng(1))).not.toEqual(sequence(new Rng(2)));
    expect(sequence(new Rng('a'))).not.toEqual(sequence(new Rng('b')));
  });

  it('can continue from a saved state', () => {
    const rng = new Rng(7);
    rng.next();
    const resumed = new Rng(rng.state);
    expect(sequence(resumed)).toEqual(sequence(rng));
  });

  it('keeps every helper in range', () => {
    const rng = new Rng(123);
    for (let i = 0; i < 2_000; i++) {
      const float = rng.next();
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
      const int = rng.int(3, 6);
      expect(int).toBeGreaterThanOrEqual(3);
      expect(int).toBeLessThanOrEqual(6);
      expect(Number.isInteger(int)).toBe(true);
    }
    const seen = new Set(Array.from({ length: 200 }, () => rng.int(1, 4)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    expect(() => rng.pick([])).toThrow();
  });
});
