import type { Clearing, ClearingTree } from '../../../data';

/** Spacing (clearing units) of the checks along a fall line or a roll for the cabin. */
const CABIN_STEP = 2;

type Boulder = Clearing['boulders'][number];

/** How boulders roll (from the feel numbers, so they can be tuned live). */
export interface BoulderRules {
  /** How far one rolls when knocked, in clearing units. */
  roll: number;
  /** Share of the roll left that it keeps after each bounce off the fence. */
  bounce: number;
}
type Cabin = NonNullable<Clearing['cabin']>;

export interface Point {
  x: number;
  y: number;
}

/** A falling trunk crashed into the cabin and leans on it. */
export interface CabinStop {
  /** How far along the fall line it touched, in clearing units. */
  at: number;
  /** How far the trunk tips over (radians from upright) before it rests on the cabin. */
  tilt: number;
}

/** How one trunk falls: straight down its line, unless it crashes into the cabin. */
export interface TrunkPath {
  angle: number;
  cabin?: CabinStop;
}

/** One tree going down in a chain. */
export interface FallStep {
  tree: string;
  /** Radians, 0 = right, π/2 = down (screen coordinates). */
  angle: number;
  /** The direction of each trunk: one for a plain tree, 2–3 fanned out for a forked one. */
  trunks: number[];
  /** How each trunk falls (same order as `trunks`). */
  paths: TrunkPath[];
  /** 0 for the tree you chopped, 1 for what it hits, and so on. */
  depth: number;
  /** The tree, or the rolling boulder (`byBoulder`), that knocked this one over. */
  hitBy?: string;
  byBoulder?: boolean;
  /** How far along the hitter's fall line (or roll) it first touched this tree, in clearing units. */
  hitAt?: number;
}

/** A boulder knocked rolling: by a falling tree or by another rolling boulder. */
export interface BoulderRoll {
  boulder: string;
  from: Point;
  to: Point;
  /** Where it starts, each bounce off the fence, and where it stops. */
  path: Point[];
  angle: number;
  /** How far it rolls before stopping, and how far it would have with nothing in the way. */
  distance: number;
  natural: number;
  hitBy: string;
  byBoulder: boolean;
  /** How far along the hitter's fall line (or roll) it touched this boulder. */
  hitAt: number;
  depth: number;
  /** It stopped against the cabin: a crash, like a tree hitting it. */
  cabin: boolean;
}

