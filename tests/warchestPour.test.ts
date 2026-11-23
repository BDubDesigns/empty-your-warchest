import { describe, expect, it } from 'vitest';
import { splitDeposit } from '../src/app/warchestPour';

const total = (pieces: { share: number }[]) => pieces.reduce((sum, piece) => sum + piece.share, 0);

describe('pouring a deposit into the warchest', () => {
  it('sends one piece per item for small deposits', () => {
    const pieces = splitDeposit(4, 2, 20, 0.05);
    expect(pieces.map((piece) => piece.share)).toEqual([1, 1, 1, 1]);
    expect(pieces.map((piece) => piece.from)).toEqual([0, 1, 0, 1]);
  });

  it('caps the pieces for big deposits, and the shares still add up exactly', () => {
    for (const amount of [21, 36, 49, 100, 197]) {
      const pieces = splitDeposit(amount, 6, 20, 0.05);
      expect(pieces).toHaveLength(20);
      expect(total(pieces)).toBe(amount);
      const shares = pieces.map((piece) => piece.share);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it('gives every source at least one piece when it can', () => {
    const pieces = splitDeposit(30, 25, 20, 0.05);
    expect(new Set(pieces.map((piece) => piece.from)).size).toBe(25);
    expect(total(pieces)).toBe(30);
  });

  it('staggers the launches', () => {
    expect(splitDeposit(3, 1, 20, 0.1).map((piece) => piece.delay)).toEqual([0, 0.1, 0.2]);
  });

  it('sends nothing for nothing', () => {
    expect(splitDeposit(0, 3, 20, 0.05)).toEqual([]);
  });
});
