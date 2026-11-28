import { Rng, type Stack } from '../../../core';
import type { Clearing, WoodcuttingForage } from '../../../data';
import { toCabin, touch, type Chain, type Point } from './chain';

/** A patch of mushrooms on the clearing floor. */
export interface MushroomPatch extends Point {
  id: string;
  radius: number;
}

/**
 * What can be foraged in a round, fixed when its trees are seeded so it shows from the start:
 * drops on trees (moss on the trunk, mushrooms at the foot), moss on boulders, and mushroom
 * patches on the ground.
 */
export interface Forage {
  /** What each tree drops when it's felled, by tree id (only trees with something). */
  trees: Map<string, { moss: number; mushrooms: number }>;
  /** Moss on each mossy boulder, by boulder id. */
  boulders: Map<string, number>;
  patches: MushroomPatch[];
}

/** What one chain foraged. */
export interface ChainForage {
  trees: string[];
  boulders: string[];
  patches: string[];
  drops: Stack[];
}

/**
 * Seeds a round's forage from the round's seed (its own stream, so the round's other randomness
 * is unchanged): each tree mossy and/or with mushrooms by the shares in data, each boulder mossy,
 * and the mushroom patches placed on open ground.
 */
export function seedForage(clearing: Clearing, rules: WoodcuttingForage, seed: number): Forage {
  const rng = new Rng(`${String(seed)}:forage`);
  const trees = new Map<string, { moss: number; mushrooms: number }>();
  for (const tree of clearing.trees) {
    const moss = rng.chance(rules.mossyTrees.share) ? rollCount(rng, rules.mossyTrees.count) : 0;
    const mushrooms = rng.chance(rules.mushroomTrees.share)
      ? rollCount(rng, rules.mushroomTrees.count)
      : 0;
    if (moss > 0 || mushrooms > 0) trees.set(tree.id, { moss, mushrooms });
  }
  const boulders = new Map<string, number>();
  for (const boulder of clearing.boulders) {
    if (rng.chance(rules.mossyBoulders.share)) {
      boulders.set(boulder.id, rollCount(rng, rules.mossyBoulders.count));
    }
  }
  const { patches: spec } = rules;
  const patches: MushroomPatch[] = [];
  const wanted = rng.int(spec.count.min, Math.max(spec.count.min, spec.count.max));
  for (let index = 0; index < wanted; index++) {
    for (let attempt = 0; attempt < spec.tries; attempt++) {
      const x = rng.range(spec.margin, Math.max(clearing.width - spec.margin, spec.margin));
      const y = rng.range(spec.margin, Math.max(clearing.height - spec.margin, spec.margin));
      const clear = (at: Point, radius: number) =>
        Math.hypot(at.x - x, at.y - y) >= radius + spec.radius + spec.gap;
      const open =
        clearing.trees.every((tree) => clear(tree, clearing.trunkRadius)) &&
        clearing.boulders.every((boulder) => clear(boulder, boulder.radius)) &&
        patches.every((patch) => clear(patch, patch.radius)) &&
        (!clearing.cabin || toCabin(clearing.cabin, x, y) >= spec.radius + spec.gap);
      if (open) {
        patches.push({ id: `patch${String(index + 1)}`, x, y, radius: spec.radius });
        break;
      }
    }
  }
  return { trees, boulders, patches };
}

function rollCount(rng: Rng, count: { min: number; max: number }): number {
  return rng.int(count.min, Math.max(count.min, count.max));
}

/** Distance from `at` to the segment from `from` to `to`. */
function toSegment(at: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t =
    length > 0
      ? Math.min(Math.max(((at.x - from.x) * dx + (at.y - from.y) * dy) / length, 0), 1)
      : 0;
  return Math.hypot(at.x - (from.x + dx * t), at.y - (from.y + dy * t));
}

/** Whether a falling tree's trunk (at `angle`) lands on a patch: as it would knock a trunk. */
export function treeLandsOn(
  clearing: Clearing,
  treeId: string,
  angle: number,
  patch: MushroomPatch,
): boolean {
  const tree = clearing.trees.find((entry) => entry.id === treeId);
  return tree !== undefined && touch(clearing, tree, angle, patch, patch.radius) !== undefined;
}

/** Whether a boulder of `radius` rolling along `path` runs over a patch. */
export function rollRunsOver(
  path: readonly Point[],
  radius: number,
  patch: MushroomPatch,
): boolean {
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1];
    const to = path[index];
    if (from && to && toSegment(patch, from, to) <= radius + patch.radius) return true;
  }
  return false;
}

/**
 * What a chain forages, decided with the chain (in `clearing` as it was before it): drops of the
 * trees it fells, the moss off mossy boulders it hits (the first time only), and the patches a
 * landing tree or a rolling boulder crosses (once a round). `paid` holds what has already been
 * foraged this round ('tree:id', 'boulder:id', 'patch:id'), and gets this chain's added.
 * A trunk that crashes into the cabin never reaches the ground beyond it.
 */
export function forageChain(
  clearing: Clearing,
  chain: Chain,
  forage: Forage,
  rules: WoodcuttingForage,
  paid: Set<string>,
): ChainForage {
  const found = forageTrees(
    chain.steps.map((step) => step.tree),
    forage,
    rules,
    paid,
  );
  const add = (item: string, count: number) => {
    addDrops(found.drops, [{ item, count }]);
  };
  for (const roll of chain.rolls) {
    const moss = forage.boulders.get(roll.boulder);
    if (moss === undefined || paid.has(`boulder:${roll.boulder}`)) continue;
    paid.add(`boulder:${roll.boulder}`);
    found.boulders.push(roll.boulder);
    add(rules.mossyBoulders.item, moss);
  }
  const radii = new Map(clearing.boulders.map((boulder) => [boulder.id, boulder.radius]));
  for (const patch of forage.patches) {
    if (paid.has(`patch:${patch.id}`)) continue;
    const byTree = chain.steps.some((step) =>
      step.paths.some((path) => !path.cabin && treeLandsOn(clearing, step.tree, path.angle, patch)),
    );
    const byBoulder = chain.rolls.some((roll) =>
      rollRunsOver(roll.path, radii.get(roll.boulder) ?? 0, patch),
    );
    if (!byTree && !byBoulder) continue;
    paid.add(`patch:${patch.id}`);
    found.patches.push(patch.id);
    add(rules.patches.item, rules.patches.yield);
  }
  return found;
}

/**
 * What felling `trees` forages from the trees themselves (moss on the trunk, mushrooms at the
 * foot), each paying once a round (`paid`, as in forageChain). No boulders or patches.
 */
export function forageTrees(
  trees: readonly string[],
  forage: Forage,
  rules: WoodcuttingForage,
  paid: Set<string>,
): ChainForage {
  const found: ChainForage = { trees: [], boulders: [], patches: [], drops: [] };
  for (const tree of trees) {
    const drop = forage.trees.get(tree);
    if (!drop || paid.has(`tree:${tree}`)) continue;
    paid.add(`tree:${tree}`);
    found.trees.push(tree);
    addDrops(found.drops, [
      { item: rules.mossyTrees.item, count: drop.moss },
      { item: rules.mushroomTrees.item, count: drop.mushrooms },
    ]);
  }
  return found;
}

/** Adds `stacks` into `into`, item by item (empty stacks are skipped). */
export function addDrops(into: Stack[], stacks: readonly Stack[]): void {
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    const found = into.find((entry) => entry.item === stack.item);
    if (found) found.count += stack.count;
    else into.push({ ...stack });
  }
}