/** Everything one felling sets off, worked out before anything moves. */
export interface Chain {
  steps: FallStep[];
  rolls: BoulderRoll[];
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
 * Whether a tree falling at `angle` touches a round thing of `radius` at `at` (a trunk, a
 * boulder), and where: its canopy within canopy radius of it, or its bare trunk within trunk
 * radius.
 */
export function touch(
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

/** Distance from a point to the cabin's footprint (0 inside it). */
export function toCabin(cabin: Cabin, x: number, y: number): number {
  return Math.hypot(
    Math.max(Math.abs(x - cabin.x) - cabin.width / 2, 0),
    Math.max(Math.abs(y - cabin.y) - cabin.depth / 2, 0),
  );
}

/** How far along a tree falling at `angle` first touches the cabin, if it does at all. */
function cabinContact(
  clearing: Clearing,
  cabin: Cabin,
  tree: ClearingTree,
  angle: number,
): number | undefined {
  const canopyFrom = tree.height * clearing.canopyStart;
  if (toCabin(cabin, tree.x, tree.y) > tree.height + clearing.canopyRadius) return undefined;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let along = 0; along <= tree.height; along += CABIN_STEP) {
    const radius = along < canopyFrom ? clearing.trunkRadius : clearing.canopyRadius;
    if (toCabin(cabin, tree.x + dx * along, tree.y + dy * along) <= radius) return along;
  }
  return undefined;
}

/**
 * How far a falling tree tips before it rests on the cabin, whose near side is `distance` from
 * its stump: leaning on its top edge, or its top against its wall if the tree is too short.
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

/** How far from its stump a trunk touching the cabin `at` along its line rests on it. */
function cabinReach(clearing: Clearing, tree: ClearingTree, at: number): number {
  const radius =
    at < tree.height * clearing.canopyStart ? clearing.trunkRadius : clearing.canopyRadius;
  return at + radius;
}

/**
 * How far a trunk leaning on the cabin tips once the cabin has caved in to `share` of its height.
 * Only looks: the crash already stopped the chain there, so it knocks nothing else.
 */
export function cabinSagTilt(
  clearing: Clearing,
  tree: ClearingTree,
  stop: CabinStop,
  share: number,
): number {
  const height = (clearing.cabin?.height ?? 0) * share;
  return Math.max(restTilt(clearing, tree, cabinReach(clearing, tree, stop.at), height), stop.tilt);
}

/** A boulder a falling trunk touches: where along its line, for the billiards knock. */
interface BoulderHit {
  boulder: Boulder;
  contactAt: number;
  /** -1 (clipped at one edge) … 0 (dead on) … 1 (other edge). */
  offset: number;
}

/**
 * Which way a falling tree knocks a boulder: the pool cut rule, from how squarely it hits. Dead on
 * it rolls straight along the fall line; a half hit sends it 30° off to its side; clipping the
 * edge squirts it out nearly sideways. Taken from the offset, not the contact point, so every
 * change of aim turns it, even for a boulder right beside the stump.
 */
export function boulderKnock(angle: number, offset: number): number {
  return angle + Math.asin(Math.max(-1, Math.min(1, offset)));
}

/** A standing tree a falling trunk knocks over: the hit, the line it was hit on, and when. */
export interface TrunkHit {
  hit: Hit;
  angle: number;
  at: number;
}

/**
 * How a trunk falling at `angle` goes down, and what it knocks over on the way, nearest first:
 * standing trees, and boulders it sets rolling. It stops short if it crashes into the cabin, so
 * nothing past the cabin is hit.
 */
export function fallPath(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
  boulders: readonly Boulder[] = clearing.boulders,
): { path: TrunkPath; hits: TrunkHit[]; boulders: BoulderHit[] } {
  const cabin = clearing.cabin;
  const at = cabin ? cabinContact(clearing, cabin, tree, angle) : undefined;
  const before = (contactAt: number) => at === undefined || contactAt < at;
  const hits = treesHit(clearing, standing, tree, angle)
    .filter((hit) => before(hit.contactAt))
    .map((hit) => ({ hit, angle, at: hit.contactAt }));
  const boulderHits = boulders
    .flatMap((boulder) => {
      const contact = touch(clearing, tree, angle, boulder, boulder.radius);
      return contact && before(contact.contactAt)
        ? [{ boulder, contactAt: contact.contactAt, offset: contact.offset }]
        : [];
    })
    .sort((a, b) => a.contactAt - b.contactAt);
  if (!cabin || at === undefined) return { path: { angle }, hits, boulders: boulderHits };
  return {
    path: {
      angle,
      cabin: { at, tilt: restTilt(clearing, tree, cabinReach(clearing, tree, at), cabin.height) },
    },
    hits,
    boulders: boulderHits,
  };
}

/** Billiards from a contact point: the struck thing moves off along the line through its centre. */
function knockFrom(contact: Point, target: Point): number {
  return Math.atan2(target.y - contact.y, target.x - contact.x);
}

/** A tree a rolling boulder runs into, with where along the roll and which way it's knocked. */
interface RollHit {
  tree: ClearingTree;
  at: number;
  angle: number;
}

/** Most times one roll bounces off the fence (it's lost most of its roll by then). */
const MAX_BOUNCES = 4;

/** One straight stretch of a roll, between bounces off the fence. */
interface Leg {
  from: Point;
  dx: number;
  dy: number;
  length: number;
  /** Distance rolled before this leg starts. */
  start: number;
}

/**
 * The legs a boulder of radius `r` rolls with nothing in its way: straight on for `length`, and
 * off the fence at the clearing's edge like a cushion (angle in = angle out), keeping
 * `keep` of the roll left each time.
 */
function fenceLegs(
  clearing: Clearing,
  from: Point,
  angle: number,
  length: number,
  r: number,
  keep: number,
): Leg[] {
  const legs: Leg[] = [];
  let at = { ...from };
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let left = length;
  let start = 0;
  for (let bounces = 0; bounces <= MAX_BOUNCES && left > 1e-6; bounces++) {
    let wall = left;
    let flipX = false;
    let flipY = false;
    const toWall = (position: number, direction: number, size: number) =>
      direction > 1e-9
        ? (size - r - position) / direction
        : direction < -1e-9
          ? (r - position) / direction
          : Infinity;
    const x = Math.max(toWall(at.x, dx, clearing.width), 0);
    const y = Math.max(toWall(at.y, dy, clearing.height), 0);
    if (x < wall) {
      wall = x;
      flipX = true;
    }
    // Into a corner, both walls at once: it comes straight back.
    if (y <= wall + 1e-6 && y < left) {
      if (y < wall - 1e-6) flipX = false;
      wall = y;
      flipY = true;
    }
    legs.push({ from: at, dx, dy, length: wall, start });
    if (!flipX && !flipY) break;
    at = { x: at.x + dx * wall, y: at.y + dy * wall };
    start += wall;
    left = (left - wall) * keep;
    if (flipX) dx = -dx;
    if (flipY) dy = -dy;
  }
  return legs;
}

/**
 * Where a boulder knocked rolling at `angle` for `planned` units goes, and what it runs into. It
 * rolls through any trees in its path, knocking each over billiards-style (along the line from
 * the boulder's centre at contact through the tree's), bounces off the fence, and stops early
 * against the cabin (a crash) or another boulder (which it knocks rolling with the roll left).
 */
export function rollBoulder(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  boulder: Boulder,
  angle: number,
  planned: number,
  others: readonly Boulder[],
  bounce: number,
): {
  path: Point[];
  to: Point;
  distance: number;
  /** How far it would roll, fence bounces and all, with nothing else in the way. */
  natural: number;
  cabin: boolean;
  trees: RollHit[];
  next?: { boulder: Boulder; at: number; angle: number; left: number };
} {
  const r = boulder.radius;
  const legs = fenceLegs(clearing, boulder, angle, planned, r, bounce);
  const last = legs[legs.length - 1];
  const natural = last ? last.start + last.length : 0;
  const path: Point[] = [{ x: boulder.x, y: boulder.y }];
  const trees: RollHit[] = [];
  const hit = new Set<string>();
  const shape = clearing.cabin;
  for (const [index, leg] of legs.entries()) {
    const point = (along: number) => ({
      x: leg.from.x + leg.dx * along,
      y: leg.from.y + leg.dy * along,
    });
    // The first thing that stops it on this leg: the cabin or another boulder.
    let end = leg.length;
    let stop: 'cabin' | { boulder: Boulder; angle: number } | undefined;
    if (shape) {
      for (let along = 0; along <= end; along += CABIN_STEP) {
        if (toCabin(shape, point(along).x, point(along).y) <= r) {
          end = along;
          stop = 'cabin';
          break;
        }
      }
    }
    for (const other of others) {
      const contact = circleContact(leg.from, leg.dx, leg.dy, other, r + other.radius);
      if (contact === undefined || contact > end) continue;
      end = contact;
      stop = { boulder: other, angle: knockFrom(point(contact), other) };
    }
    for (const tree of clearing.trees) {
      if (!standing.has(tree.id) || hit.has(tree.id)) continue;
      const contact = circleContact(leg.from, leg.dx, leg.dy, tree, r + clearing.trunkRadius);
      if (contact === undefined || contact > end) continue;
      hit.add(tree.id);
      trees.push({ tree, at: leg.start + contact, angle: knockFrom(point(contact), tree) });
    }
    path.push(point(end));
    const distance = leg.start + end;
    if (stop || index === legs.length - 1) {
      trees.sort((a, b) => a.at - b.at || a.tree.id.localeCompare(b.tree.id));
      const to = point(end);
      const base = { path, to, distance, natural, trees };
      if (stop === 'cabin') return { ...base, cabin: true };
      if (stop) {
        // What it had left to roll passes on, the way a struck ball takes the speed.
        const left = Math.max(natural - distance, 0);
        return {
          ...base,
          cabin: false,
          next: { boulder: stop.boulder, at: distance, angle: stop.angle, left },
        };
      }
      return { ...base, cabin: false };
    }
  }
  return { path, to: path[0] ?? boulder, distance: 0, natural, cabin: false, trees };
}

/** How far along a line from `from` (direction dx, dy) a circle first comes within `reach` of `at`. */
function circleContact(
  from: Point,
  dx: number,
  dy: number,
  at: Point,
  reach: number,
): number | undefined {
  const relX = at.x - from.x;
  const relY = at.y - from.y;
  const along = relX * dx + relY * dy;
  const side = dx * relY - dy * relX;
  if (along <= 0 || Math.abs(side) > reach) return undefined;
  return Math.max(0, along - Math.sqrt(reach * reach - side * side));
}

/** Whether anything in a chain crashes into the cabin (its logs are lost). */
export function hitsCabin(chain: Chain): boolean {
  return (
    chain.steps.some((step) => step.paths.some((path) => path.cabin)) ||
    chain.rolls.some((roll) => roll.cabin)
  );
}

/** The clearing once a chain's boulders have stopped where they rolled to. */
export function afterChain(clearing: Clearing, chain: Chain): Clearing {
  if (chain.rolls.length === 0) return clearing;
  const moved = new Map(chain.rolls.map((roll) => [roll.boulder, roll.to]));
  return {
    ...clearing,
    boulders: clearing.boulders.map((boulder) => ({ ...boulder, ...moved.get(boulder.id) })),
  };
}

/**
 * Billiards: a hit tree falls along the line from the hitter's canopy center at the moment
 * they touch (the ghost ball) through the hit tree's center. A dead-center hit carries
 * straight on; an edge hit sends it off nearly sideways.
 */
export function knockAngle(hitter: ClearingTree, angle: number, hit: Hit): number {
  return knockFrom(
    {
      x: hitter.x + Math.cos(angle) * hit.contactAt,
      y: hitter.y + Math.sin(angle) * hit.contactAt,
    },
    hit.tree,
  );
}

/**
 * Works out the whole chain before anything is animated. The chopped tree falls at `angle`;
 * each tree it hits is knocked over billiards-style (see knockAngle), each boulder it touches is
 * knocked rolling by the pool cut rule (see boulderKnock, rollBoulder), and so on. Each boulder rolls once per chain.
 * Deterministic: the same clearing, standing trees and angle give the same chain.
 */
export function resolveFall(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  startId: string,
  angle: number,
  rules: BoulderRules,
): Chain {
  const start = clearing.trees.find((tree) => tree.id === startId);
  if (!start || !standing.has(startId)) throw new Error(`Tree "${startId}" isn't standing`);

  const stillStanding = new Set(standing);
  stillStanding.delete(startId);
  const resting = new Map(clearing.boulders.map((boulder) => [boulder.id, boulder]));
  const steps: FallStep[] = [];
  const rolls: BoulderRoll[] = [];
  type Mover =
    | { kind: 'tree'; tree: ClearingTree; falls: ReturnType<typeof fallPath>[]; depth: number }
    | {
        kind: 'roll';
        roll: BoulderRoll;
        hits: RollHit[];
        next?: { boulder: Boulder; at: number; angle: number; left: number };
      };
  const fall = (
    tree: ClearingTree,
    angle: number,
    extra: Partial<FallStep>,
    depth: number,
  ): Mover => {
    const falls = trunkAngles(tree, angle).map((trunk) =>
      fallPath(clearing, stillStanding, tree, trunk, [...resting.values()]),
    );
    steps.push({
      tree: tree.id,
      angle,
      trunks: falls.map((entry) => entry.path.angle),
      paths: falls.map((entry) => entry.path),
      depth,
      ...extra,
    });
    return { kind: 'tree', tree, falls, depth };
  };
  const roll = (
    boulder: Boulder,
    angle: number,
    planned: number,
    by: { hitBy: string; byBoulder: boolean; hitAt: number },
    depth: number,
  ): Mover => {
    resting.delete(boulder.id);
    const result = rollBoulder(
      clearing,
      stillStanding,
      boulder,
      angle,
      planned,
      [...resting.values()],
      rules.bounce,
    );
    const entry: BoulderRoll = {
      boulder: boulder.id,
      from: { x: boulder.x, y: boulder.y },
      to: result.to,
      path: result.path,
      angle,
      distance: result.distance,
      natural: result.natural,
      ...by,
      depth,
      cabin: result.cabin,
    };
    rolls.push(entry);
    return {
      kind: 'roll',
      roll: entry,
      hits: result.trees,
      ...(result.next ? { next: result.next } : {}),
    };
  };
  let frontier: Mover[] = [fall(start, angle, {}, 0)];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Mover[] = [];
    for (const mover of frontier) {
      if (mover.kind === 'tree') {
        // Every trunk sweeps its own line; whichever touches something first knocks it over.
        type Struck =
          | { at: number; id: string; tree: TrunkHit }
          | { at: number; id: string; boulder: BoulderHit; angle: number };
        const struck: Struck[] = mover.falls.flatMap((entry) => [
          ...entry.hits.map((hit) => ({ at: hit.at, id: hit.hit.tree.id, tree: hit })),
          ...entry.boulders.map((hit) => ({
            at: hit.contactAt,
            id: hit.boulder.id,
            boulder: hit,
            angle: entry.path.angle,
          })),
        ]);
        struck.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        for (const item of struck) {
          if ('tree' in item) {
            const { hit, angle: trunk, at } = item.tree;
            if (!stillStanding.has(hit.tree.id)) continue;
            stillStanding.delete(hit.tree.id);
            const hitAngle = knockAngle(mover.tree, trunk, hit);
            next.push(fall(hit.tree, hitAngle, { hitBy: mover.tree.id, hitAt: at }, depth));
          } else {
            const boulder = resting.get(item.id);
            if (!boulder) continue;
            const by = { hitBy: mover.tree.id, byBoulder: false, hitAt: item.at };
            const knock = boulderKnock(item.angle, item.boulder.offset);
            next.push(roll(boulder, knock, rules.roll, by, depth));
          }
        }
      } else {
        for (const hit of mover.hits) {
          if (!stillStanding.has(hit.tree.id)) continue;
          stillStanding.delete(hit.tree.id);
          const by = { hitBy: mover.roll.boulder, byBoulder: true, hitAt: hit.at };
          next.push(fall(hit.tree, hit.angle, by, depth));
        }
        const passOn = mover.next;
        const boulder = passOn && resting.get(passOn.boulder.id);
        if (passOn && boulder && passOn.left > 0) {
          const by = { hitBy: mover.roll.boulder, byBoulder: true, hitAt: passOn.at };
          next.push(roll(boulder, passOn.angle, passOn.left, by, depth));
        }
      }
    }
    frontier = next;
  }
  return { steps, rolls };
}

