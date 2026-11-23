import type { Clearing, ClearingTree } from '../../../data';

const DEG = Math.PI / 180;
/** Steps when finding the smallest turn that slides a tree off a rock. */
const TURN_STEPS = 14;
/** Spacing (clearing units) of the checks along a fall line for the cabin. */
const CABIN_STEP = 2;

type Rock = Clearing['rocks'][number];
type Cabin = NonNullable<Clearing['cabin']>;

export interface Point {
  x: number;
  y: number;
}

/** Something a falling trunk ran into before reaching the ground. */
export interface Stop {
  on: 'rock' | 'cabin';
  /** The rock's id. */
  id?: string;
  /** How far along the fall line it touched, in clearing units. */
  at: number;
  /** How far the trunk tips over (radians from upright) before it rests on it. */
  tilt: number;
}

/** How one trunk falls: straight, slid off a rock onto a new line, or stopped on something. */
export interface TrunkPath {
  /** The direction it starts to fall. */
  angle: number;
  /** The direction it ends up lying: `angle`, or turned off a rock. */
  landAngle: number;
  /** A rock it slid off: where it touched, and how far it had tipped when it started to turn. */
  rock?: { id: string; at: number; tilt: number };
  /** It didn't reach the ground. */
  stop?: Stop;
}

/** One tree going down in a chain. */
export interface FallStep {
  tree: string;
  /** Radians, 0 = right, π/2 = down (screen coordinates). */
  angle: number;
  /** The direction each trunk ends up lying: one for a plain tree, 2–3 for a forked one. */
  trunks: number[];
  /** How each trunk falls (same order as `trunks`). */
  paths: TrunkPath[];
  /** 0 for the tree you chopped, 1 for trees it hits, and so on. */
  depth: number;
  /** The tree that knocked this one over. */
  hitBy?: string;
  /**
   * How far along the hitter's fall line its canopy first touched this tree, in clearing units
   * (for timing: never before the hitter turned off a rock on its way to this tree).
   */
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
 * Standing trees a tree falling at `angle` knocks over, nearest first. A standing tree is hit
 * when the falling tree touches its trunk: within canopy + trunk radius of the leafy part of the
 * fall line, or trunk + trunk of the bare trunk below the canopy.
 */
export function treesHit(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
): Hit[] {
  const hits: Hit[] = [];
  for (const other of clearing.trees) {
    if (other.id === tree.id || !standing.has(other.id)) continue;
    const contact = touch(clearing, tree, angle, other, clearing.trunkRadius);
    if (contact) hits.push({ tree: other, ...contact });
  }
  return hits.sort((a, b) => a.contactAt - b.contactAt || a.tree.id.localeCompare(b.tree.id));
}

/**
 * Whether a tree falling at `angle` touches a round thing of `radius` at `at` (a trunk, a rock),
 * and where: its canopy within canopy radius of it, or its bare trunk within trunk radius.
 */
function touch(
  clearing: Clearing,
  tree: ClearingTree,
  angle: number,
  at: Point,
  radius: number,
): Omit<Hit, 'tree'> | undefined {
  const reach = clearing.canopyRadius + radius;
  const bare = clearing.trunkRadius + radius;
  const canopyFrom = tree.height * clearing.canopyStart;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const relX = at.x - tree.x;
  const relY = at.y - tree.y;
  const along = relX * dx + relY * dy;
  if (along <= 0) return undefined;
  // Signed distance from the fall line; positive is clockwise of it on screen.
  const side = dx * relY - dy * relX;
  const toSegment = (from: number, to: number) => {
    const clamped = Math.min(Math.max(along, from), to);
    return Math.hypot(relX - dx * clamped, relY - dy * clamped);
  };
  const byCanopy = toSegment(canopyFrom, tree.height) <= reach;
  if (!byCanopy && toSegment(0, canopyFrom) > bare) return undefined;
  const contactRadius = byCanopy ? reach : bare;
  const contactAt = Math.max(
    0,
    along - Math.sqrt(Math.max(contactRadius * contactRadius - side * side, 0)),
  );
  return { along, contactAt, offset: Math.max(-1, Math.min(1, side / contactRadius)) };
}

/** How far along a tree falling at `angle` first touches the cabin, if it does at all. */
function cabinContact(
  clearing: Clearing,
  cabin: Cabin,
  tree: ClearingTree,
  angle: number,
): number | undefined {
  const canopyFrom = tree.height * clearing.canopyStart;
  const toCabin = (x: number, y: number) =>
    Math.hypot(
      Math.max(Math.abs(x - cabin.x) - cabin.width / 2, 0),
      Math.max(Math.abs(y - cabin.y) - cabin.depth / 2, 0),
    );
  if (toCabin(tree.x, tree.y) > tree.height + clearing.canopyRadius) return undefined;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let along = 0; along <= tree.height; along += CABIN_STEP) {
    const radius = along < canopyFrom ? clearing.trunkRadius : clearing.canopyRadius;
    if (toCabin(tree.x + dx * along, tree.y + dy * along) <= radius) return along;
  }
  return undefined;
}

