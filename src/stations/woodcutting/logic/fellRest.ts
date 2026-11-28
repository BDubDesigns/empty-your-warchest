import type { Rng } from '../../../core';
import type { Clearing, ClearingTree } from '../../../data';
import { fallPath, trunkAngles, type FallStep } from './chain';
import { treeLandsOn, type MushroomPatch } from './forage';

/**
 * How a tree falling at `angle` would touch the clearing, if it fell alone: 2 if a trunk reaches
 * the cabin, 1 if one lands on a boulder or a mushroom patch, 0 if it lands clear.
 */
function touches(
  clearing: Clearing,
  tree: ClearingTree,
  angle: number,
  patches: readonly MushroomPatch[],
): number {
  let worst = 0;
  for (const trunk of trunkAngles(tree, angle)) {
    const fall = fallPath(clearing, new Set(), tree, trunk);
    if (fall.path.cabin) return 2;
    if (
      fall.boulders.length > 0 ||
      patches.some((patch) => treeLandsOn(clearing, tree.id, trunk, patch))
    )
      worst = 1;
  }
  return worst;
}

/**
 * Fell the rest: every standing tree goes down on its own, a seeded way each (the first of up to
 * `tries` directions that lands clear of the cabin, the boulders and the patches, or the one that
 * touches least), in a ripple out from the middle of the clearing: `depth` is each tree's place
 * in it. Only looks for where they land: nothing is knocked over, rolled or crashed into.
 */
export function fellRestSteps(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  patches: readonly MushroomPatch[],
  tries: number,
  rng: Rng,
): FallStep[] {
  const middle = { x: clearing.width / 2, y: clearing.height / 2 };
  const fromMiddle = (tree: ClearingTree) => Math.hypot(tree.x - middle.x, tree.y - middle.y);
  const trees = clearing.trees
    .filter((tree) => standing.has(tree.id))
    .sort((a, b) => fromMiddle(a) - fromMiddle(b) || a.id.localeCompare(b.id));
  return trees.map((tree, depth) => {
    let best: { angle: number; touch: number } | undefined;
    for (let attempt = 0; attempt < tries && best?.touch !== 0; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const touch = touches(clearing, tree, angle, patches);
      if (!best || touch < best.touch) best = { angle, touch };
    }
    const angle = best?.angle ?? 0;
    const trunks = trunkAngles(tree, angle);
    return {
      tree: tree.id,
      angle,
      trunks,
      paths: trunks.map((trunk) => ({ angle: trunk })),
      depth,
    };
  });
}
