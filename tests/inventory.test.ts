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

  it('lists stacks in data order, merging stacks of the same item', () => {
    const inventory = new Inventory(data, [
      { item: 'spear', count: 1 },
      { item: 'log', count: 3 },
      { item: 'spear', count: 2 },
    ]);
    expect(inventory.stacks()).toEqual([
      { item: 'log', count: 3 },
      { item: 'spear', count: 3 },
    ]);
  });

  it('refuses to go below zero and leaves the count alone', () => {
    const inventory = new Inventory(data, [{ item: 'stave', count: 2 }]);
    expect(() => {
      inventory.remove('stave', 3);
    }).toThrow('Not enough stave');
    expect(inventory.count('stave')).toBe(2);
  });

  it('only takes known items and positive whole counts', () => {
    const inventory = new Inventory(data);
    expect(() => {
      inventory.add('sword', 1);
    }).toThrow('Unknown id "sword"');
    expect(() => {
      inventory.add('log', 0);
    }).toThrow(RangeError);
  });
});