/**
 * How far a falling tree tips before it rests on something `height` tall whose near side is
 * `distance` from its stump: leaning on its top edge, or its top against its side if the tree is
 * too short to reach over.
 */
function restTilt(
  clearing: Clearing,
  tree: ClearingTree,
  distance: number,
  height: number,
): number {
  const length = tree.height + clearing.canopyRadius;
  if (length >= Math.hypot(distance, height)) return Math.atan2(distance, height);
  return Math.asin(Math.min(distance / length, 1));
}

interface Obstacle {
  on: 'rock' | 'cabin';
  rock?: Rock;
  at: number;
  tilt: number;
}

/** The first rock or cabin wall a tree falling at `angle` touches, leaving out `skip`. */
function firstObstacle(
  clearing: Clearing,
  tree: ClearingTree,
  angle: number,
  skip?: string,
): Obstacle | undefined {
  let first: Obstacle | undefined;
  for (const rock of clearing.rocks) {
    if (rock.id === skip) continue;
    const contact = touch(clearing, tree, angle, rock, rock.radius);
    if (!contact || (first && first.at <= contact.contactAt)) continue;
    first = {
      on: 'rock',
      rock,
      at: contact.contactAt,
      tilt: restTilt(clearing, tree, contact.along, rock.height),
    };
  }
  const cabin = clearing.cabin;
  const at = cabin ? cabinContact(clearing, cabin, tree, angle) : undefined;
  if (cabin && at !== undefined && (!first || at < first.at)) {
    const radius =
      at < tree.height * clearing.canopyStart ? clearing.trunkRadius : clearing.canopyRadius;
    first = { on: 'cabin', at, tilt: restTilt(clearing, tree, at + radius, cabin.height) };
  }
  return first;
}

/**
 * The turn (radians, signed) that just slides a tree falling at `angle` off `rock`, away from the
 * side it hit. Undefined when it stops on the rock instead: the fall line runs over the rock (the
 * trunk comes down on it), or sliding off would take more than the clearing's `maxRockTurn`.
 */
function slideTurn(
  clearing: Clearing,
  tree: ClearingTree,
  angle: number,
  rock: Rock,
): number | undefined {
  const side = Math.cos(angle) * (rock.y - tree.y) - Math.sin(angle) * (rock.x - tree.x);
  const along = Math.cos(angle) * (rock.x - tree.x) + Math.sin(angle) * (rock.y - tree.y);
  // Dead on: the trunk itself comes down on the rock and rests there.
  if (Math.abs(side) < rock.radius && along <= tree.height) return undefined;
  // A rock clockwise of the line (on screen) turns the tree counter-clockwise, and vice versa.
  const direction = side > 0 ? -1 : 1;
  const touches = (turn: number) =>
    touch(clearing, tree, angle + direction * turn, rock, rock.radius) !== undefined;
  const max = clearing.maxRockTurn * DEG;
  if (touches(max)) return undefined;
  let low = 0;
  let high = max;
  for (let step = 0; step < TURN_STEPS; step++) {
    const mid = (low + high) / 2;
    if (touches(mid)) low = mid;
    else high = mid;
  }
  return direction * high;
}

/** A standing tree a falling trunk knocks over: the hit, the line it was hit on, and when. */
export interface TrunkHit {
  hit: Hit;
  /** The trunk's direction when it hit (after any turn off a rock). */
  angle: number;
  /** How far along the fall it hit, for timing (see FallStep.hitAt). */
  at: number;
}

/**
 * How a trunk falling at `angle` goes down, and the standing trees it knocks over, nearest first.
 * It falls straight unless it touches a rock or the cabin first. A rock turns it just enough to
 * slide off and it lands on the new line, knocking over what's there (a second rock on the new
 * line stops it); one dead-on stops it. The cabin stops it. Trees past where it stops are safe.
 */