/** The trees a felling knocks over, in order (see resolveFall for the boulders too). */
export function resolveChain(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  startId: string,
  angle: number,
  rules: BoulderRules,
): FallStep[] {
  return resolveFall(clearing, standing, startId, angle, rules).steps;
}

export interface FallPreview {
  /**
   * Where the falling canopy first touches another tree or a boulder (the ghost ball), or where
   * it crashes into the cabin, or the tip if nothing is hit.
   */
  ghost: Point;
  path: TrunkPath;
  /** The first tree it would hit, and the way that tree would fall. */
  hit?: { tree: string; angle: number; path: TrunkPath; at: number };
  /** Or the first boulder it would set rolling, and where that rolls to. */
  roll?: { boulder: string; path: Point[]; radius: number; at: number; cabin: boolean };
  /** What the guide shows reaches the cabin: the guide turns red. */
  danger: boolean;
}

/**
 * The aim guide, like a billiards ghost ball: where the falling canopy first touches the nearest
 * tree or boulder in its path, and which way that tree falls or where that boulder rolls. It only
 * looks that far ahead, so a longer chain can still reach the cabin unwarned.
 */
export function previewFall(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
  rules: BoulderRules,
): FallPreview {
  const fallen = fallPath(clearing, standing, tree, angle);
  const { path } = fallen;
  const [first] = fallen.hits;
  const [boulder] = fallen.boulders;
  const crashes = path.cabin !== undefined;
  const along = (distance: number) => ({
    x: tree.x + Math.cos(angle) * distance,
    y: tree.y + Math.sin(angle) * distance,
  });
  const left = new Set(standing);
  left.delete(tree.id);
  if (boulder && (!first || boulder.contactAt < first.at)) {
    const contact = along(boulder.contactAt);
    const rolled = rollBoulder(
      clearing,
      left,
      boulder.boulder,
      boulderKnock(angle, boulder.offset),
      rules.roll,
      clearing.boulders.filter((other) => other.id !== boulder.boulder.id),
      rules.bounce,
    );
    return {
      ghost: contact,
      path,
      roll: {
        boulder: boulder.boulder.id,
        path: rolled.path,
        radius: boulder.boulder.radius,
        at: boulder.contactAt,
        cabin: rolled.cabin,
      },
      danger: crashes || rolled.cabin,
    };
  }
  if (!first) {
    return {
      ghost: path.cabin ? along(path.cabin.at) : fallTip(tree, angle),
      path,
      danger: crashes,
    };
  }
  const hitAngle = knockAngle(tree, first.angle, first.hit);
  left.delete(first.hit.tree.id);
  const knocked = fallPath(clearing, left, first.hit.tree, hitAngle).path;
  return {
    ghost: along(first.hit.contactAt),
    path,
    hit: { tree: first.hit.tree.id, angle: hitAngle, path: knocked, at: first.at },
    danger: crashes || knocked.cabin !== undefined,
  };
}

