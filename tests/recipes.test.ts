import { describe, expect, it } from 'vitest';
import { canCraft, craft, Inventory } from '../src/core';
import { byId } from '../src/data';
import { data, dataWith } from './helpers';

const recipe = (id: string, source = data) => byId(source.recipes, id);

describe('recipes', () => {
  it('turns a log into a stave at the workbench', () => {
    const inventory = new Inventory(data, [{ item: 'log', count: 3 }]);
    const result = craft(inventory, recipe('split_stave'));
    expect(inventory.count('log')).toBe(2);
    expect(inventory.count('stave')).toBe(1);
    expect(result.xp).toBe(recipe('split_stave').xp);
  });

  it('gathers from nothing at the tree line', () => {
    const inventory = new Inventory(data);
    craft(inventory, recipe('fell_tree'), { batches: 4 });
    expect(inventory.count('log')).toBe(4);
  });

  it('runs a rack of batches with the quality the mini game decided', () => {
    const inventory = new Inventory(data, [{ item: 'stave', count: 6 }]);
    const result = craft(inventory, recipe('harden_spear'), { batches: 5, outputQuality: 'good' });
    expect(inventory.count('stave')).toBe(1);
    expect(inventory.count('spear', 'good')).toBe(5);
    expect(result.xp).toBe(recipe('harden_spear').xp * 5);
  });

  it('yields what the mini game gave, with XP per output, down to nothing', () => {
    const inventory = new Inventory(data, [{ item: 'log', count: 2 }]);
    const result = craft(inventory, recipe('split_stave'), { yield: 6 });
    expect(inventory.count('stave')).toBe(6);
    expect(result.xp).toBe(recipe('split_stave').xp * 6);
    const none = craft(inventory, recipe('split_stave'), { yield: 0 });
    expect(inventory.count('log')).toBe(0);
    expect(inventory.count('stave')).toBe(6);
    expect(none.xp).toBe(0);
  });

  it('can pay XP on fewer outputs than it yields', () => {
    const inventory = new Inventory(data, [{ item: 'log', count: 1 }]);
    const result = craft(inventory, recipe('split_stave'), { yield: 24, xpYield: 8 });
    expect(inventory.count('stave')).toBe(24);
    expect(result.xp).toBe(recipe('split_stave').xp * 8);
  });

  it('changes nothing when inputs are missing', () => {
    const inventory = new Inventory(data, [{ item: 'stave', count: 2 }]);
    expect(canCraft(inventory, recipe('harden_spear'), 3)).toBe(false);
    expect(() =>
      craft(inventory, recipe('harden_spear'), { batches: 3, outputQuality: 'good' }),
    ).toThrow('missing 3 stave');
    expect(inventory.stacks()).toEqual([{ item: 'stave', count: 2 }]);
  });

  it('changes nothing when a tiered output has no or a bad quality', () => {
    const inventory = new Inventory(data, [{ item: 'stave', count: 2 }]);
    expect(() => craft(inventory, recipe('harden_spear'))).toThrow('needs an outputQuality');
    expect(() => craft(inventory, recipe('harden_spear'), { outputQuality: 'shiny' })).toThrow();
    expect(inventory.stacks()).toEqual([{ item: 'stave', count: 2 }]);
  });

  it('follows the counts in data', () => {
    const tuned = dataWith((raw) => {
      const recipe = raw.recipes.find((r) => r.id === 'split_stave');
      if (recipe) recipe.outputs = [{ item: 'stave', count: 3 }];
    });
    const inventory = new Inventory(tuned, [{ item: 'log', count: 1 }]);
    craft(inventory, recipe('split_stave', tuned));
    expect(inventory.count('stave')).toBe(3);
  });
});
