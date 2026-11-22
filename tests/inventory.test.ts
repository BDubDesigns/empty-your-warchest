import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/core';
import { data } from './helpers';

describe('Inventory', () => {
  it('counts plain items', () => {
    const inventory = new Inventory(data);
    inventory.add('log', 5);
    inventory.remove('log', 2);
    expect(inventory.count('log')).toBe(3);
    expect(inventory.has('log', 3)).toBe(true);
    expect(inventory.has('log', 4)).toBe(false);
  });

  it('counts tiered items per tier, with a total across tiers', () => {
    const inventory = new Inventory(data);
    inventory.add('spear', 4, 'poor');
    inventory.add('spear', 2, 'perfect');
    expect(inventory.count('spear', 'poor')).toBe(4);
    expect(inventory.count('spear', 'good')).toBe(0);
    expect(inventory.count('spear')).toBe(6);
  });

  it('lists stacks in data order, worst tier first', () => {
    const inventory = new Inventory(data, [
      { item: 'spear', count: 1, quality: 'perfect' },
      { item: 'log', count: 3 },
      { item: 'spear', count: 2, quality: 'poor' },
    ]);
    expect(inventory.stacks()).toEqual([
      { item: 'log', count: 3 },
      { item: 'spear', count: 2, quality: 'poor' },
      { item: 'spear', count: 1, quality: 'perfect' },
    ]);
  });

  it('refuses to go below zero and leaves the count alone', () => {
    const inventory = new Inventory(data, [{ item: 'stave', count: 2 }]);
    expect(() => {
      inventory.remove('stave', 3);
    }).toThrow('Not enough stave');
    expect(inventory.count('stave')).toBe(2);
  });

  it('enforces tier rules and known items', () => {
    const inventory = new Inventory(data);
    expect(() => {
      inventory.add('spear', 1);
    }).toThrow('needs a quality tier');
    expect(() => {
      inventory.add('log', 1, 'good');
    }).toThrow('no quality tiers');
    expect(() => {
      inventory.add('spear', 1, 'legendary');
    }).toThrow('Unknown id "legendary"');
    expect(() => {
      inventory.add('sword', 1);
    }).toThrow('Unknown id "sword"');
    expect(() => {
      inventory.add('log', 0);
    }).toThrow(RangeError);
  });
});
