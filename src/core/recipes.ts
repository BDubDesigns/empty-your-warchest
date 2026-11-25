import type { Recipe } from '../data';
import type { Inventory, Stack } from './inventory';

/** What the mini game decided about one craft. */
export interface CraftOutcome {
  /** How many times the recipe runs (e.g. a full rack of staves). Default 1. */
  batches?: number;
  /** Tier for tiered outputs that the recipe leaves open (e.g. how well a spear was hardened). */
  outputQuality?: string;
  /**
   * How many times the outputs come out this time, e.g. the staves one log gave (0 allowed: a log
   * split into nothing usable). The recipe's XP is per output, so it scales too. Default 1.
   */
  yield?: number;
  /**
   * How many outputs the XP counts, when it shouldn't be all of them (e.g. splitting pays XP on the
   * staves split, not on what a grain multiplied them to). Default: the yield.
   */
  xpYield?: number;
}

export interface CraftResult {
  consumed: Stack[];
  produced: Stack[];
  xp: number;
}

function wholeAtLeastOne(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a whole number of at least 1, got ${value}`);
  }
  return value;
}

export function canCraft(inventory: Inventory, recipe: Recipe, batches = 1): boolean {
  return recipe.inputs.every((input) =>
    inventory.has(input.item, input.count * batches, input.quality),
  );
}

/**
 * Runs a recipe from data: takes its inputs out of the inventory and adds its outputs.
 * Nothing changes if the inputs aren't there.
 */
export function craft(
  inventory: Inventory,
  recipe: Recipe,
  outcome: CraftOutcome = {},
): CraftResult {
  const batches = wholeAtLeastOne(outcome.batches ?? 1, 'batches');
  const multiplier = outcome.yield ?? 1;
  if (!Number.isInteger(multiplier) || multiplier < 0) {
    throw new RangeError(`yield must be a whole number of at least 0, got ${multiplier}`);
  }

  const consumed = recipe.inputs.map((input) => ({ ...input, count: input.count * batches }));
  const missing = consumed.filter(
    (stack) => !inventory.has(stack.item, stack.count, stack.quality),
  );
  if (missing.length > 0) {
    const list = missing.map((stack) => `${stack.count} ${stack.item}`).join(', ');
    throw new Error(`Can't run "${recipe.id}": missing ${list}`);
  }

  const produced = recipe.outputs.map((output): Stack => {
    const quality =
      output.quality ?? (inventory.isTiered(output.item) ? outcome.outputQuality : undefined);
    if (inventory.isTiered(output.item) && quality === undefined) {
      throw new Error(
        `"${recipe.id}" makes tiered "${output.item}"; the outcome needs an outputQuality`,
      );
    }
    return { item: output.item, count: output.count * batches * multiplier, quality };
  });

  // Reading each output's count throws on a bad item or tier, before anything is changed.
  for (const stack of produced) inventory.count(stack.item, stack.quality);
  for (const stack of consumed) inventory.remove(stack.item, stack.count, stack.quality);
  for (const stack of produced) {
    if (stack.count > 0) inventory.add(stack.item, stack.count, stack.quality);
  }
  const xpYield = outcome.xpYield ?? multiplier;
  if (!Number.isInteger(xpYield) || xpYield < 0) {
    throw new RangeError(`xpYield must be a whole number of at least 0, got ${xpYield}`);
  }
  return { consumed, produced, xp: recipe.xp * batches * xpYield };
}