/**
 * The aim guide for every trunk of a tree felled at `angle` (one, or 2–3 for a forked tree). When
 * two trunks reach the same tree or boulder, only the one that gets there first knocks it (as in
 * resolveFall), so only that trunk's guide shows the knock.
 */
export function previewFelling(
  clearing: Clearing,
  standing: ReadonlySet<string>,
  tree: ClearingTree,
  angle: number,
  rules: BoulderRules,
): FallPreview[] {
  const previews = trunkAngles(tree, angle).map((trunk) =>
    previewFall(clearing, standing, tree, trunk, rules),
  );
  const first = new Map<string, number>();
  previews.forEach((preview, index) => {
    const struck = preview.hit ?? preview.roll;
    if (!struck) return;
    const id = preview.hit?.tree ?? preview.roll?.boulder ?? '';
    const best = first.get(id);
    const bestAt =
      best === undefined ? Infinity : (previews[best]?.hit ?? previews[best]?.roll)?.at;
    if (bestAt === undefined || struck.at < bestAt) first.set(id, index);
  });
  return previews.map((preview, index) => {
    const id = preview.hit?.tree ?? preview.roll?.boulder;
    if (id === undefined || first.get(id) === index) return preview;
    // Another trunk knocks it first: this one just shows where it lands.
    return {
      ghost: preview.ghost,
      path: preview.path,
      danger: preview.path.cabin !== undefined,
    };
  });
}
