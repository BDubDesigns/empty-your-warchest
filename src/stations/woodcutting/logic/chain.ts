import type { Clearing, ClearingTree } from '../../../data';

export interface Point {
  x: number;
  y: number;
}

export interface ChainRules {
  /** Degrees a hit tree turns away from the hitter's direction for an edge hit. */
  maxDeflection: number;
}

/** One tree going down in a chain. */
export interface FallStep {
  tree: string;
  /** Radians, 0 = right, π/2 = down (screen coordinates). */
  angle: number;
  /** 0 for the tree you chopped, 1 for trees it hits, and so on. */
  depth: number;
  /** The tree that knocked this one over. */
  hitBy?: string;
  /** How far along the hitter's fall line its canopy first touched this tree, in clearing units. */
  hitAt?: number;
}

export interface Hit {
  tree: ClearingTree;
  /** How far along the fall line the hit tree stands. */
  along: number;
  /** Where the canopies first touch, along the fall line. */
  contactAt: number;
  /** -1 (hit at one edge) … 0 (dead center) … 1 (other edge). */
  offset: number;
}

/** Where a tree's top lands when it falls at `angle`. */
export function fallTip(tree: ClearingTree, angle: number): Point {
  return { x: tree.x + Math.cos(angle) * tree.height, y: tree.y + Math.sin(angle) * tree.height };
}

/**
 * Standing trees a tree falling at `angle` knocks over, nearest first. The falling canopy
 * sweeps from the base to the tip, so a standing tree is hit when the two canopies touch:
 * its center is within two canopy radii of the fall line.
 */
export function treesHit(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
): Hit[] {
  const reach = clearing.canopyRadius * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const hits: Hit[] = [];
  for (const other of clearing.trees) {
    if (other.id === tree.id || !standing.has(other.id)) continue;
    const relX = other.x - tree.x;
    const relY = other.y - tree.y;
    const along = relX * dx + relY * dy;
    if (along <= 0) continue;
    // Signed distance from the fall line; positive is clockwise of it on screen.
    const side = dx * relY - dy * relX;
    const clamped = Math.min(along, tree.height);
    const distance = Math.hypot(relX - dx * clamped, relY - dy * clamped);
    if (distance > reach) continue;
    const contactAt = Math.max(0, along - Math.sqrt(Math.max(reach * reach - side * side, 0)));
    hits.push({ tree: other, along, contactAt, offset: Math.max(-1, Math.min(1, side / reach)) });
  }
  return hits.sort((a, b) => a.contactAt - b.contactAt || a.tree.id.localeCompare(b.tree.id));
}

/**
 * Works out the whole chain before anything is animated. The chopped tree falls at `angle`;
 * each tree it hits falls in the hitter's direction, turned away by up to `maxDeflection`
 * depending on how far off-center the hit was, and so on.
 * Deterministic: the same clearing, standing trees, angle and rules give the same chain.
 */
export function resolveChain(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  startId: string,
  angle: number,
  rules: ChainRules,
): FallStep[] {
  const start = clearing.trees.find((tree) => tree.id === startId);
  if (!start || !standing.has(startId)) throw new Error(`Tree "${startId}" isn't standing`);

  const maxTurn = (rules.maxDeflection * Math.PI) / 180;
  const stillStanding = new Set(standing);
  stillStanding.delete(startId);
  const steps: FallStep[] = [{ tree: startId, angle, depth: 0 }];
  let frontier = [{ tree: start, angle }];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: { tree: ClearingTree; angle: number }[] = [];
    for (const faller of frontier) {
      for (const hit of treesHit(clearing, stillStanding, faller.tree, faller.angle)) {
        const hitAngle = faller.angle + hit.offset * maxTurn;
        stillStanding.delete(hit.tree.id);
        steps.push({
          tree: hit.tree.id,
          angle: hitAngle,
          depth,
          hitBy: faller.tree.id,
          hitAt: hit.contactAt,
        });
        next.push({ tree: hit.tree, angle: hitAngle });
      }
    }
    frontier = next;
  }
  return steps;
}

export interface FallPreview {
  /** Where the falling canopy first touches another tree (the ghost ball), or the tip if nothing is hit. */
  ghost: Point;
  /** The first tree it would hit, and the way that tree would fall. */
  hit?: { tree: string; angle: number };
}

/**
 * The aim guide, like a billiards ghost ball: where the falling canopy first touches
 * the nearest tree in its path, and which way that tree would be knocked.
 */
export function previewFall(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
  rules: ChainRules,
): FallPreview {
  const [first] = treesHit(clearing, standing, tree, angle);
  if (!first) return { ghost: fallTip(tree, angle) };
  return {
    ghost: {
      x: tree.x + Math.cos(angle) * first.contactAt,
      y: tree.y + Math.sin(angle) * first.contactAt,
    },
    hit: {
      tree: first.tree.id,
      angle: angle + first.offset * ((rules.maxDeflection * Math.PI) / 180),
    },
  };
}
