import type { Clearing, ClearingTree } from '../../../data';

export interface Point {
  x: number;
  y: number;
}

/** One tree going down in a chain. */
export interface FallStep {
  tree: string;
  /** Radians, 0 = right, π/2 = down (screen coordinates). */
  angle: number;
  /** The direction of each trunk: one for a plain tree, 2–3 fanned out for a forked one. */
  trunks: number[];
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

/** The directions a tree's trunks fall when it's felled at `angle`. */
export function trunkAngles(tree: ClearingTree, angle: number): number[] {
  return tree.forks ? tree.forks.map((offset) => angle + (offset * Math.PI) / 180) : [angle];
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
 * Billiards: a hit tree falls along the line from the hitter's canopy center at the moment
 * they touch (the ghost ball) through the hit tree's center. A dead-center hit carries
 * straight on; an edge hit sends it off nearly sideways.
 */
export function knockAngle(hitter: ClearingTree, angle: number, hit: Hit): number {
  const contact = {
    x: hitter.x + Math.cos(angle) * hit.contactAt,
    y: hitter.y + Math.sin(angle) * hit.contactAt,
  };
  return Math.atan2(hit.tree.y - contact.y, hit.tree.x - contact.x);
}

/**
 * Works out the whole chain before anything is animated. The chopped tree falls at `angle`;
 * each tree it hits is knocked over billiards-style (see knockAngle), and so on.
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
  const steps: FallStep[] = [{ tree: startId, angle, trunks: trunkAngles(start, angle), depth: 0 }];
  let frontier = [{ tree: start, trunks: trunkAngles(start, angle) }];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: { tree: ClearingTree; trunks: number[] }[] = [];
    for (const faller of frontier) {
      // Every trunk sweeps its own line; whichever touches a tree first knocks it over.
      const hits = faller.trunks
        .flatMap((trunk) =>
          treesHit(clearing, stillStanding, faller.tree, trunk).map((hit) => ({ hit, trunk })),
        )
        .sort(
          (a, b) => a.hit.contactAt - b.hit.contactAt || a.hit.tree.id.localeCompare(b.hit.tree.id),
        );
      for (const { hit, trunk } of hits) {
        if (!stillStanding.has(hit.tree.id)) continue;
        stillStanding.delete(hit.tree.id);
        const hitAngle = knockAngle(faller.tree, trunk, hit);
        const trunks = trunkAngles(hit.tree, hitAngle);
        steps.push({
          tree: hit.tree.id,
          angle: hitAngle,
          trunks,
          depth,
          hitBy: faller.tree.id,
          hitAt: hit.contactAt,
        });
        next.push({ tree: hit.tree, trunks });
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
      angle: knockAngle(tree, angle, first),
    },
  };
}
