import type { Clearing, ClearingTree } from '../../../data';

export interface Point {
  x: number;
  y: number;
}

/** One tree going down in a chain. */
export interface FallStep {
  tree: string;
  /** Radians, 0 = right, π/2 = down (screen coordinates). Every tree in a chain falls the same way. */
  angle: number;
  /** 0 for the tree you chopped, 1 for trees it hits, and so on. */
  depth: number;
  /** The tree that knocked this one over. */
  hitBy?: string;
  /** How far along the hitter's fall line this tree stood, in clearing units. */
  hitAt?: number;
}

/** Where a tree's top lands when it falls at `angle`. */
export function fallTip(tree: ClearingTree, angle: number): Point {
  return { x: tree.x + Math.cos(angle) * tree.height, y: tree.y + Math.sin(angle) * tree.height };
}

/**
 * How far along the fall line of `tree` the point lies, and how far it is from the line.
 * Points behind the base or past the tip measure to the nearest end.
 */
function alongAndDistance(tree: ClearingTree, angle: number, point: Point) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const relX = point.x - tree.x;
  const relY = point.y - tree.y;
  const along = relX * dx + relY * dy;
  const clamped = Math.min(Math.max(along, 0), tree.height);
  const distance = Math.hypot(relX - dx * clamped, relY - dy * clamped);
  return { along, distance };
}

/** Standing trees a tree falling at `angle` would knock over, nearest first. */
export function treesHit(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
): { tree: ClearingTree; along: number }[] {
  return clearing.trees
    .filter((other) => other.id !== tree.id && standing.has(other.id))
    .map((other) => ({ tree: other, ...alongAndDistance(tree, angle, other) }))
    .filter((hit) => hit.along > 0 && hit.distance <= clearing.hitRadius)
    .sort((a, b) => a.along - b.along || a.tree.id.localeCompare(b.tree.id))
    .map(({ tree: hitTree, along }) => ({ tree: hitTree, along }));
}

/**
 * Works out the whole chain before anything is animated: the chopped tree falls at
 * `angle`, every standing tree on its fall line falls the same way, and so on.
 * Deterministic: the same clearing, standing trees and angle give the same chain.
 */
export function resolveChain(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  startId: string,
  angle: number,
): FallStep[] {
  const start = clearing.trees.find((tree) => tree.id === startId);
  if (!start || !standing.has(startId)) throw new Error(`Tree "${startId}" isn't standing`);

  const stillStanding = new Set(standing);
  stillStanding.delete(startId);
  const steps: FallStep[] = [{ tree: startId, angle, depth: 0 }];
  let frontier = [start];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: ClearingTree[] = [];
    for (const faller of frontier) {
      for (const hit of treesHit(clearing, stillStanding, faller, angle)) {
        stillStanding.delete(hit.tree.id);
        steps.push({ tree: hit.tree.id, angle, depth, hitBy: faller.id, hitAt: hit.along });
        next.push(hit.tree);
      }
    }
    frontier = next;
  }
  return steps;
}