export function fallPath(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
): { path: TrunkPath; hits: TrunkHit[] } {
  const straight = treesHit(clearing, standing, tree, angle);
  const first = firstObstacle(clearing, tree, angle);
  if (!first) {
    return { path: { angle, landAngle: angle }, hits: straight.map((hit) => along(hit, angle)) };
  }
  const before = straight.filter((hit) => hit.contactAt < first.at).map((hit) => along(hit, angle));
  const stop = (obstacle: Obstacle): Stop => ({
    on: obstacle.on,
    ...(obstacle.rock ? { id: obstacle.rock.id } : {}),
    at: obstacle.at,
    tilt: obstacle.tilt,
  });
  const turn = first.rock ? slideTurn(clearing, tree, angle, first.rock) : undefined;
  if (!first.rock || turn === undefined) {
    return { path: { angle, landAngle: angle, stop: stop(first) }, hits: before };
  }
  const landAngle = angle + turn;
  const rock = { id: first.rock.id, at: first.at, tilt: first.tilt };
  const left = new Set(standing);
  for (const { hit } of before) left.delete(hit.tree.id);
  const next = firstObstacle(clearing, tree, landAngle, first.rock.id);
  const after = treesHit(clearing, left, tree, landAngle)
    .filter((hit) => !next || hit.contactAt < next.at)
    .map((hit) => ({ hit, angle: landAngle, at: Math.max(hit.contactAt, first.at) }));
  return {
    path: { angle, landAngle, rock, ...(next ? { stop: stop(next) } : {}) },
    hits: [...before, ...after],
  };
}

function along(hit: Hit, angle: number): TrunkHit {
  return { hit, angle, at: hit.contactAt };
}

/** Whether any trunk in a chain crashes into the cabin (its logs are lost). */
export function hitsCabin(steps: readonly FallStep[]): boolean {
  return steps.some((step) => step.paths.some((path) => path.stop?.on === 'cabin'));
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
  const steps: FallStep[] = [];
  const fall = (tree: ClearingTree, angle: number, extra: Partial<FallStep>, depth: number) => {
    // Every trunk sweeps its own line; whichever touches a tree first knocks it over.
    const falls = trunkAngles(tree, angle).map((trunk) =>
      fallPath(clearing, stillStanding, tree, trunk),
    );
    steps.push({
      tree: tree.id,
      angle,
      trunks: falls.map((entry) => entry.path.landAngle),
      paths: falls.map((entry) => entry.path),
      depth,
      ...extra,
    });
    return { tree, hits: falls.flatMap((entry) => entry.hits) };
  };
  let frontier = [fall(start, angle, {}, 0)];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: ReturnType<typeof fall>[] = [];
    for (const faller of frontier) {
      const hits = faller.hits.sort(
        (a, b) => a.at - b.at || a.hit.tree.id.localeCompare(b.hit.tree.id),
      );
      for (const { hit, angle: trunk, at } of hits) {
        if (!stillStanding.has(hit.tree.id)) continue;
        stillStanding.delete(hit.tree.id);
        const hitAngle = knockAngle(faller.tree, trunk, hit);
        next.push(fall(hit.tree, hitAngle, { hitBy: faller.tree.id, hitAt: at }, depth));
      }
    }
    frontier = next;
  }
  return steps;
}

export interface FallPreview {
  /**
   * Where the falling canopy first touches another tree (the ghost ball), or where it stops, or
   * the tip if nothing is hit.
   */
  ghost: Point;
  /** How the trunk falls: straight, off a rock, or stopped. */
  path: TrunkPath;
  /** The first tree it would hit, the way that tree would fall, and how it falls. */
  hit?: { tree: string; angle: number; path: TrunkPath };
  /** What the guide shows reaches the cabin: the guide turns red. */
  danger: boolean;
}

/**
 * The aim guide, like a billiards ghost ball: where the falling canopy first touches
 * the nearest tree in its path, and which way that tree would be knocked. It only looks that
 * far ahead, so a longer chain can still reach the cabin unwarned.
 */
export function previewFall(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
): FallPreview {
  const { path, hits } = fallPath(clearing, standing, tree, angle);
  const [first] = hits;
  const crashes = path.stop?.on === 'cabin';
  if (!first) {
    const ghost = path.stop
      ? {
          x: tree.x + Math.cos(path.landAngle) * path.stop.at,
          y: tree.y + Math.sin(path.landAngle) * path.stop.at,
        }
      : fallTip(tree, path.landAngle);
    return { ghost, path, danger: crashes };
  }
  const hitAngle = knockAngle(tree, first.angle, first.hit);
  const left = new Set(standing);
  left.delete(tree.id);
  left.delete(first.hit.tree.id);
  const knocked = fallPath(clearing, left, first.hit.tree, hitAngle).path;
  return {
    ghost: {
      x: tree.x + Math.cos(first.angle) * first.hit.contactAt,
      y: tree.y + Math.sin(first.angle) * first.hit.contactAt,
    },
    path,
    hit: { tree: first.hit.tree.id, angle: hitAngle, path: knocked },
    danger: crashes || knocked.stop?.on === 'cabin',
  };
}
