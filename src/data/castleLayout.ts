import { Rng } from '../core/rng';
import type { Castle, CastleBuilding, CastleSide, CastleTower } from './schema';

// The castle laid out from its data: where each wall runs and where it shows between its towers,
// its walk and merlons, where the keep's kit pieces go, the stairs, and the siege's anchors (the
// captain's windows, the spear rack, the bell and its rope, the guards' ways round and their ways to
// the bell) as points in the world. Pure
// numbers: no rendering. `castleProblems` checks the castle holds together (the wall closes round
// the courtyard, everything inside stands clear of the walls, a guard's way never jumps between
// the ground and the walk); the data's validation fails loudly on any of them.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** A stretch of curtain wall, laid out. Distances along it are from its `from` tower's middle. */
export interface LaidWall {
  id: string;
  from: string;
  to: string;
  /** Its `from` tower's middle (x, z), and the unit direction toward its `to` tower. */
  origin: Vec2;
  dir: Vec2;
  /** The unit direction out of the castle, square to the wall. */
  out: Vec2;
  /** From tower middle to tower middle (m). */
  length: number;
  /** Where it shows between its towers (along it): the walk runs this far. */
  clear: [number, number];
  /** Where its stonework starts and ends (along it), run into the towers so no seam shows. */
  body: [number, number];
  /** The walk: its middle line (at the wall's height) and width, between the towers. */
  walk: { from: Vec3; to: Vec3; width: number };
  /**
   * The columns it comes apart in, between its towers: each one's middle (along it) and length.
   * Each column is `wall.chunks.rows` chunks high, with a battlement (a stretch of parapet and two
   * merlons) on top.
   */
  columns: { at: number; length: number }[];
  /** Each merlon's middle, along the wall: a quarter of a column either side of its middle. */
  merlons: number[];
}

/** A kit piece placed in the world: its node, where its origin goes, turned about y (radians). */
export interface PlacedPiece {
  node: string;
  at: Vec3;
  turn: number;
}

/** A piece of a building's wall: the storey it's in (0 up) and its module's middle (x, z). */
export interface FacadePiece extends PlacedPiece {
  storey: number;
  middle: Vec2;
}

export interface LaidBuilding {
  id: string;
  min: Vec2;
  max: Vec2;
  /** Its walls' height (m) to the roof's foot. */
  height: number;
  /** How much of that never comes apart (m, from the ground): all of it, without `chunks`. */
  solidHeight: number;
  pieces: FacadePiece[];
}

export interface LaidStair {
  id: string;
  wall: string;
  /** In front of its first step, on the ground, and its top on the walk's middle line. */
  bottom: Vec3;
  top: Vec3;
  /** Its footprint (x, z), for keeping things off it. */
  min: Vec2;
  max: Vec2;
}

/**
 * A point on a guard's way: on the ground or on a wall's walk (and which wall), or in a tower at
 * its walks' height (on a way to the bell).
 */
export interface WayPoint {
  at: Vec3;
  level: 'ground' | 'walk';
  wall?: string;
  /** Set on a stair's ends: walking between them climbs the stair. */
  stair?: string;
  tower?: string;
}

/** A way to the bell's rope: its points from the post's end to the rope (the last). */
export interface BellRoute {
  id: string;
  /** The posts (guard paths and lookouts) whose guards take it. */
  from: string[];
  points: WayPoint[];
}

export interface CaptainWindow {
  building: string;
  /** The window's middle, in the wall's outer face, and the way it looks out (x, z). */
  at: Vec3;
  out: Vec2;
}

/**
 * The castle's parts that can come apart (the siege will break them; nothing breaks yet). The
 * curtain walls and round towers are built of chunks: each wall in columns of stacked blocks with
 * a battlement (parapet and two merlons) on top, each tower in rows of wedges round it, its top row
 * carrying its parapet and merlons. A gatehouse is built of blocks: its two piers and the stonework
 * over its gate, in rows, its top row carrying the parapet (its merlons stand on that). A
 * building's top storeys may be blocks too (`chunks`). Then each loose merlon (on a gatehouse or a
 * solid tower), each gate's leaves, each tower's tile roof, each building's roof, and the bell on
 * its frame. Slits, doorways and ivy are fixed to the chunk they're on (`of`) and go with it.
 * What's `solid` in the data (and a building's lower storeys) stays whole. Every part is drawn on
 * its own: the parts of a shape as instances of it, so many cost one draw.
 */
export const castlePartKinds = [
  'wallChunk',
  'battlement',
  'towerChunk',
  'gatehouseChunk',
  'storeyChunk',
  'merlon',
  'gate',
  'towerRoof',
  'roof',
  'bell',
  'slit',
  'doorway',
  'vine',
] as const;
export type CastlePartKind = (typeof castlePartKinds)[number];
/** The kinds that are pieces in their own right (the rest are fixed to one of these). */
export const castleBreakableKinds: readonly CastlePartKind[] = [
  'wallChunk',
  'battlement',
  'towerChunk',
  'gatehouseChunk',
  'storeyChunk',
  'merlon',
  'gate',
  'towerRoof',
  'roof',
  'bell',
];

export interface CastlePart {
  /** Unique: its owner's id, its kind and its number ("north.wallChunk.3"). */
  id: string;
  kind: CastlePartKind;
  /** The wall, tower, building or bell it belongs to. */
  owner: string;
  /**
   * Where it stands: its foot's middle, turned `turn` radians about y (a tower's wedge: the
   * tower's middle at the row's foot, turned to where the wedge starts). Its size: a box's (along,
   * up, across); a wedge's (radius, height, angle).
   */
  at: Vec3;
  turn: number;
  size: Vec3;
  /**
   * Parts drawn alike share a shape: one instanced mesh draws every part of a shape. A wall's
   * chunks and battlements are one shape whatever their length (each stretched along to its own).
   */
  shape: string;
  /** A chunk's row from the ground (0 up), and how many rows its wall or tower has. */
  row?: number;
  rows?: number;
  /**
   * The parts (by id) it's built on, for a gatehouse's blocks and merlons, a building's blocks and
   * its roof: if one goes, it comes loose. (A wall's and a round tower's chunks rest on the ones
   * under them, by their numbers.)
   */
  on?: string[];
  /** For a slit, doorway or vine: the chunk it's fixed to (none if that's solid). */
  of?: string;
  /** For a vine: the kit piece. */
  piece?: string;
}

export interface CastleLayout {
  /** The towers in order round the ring, and their middles: the courtyard's outline. */
  ring: string[];
  outline: Vec2[];
  walls: LaidWall[];
  buildings: LaidBuilding[];
  stairs: LaidStair[];
  parts: CastlePart[];
  anchors: {
    captainWindows: CaptainWindow[];
    /** Where the spear rack may stand: each a prop, its foot and turn (radians). */
    spearRacks: { id: string; at: Vec3; turn: number }[];
    /** The bell's foot and turn, and where its ringer stands at its rope (his feet). */
    bell: { at: Vec3; turn: number; rope: Vec3 };
    guardPaths: { id: string; loop: boolean; points: WayPoint[] }[];
    /** A guard's place on a tower's top: where his feet are, and the tower. */
    lookouts: { id: string; tower: string; at: Vec3 }[];
    bellRoutes: BellRoute[];
  };
}

export interface CastleProblem {
  path: (string | number)[];
  message: string;
}

const EPS = 1e-6;
const DEG = Math.PI / 180;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const along = (origin: Vec2, dir: Vec2, distance: number): Vec2 => [
  origin[0] + dir[0] * distance,
  origin[1] + dir[1] * distance,
];

/** Whether (x, z) is inside the polygon `outline` (ray casting). */
export function insidePolygon(point: Vec2, outline: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (!a || !b) continue;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** The distance from `point` to the segment `a`–`b`. */
export function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSq = ab[0] * ab[0] + ab[1] * ab[1];
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / lengthSq),
        );
  return Math.hypot(point[0] - (a[0] + ab[0] * t), point[1] - (a[1] + ab[1] * t));
}

/** Whether the segment `a`–`b` passes through the box `min`–`max` (x, z). */
export function segmentHitsBox(a: Vec2, b: Vec2, min: Vec2, max: Vec2): boolean {
  // Slab test: clip the segment against each axis's slab.
  let t0 = 0;
  let t1 = 1;
  for (const axis of [0, 1] as const) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < EPS) {
      if (a[axis] <= min[axis] || a[axis] >= max[axis]) return false;
      continue;
    }
    let near = (min[axis] - a[axis]) / d;
    let far = (max[axis] - a[axis]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 >= t1) return false;
  }
  return true;
}

function boxesOverlap(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean {
  return [0, 1].every(
    (axis) =>
      (a.min[axis] ?? 0) < (b.max[axis] ?? 0) - EPS &&
      (b.min[axis] ?? 0) < (a.max[axis] ?? 0) - EPS,
  );
}

function insideBox(point: Vec2, box: { min: Vec2; max: Vec2 }, margin = 0): boolean {
  return [0, 1].every(
    (axis) =>
      (point[axis] ?? 0) > (box.min[axis] ?? 0) - margin &&
      (point[axis] ?? 0) < (box.max[axis] ?? 0) + margin,
  );
}

/** Half a square tower's extent along x or z. */
function halfExtent(tower: CastleTower, axis: 0 | 1): number {
  return axis === 0 ? tower.size : (tower.depth ?? tower.size);
}

/**
 * How far from a tower's middle a wall leaving it along `dir` shows (its face), and how far in its
 * stonework may start so the tower hides the join: a round tower's side curves away, so the wall
 * runs in until its corners (its foot's included) are inside.
 */
function towerReach(
  tower: CastleTower,
  dir: Vec2,
  halfWidth: number,
): { face: number; body: number } {
  if (tower.shape === 'square') {
    const face = Math.abs(dir[0]) > 0.5 ? halfExtent(tower, 0) : halfExtent(tower, 1);
    return { face, body: Math.max(face - 0.05, 0) };
  }
  const r = tower.size;
  const inside = r * r - halfWidth * halfWidth;
  return { face: r, body: inside > 0 ? Math.sqrt(inside) - 0.1 : r * 0.3 };
}

/** The building's footprint (x, z). */
export function buildingBox(building: CastleBuilding, module: number): { min: Vec2; max: Vec2 } {
  const halfX = (building.modules[0] * module) / 2;
  const halfZ = (building.modules[1] * module) / 2;
  return {
    min: [building.at[0] - halfX, building.at[1] - halfZ],
    max: [building.at[0] + halfX, building.at[1] + halfZ],
  };
}

/** A side's outward direction, its pieces' turn (the kit's pieces face +z), and its module count. */
function sideFrame(side: CastleSide): { out: Vec2; turn: number; axis: 0 | 1 } {
  switch (side) {
    case 'front':
      return { out: [0, 1], turn: 0, axis: 0 };
    case 'back':
      return { out: [0, -1], turn: Math.PI, axis: 0 };
    case 'left':
      return { out: [-1, 0], turn: -Math.PI / 2, axis: 1 };
    case 'right':
      return { out: [1, 0], turn: Math.PI / 2, axis: 1 };
  }
}

/**
 * Module `index`'s middle on a building's side (x, z), counted left to right as seen from
 * outside, in the side's outer face.
 */
function moduleMiddle(
  building: CastleBuilding,
  module: number,
  side: CastleSide,
  index: number,
): Vec2 {
  const box = buildingBox(building, module);
  const offset = module * (index + 0.5);
  switch (side) {
    case 'front':
      return [box.min[0] + offset, box.max[1]];
    case 'back':
      return [box.max[0] - offset, box.min[1]];
    case 'left':
      return [box.min[0], box.min[1] + offset];
    case 'right':
      return [box.max[0], box.max[1] - offset];
  }
}

/** The towers in order round the ring, if the walls close round it once; or what's wrong. */
function ringOf(castle: Castle): { ring: string[]; walls: string[] } | { problem: CastleProblem } {
  const byTower = new Map<string, number[]>();
  castle.walls.forEach((wall, index) => {
    for (const end of [wall.from, wall.to]) byTower.set(end, [...(byTower.get(end) ?? []), index]);
  });
  for (const [index, tower] of castle.towers.entries()) {
    const count = byTower.get(tower.id)?.length ?? 0;
    if (count !== 2) {
      return {
        problem: {
          path: ['castle', 'towers', index],
          message: `Tower "${tower.id}" joins ${String(count)} walls; each joins two, closing the ring`,
        },
      };
    }
  }
  const first = castle.walls[0];
  if (!first) return { problem: { path: ['castle', 'walls'], message: 'No walls' } };
  const ring = [first.from];
  const order = [first.id];
  let at = first.to;
  let came = 0;
  while (at !== first.from) {
    ring.push(at);
    const next = (byTower.get(at) ?? []).find((index) => index !== came);
    const wall = next === undefined ? undefined : castle.walls[next];
    if (next === undefined || !wall) break;
    order.push(wall.id);
    came = next;
    at = wall.from === at ? wall.to : wall.from;
    if (ring.length > castle.towers.length) break;
  }
  if (ring.length !== castle.towers.length || order.length !== castle.walls.length) {
    return {
      problem: {
        path: ['castle', 'walls'],
        message: 'The walls must close one ring round the courtyard, through every tower',
      },
    };
  }
  return { ring, walls: order };
}

function layWall(castle: Castle, index: number, outline: readonly Vec2[]): LaidWall {
  const wall = castle.walls[index];
  if (!wall) throw new Error(`No wall ${String(index)}`);
  const from = castle.towers.find((tower) => tower.id === wall.from);
  const to = castle.towers.find((tower) => tower.id === wall.to);
  if (!from || !to) throw new Error(`Wall "${wall.id}" joins an unknown tower`);
  const delta = sub(to.at, from.at);
  const length = Math.hypot(delta[0], delta[1]);
  const dir: Vec2 = [delta[0] / length, delta[1] / length];
  // Out of the castle: whichever side of the wall isn't the courtyard.
  const side: Vec2 = [dir[1], -dir[0]];
  const middle = along(from.at, dir, length / 2);
  const out: Vec2 = insidePolygon(along(middle, side, 0.5), outline) ? [-side[0], -side[1]] : side;
  const { thickness, parapet, plinth, height } = castle.wall;
  const half = thickness / 2 + plinth.out;
  const start = towerReach(from, dir, half);
  const end = towerReach(to, [-dir[0], -dir[1]], half);
  const clear: [number, number] = [start.face, length - end.face];
  // The walk: from the inner face to the parapet, its middle line toward the courtyard.
  const width = thickness - parapet.thickness;
  const inward = parapet.thickness / 2;
  const walkPoint = (distance: number): Vec3 => {
    const [x, z] = along(along(from.at, dir, distance), out, -inward);
    return [x, height, z];
  };
  const span = clear[1] - clear[0];
  const count = Math.max(1, Math.round(span / castle.wall.chunks.length));
  const columnLength = span / count;
  const columns = Array.from({ length: count }, (_, i) => ({
    at: clear[0] + columnLength * (i + 0.5),
    length: columnLength,
  }));
  return {
    id: wall.id,
    from: wall.from,
    to: wall.to,
    origin: [from.at[0], from.at[1]],
    dir,
    out,
    length,
    clear,
    body: [start.body, length - end.body],
    walk: { from: walkPoint(clear[0]), to: walkPoint(clear[1]), width },
    columns,
    merlons: columns.flatMap((column) => [
      column.at - column.length / 4,
      column.at + column.length / 4,
    ]),
  };
}

function layBuilding(castle: Castle, building: CastleBuilding): LaidBuilding {
  const pieces: FacadePiece[] = [];
  for (const side of ['front', 'back', 'left', 'right'] as const) {
    const frame = sideFrame(side);
    building.facades[side].forEach((storey, level) => {
      Array.from(storey).forEach((letter, index) => {
        const kit = castle.facadePieces[letter as keyof Castle['facadePieces']];
        const [x, z] = moduleMiddle(building, castle.module, side, index);
        for (const piece of kit) {
          const turn = frame.turn + piece.turn * DEG;
          // The piece's own offset, turned with it.
          const [ox, oy, oz] = piece.offset;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          pieces.push({
            node: piece.node,
            at: [x + ox * cos + oz * sin, level * castle.storey + oy, z - ox * sin + oz * cos],
            turn,
            storey: level,
            middle: [x, z],
          });
        }
      });
    });
  }
  const box = buildingBox(building, castle.module);
  return {
    id: building.id,
    min: box.min,
    max: box.max,
    height: building.storeys * castle.storey,
    solidHeight: Math.max(building.storeys - (building.chunks?.storeys ?? 0), 0) * castle.storey,
    pieces,
  };
}

function layStair(castle: Castle, stair: Castle['stairs'][number], wall: LaidWall): LaidStair {
  const { thickness, height } = castle.wall;
  const sign = Math.sign(stair.run);
  // Against the wall's inner face, its middle line `width / 2` into the courtyard.
  const lateral = -(thickness / 2 + stair.width / 2);
  const point = (distance: number, sideways: number): Vec2 =>
    along(along(wall.origin, wall.dir, distance), wall.out, sideways);
  const foot = point(stair.start - sign * 0.8, lateral);
  const top = walkLine(wall, stair.start + stair.run, height, castle);
  const corners = [
    point(stair.start, -thickness / 2),
    point(stair.start + stair.run, -thickness / 2 - stair.width),
  ];
  const [a, b] = corners as [Vec2, Vec2];
  return {
    id: stair.id,
    wall: wall.id,
    bottom: [foot[0], 0, foot[1]],
    top,
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

/** The point `distance` along a wall on its walk's middle line. */
function walkLine(wall: LaidWall, distance: number, height: number, castle: Castle): Vec3 {
  const [x, z] = along(
    along(wall.origin, wall.dir, distance),
    wall.out,
    -castle.wall.parapet.thickness / 2,
  );
  return [x, height, z];
}

/** Lays the castle out. Throws on data `castleProblems` would have reported. */
export function layoutCastle(castle: Castle): CastleLayout {
  const ringed = ringOf(castle);
  if ('problem' in ringed) throw new Error(ringed.problem.message);
  const towerAt = (id: string): Vec2 => {
    const tower = castle.towers.find((candidate) => candidate.id === id);
    if (!tower) throw new Error(`Unknown tower "${id}"`);
    return [tower.at[0], tower.at[1]];
  };
  const outline = ringed.ring.map(towerAt);
  const walls = castle.walls.map((_, index) => layWall(castle, index, outline));
  const wallById = (id: string): LaidWall => {
    const wall = walls.find((candidate) => candidate.id === id);
    if (!wall) throw new Error(`Unknown wall "${id}"`);
    return wall;
  };
  const buildings = castle.buildings.map((building) => layBuilding(castle, building));
  const stairs = castle.stairs.map((stair) => layStair(castle, stair, wallById(stair.wall)));
  const stairById = (id: string): LaidStair => {
    const stair = stairs.find((candidate) => candidate.id === id);
    if (!stair) throw new Error(`Unknown stair "${id}"`);
    return stair;
  };

  const captainWindows = castle.anchors.captainWindows.map((anchor) => {
    const building = castle.buildings.find((candidate) => candidate.id === anchor.building);
    if (!building) throw new Error(`Unknown building "${anchor.building}"`);
    const [x, z] = moduleMiddle(building, castle.module, anchor.side, anchor.module);
    return {
      building: building.id,
      at: [x, anchor.storey * castle.storey + castle.windowMiddle, z] as Vec3,
      out: sideFrame(anchor.side).out,
    };
  });
  const spearRacks = castle.anchors.spearRacks.map((id) => {
    const rack = castle.props.find((prop) => prop.id === id);
    if (!rack) throw new Error(`Unknown prop "${id}"`);
    return { id, at: [rack.at[0], 0, rack.at[1]] as Vec3, turn: rack.turn * DEG };
  });
  const lookouts = castle.anchors.lookouts.map((lookout) => {
    const tower = castle.towers.find((candidate) => candidate.id === lookout.tower);
    if (!tower) throw new Error(`Unknown tower "${lookout.tower}"`);
    return {
      id: lookout.id,
      tower: tower.id,
      at: [tower.at[0] + lookout.at[0], tower.height, tower.at[1] + lookout.at[1]] as Vec3,
    };
  });

  const lay = (raw: readonly RouteWaypoint[]): WayPoint[] => {
    const points: WayPoint[] = [];
    raw.forEach((waypoint, index) => {
      if ('walk' in waypoint) {
        points.push({
          at: walkLine(wallById(waypoint.walk), waypoint.at, castle.wall.height, castle),
          level: 'walk',
          wall: waypoint.walk,
        });
      } else if ('ground' in waypoint) {
        points.push({ at: [waypoint.ground[0], 0, waypoint.ground[1]], level: 'ground' });
      } else if ('tower' in waypoint) {
        const [x, z] = towerAt(waypoint.tower);
        points.push({ at: [x, castle.wall.height, z], level: 'walk', tower: waypoint.tower });
      } else {
        const stair = stairById(waypoint.stair);
        const bottom: WayPoint = { at: stair.bottom, level: 'ground', stair: stair.id };
        const top: WayPoint = { at: stair.top, level: 'walk', wall: stair.wall, stair: stair.id };
        // Up, if it's come from the ground or goes on along the walk; down otherwise.
        const before = raw[index - 1];
        const after = raw[index + 1];
        const up =
          (before !== undefined && 'ground' in before) || (after !== undefined && 'walk' in after);
        points.push(...(up ? [bottom, top] : [top, bottom]));
      }
    });
    return points;
  };
  const guardPaths = castle.anchors.guardPaths.map((path) => ({
    id: path.id,
    loop: path.loop,
    points: lay(path.points),
  }));
  const rope = bellRope(castle);
  const bellRoutes = castle.anchors.bellRoutes.map((route) => ({
    id: route.id,
    from: [...route.from],
    points: [...lay(routeChain(castle, route)), { at: rope, level: 'ground' as const }],
  }));

  return {
    ring: ringed.ring,
    outline,
    walls,
    buildings,
    stairs,
    parts: layParts(castle, walls, buildings),
    anchors: {
      captainWindows,
      spearRacks,
      bell: {
        at: [castle.bell.at[0], 0, castle.bell.at[1]],
        turn: castle.bell.turn * DEG,
        rope,
      },
      guardPaths,
      lookouts,
      bellRoutes,
    },
  };
}

type RouteWaypoint = Castle['anchors']['bellRoutes'][number]['points'][number];

/** Where the bell's ringer stands, at its rope: `rope` from the frame's middle, turned with it. */
function bellRope(castle: Castle): Vec3 {
  const { at, turn, rope } = castle.bell;
  const angle = turn * DEG;
  // The frame's own x (along it) and z (out of it), turned about y as three.js turns them.
  const x = rope[0] * Math.cos(angle) + rope[1] * Math.sin(angle);
  const z = -rope[0] * Math.sin(angle) + rope[1] * Math.cos(angle);
  return [at[0] + x, 0, at[1] + z];
}

/** A bell route's waypoints, and on along the routes it goes on by (`then`), each once. */
function routeChain(
  castle: Castle,
  route: Castle['anchors']['bellRoutes'][number],
): RouteWaypoint[] {
  const points: RouteWaypoint[] = [];
  const seen = new Set<string>();
  let next: Castle['anchors']['bellRoutes'][number] | undefined = route;
  while (next && !seen.has(next.id)) {
    seen.add(next.id);
    points.push(...next.points);
    const then: string | undefined = next.then;
    next = then === undefined ? undefined : castle.anchors.bellRoutes.find((r) => r.id === then);
  }
  return points;
}

/** The way from post `post` (a guard path or a lookout) to the bell's rope, if it has one. */
export function bellRouteFrom(layout: CastleLayout, post: string): BellRoute | undefined {
  return layout.anchors.bellRoutes.find((route) => route.from.includes(post));
}

/** A wedge's angle round its tower, and its rows' height, for a round tower that comes apart. */
function towerChunking(castle: Castle, tower: CastleTower): { angle: number; row: number } {
  return {
    angle: (Math.PI * 2) / castle.towerChunks.sectors,
    row: tower.height / castle.towerChunks.rows,
  };
}

/**
 * The heights a gatehouse's rows of blocks run between, from the ground up: the bottom row as
 * high as its gate, the rest sharing what's above it.
 */
export function gatehouseRows(castle: Castle, tower: CastleTower): number[] {
  const rows = castle.gatehouseChunks.rows;
  const gate = tower.gate?.height ?? tower.height / rows;
  return Array.from({ length: rows + 1 }, (_, row) =>
    row === 0 ? 0 : gate + ((tower.height - gate) * (row - 1)) / (rows - 1),
  );
}

/**
 * Which of a gatehouse block's faces are the gatehouse's own outer faces, in the block's own
 * frame (a block turned half round has its x and z the other way); and whether it's over the gate.
 */
export function gatehouseFaces(
  castle: Castle,
  part: CastlePart,
): { xPlus: boolean; xMinus: boolean; zPlus: boolean; zMinus: boolean; over: boolean } {
  const tower = castle.towers.find((candidate) => candidate.id === part.owner);
  if (!tower) return { xPlus: false, xMinus: false, zPlus: false, zMinus: false, over: false };
  const halfX = tower.size;
  const halfZ = tower.depth ?? tower.size;
  const [length, , depth] = part.size;
  const dx = part.at[0] - tower.at[0];
  const dz = part.at[2] - tower.at[1];
  const world = {
    xPlus: Math.abs(dx + length / 2 - halfX) < 1e-6,
    xMinus: Math.abs(dx - length / 2 + halfX) < 1e-6,
    zPlus: Math.abs(dz + depth / 2 - halfZ) < 1e-6,
    zMinus: Math.abs(dz - depth / 2 + halfZ) < 1e-6,
  };
  const over = Math.abs(dx) < 1e-6;
  return Math.abs(part.turn) > 1
    ? { xPlus: world.xMinus, xMinus: world.xPlus, zPlus: world.zMinus, zMinus: world.zPlus, over }
    : { ...world, over };
}

/**
 * The stretches of a gatehouse's parapet a top-row block carries: one along each of the
 * gatehouse's edges the block is on, out on the corbels, in the block's own frame (`at`: x, z;
 * running along its x or its z).
 */
export function gatehouseEdges(
  castle: Castle,
  part: CastlePart,
): { at: [number, number]; length: number; alongX: boolean }[] {
  const faces = gatehouseFaces(castle, part);
  const out = castle.details.corbel.out;
  const thickness = castle.wall.parapet.thickness;
  const [length, , depth] = part.size;
  const edges: { at: [number, number]; length: number; alongX: boolean }[] = [];
  // Along x (a front or back edge): as long as the block, and out to the corner on a side edge.
  for (const sign of [1, -1]) {
    if (!(sign > 0 ? faces.zPlus : faces.zMinus)) continue;
    const from = -length / 2 - (faces.xMinus ? out : 0);
    const to = length / 2 + (faces.xPlus ? out : 0);
    edges.push({
      at: [(from + to) / 2, sign * (depth / 2 + out - thickness / 2)],
      length: to - from,
      alongX: true,
    });
  }
  // Along z (a side edge), between the front and back edges' stretches.
  for (const sign of [1, -1]) {
    if (!(sign > 0 ? faces.xPlus : faces.xMinus)) continue;
    const from = -depth / 2 - (faces.zMinus ? out - thickness : 0);
    const to = depth / 2 + (faces.zPlus ? out - thickness : 0);
    edges.push({
      at: [sign * (length / 2 + out - thickness / 2), (from + to) / 2],
      length: to - from,
      alongX: false,
    });
  }
  return edges;
}

const round3 = (value: number) => value.toFixed(3);

/** The middle of the towers' ring. */
export function middleOf(castle: Castle): Vec2 {
  const count = castle.towers.length;
  return castle.towers.reduce<Vec2>(
    (sum, tower) => [sum[0] + tower.at[0] / count, sum[1] + tower.at[1] / count],
    [0, 0],
  );
}

/** The parts that can come apart, laid out (see `CastlePart`). */
function layParts(castle: Castle, walls: LaidWall[], buildings: LaidBuilding[]): CastlePart[] {
  const parts: CastlePart[] = [];
  const { wall: w, details } = castle;
  const counts = new Map<string, number>();
  const add = (part: Omit<CastlePart, 'id'>): string => {
    const key = `${part.owner}.${part.kind}`;
    const number = counts.get(key) ?? 0;
    counts.set(key, number + 1);
    const id = `${key}.${String(number)}`;
    parts.push({ id, ...part });
    return id;
  };
  const [cx, cz] = middleOf(castle);
  const solidWall = (id: string) =>
    castle.walls.find((candidate) => candidate.id === id)?.solid ?? false;

  // Walls: columns of stacked chunks, a battlement on each.
  const parapetAt = w.thickness / 2 - w.parapet.thickness / 2;
  const rowHeight = w.height / w.chunks.rows;
  for (const wall of walls) {
    const turn = Math.atan2(wall.out[0], wall.out[1]);
    const point = (distance: number, sideways: number, y: number): Vec3 => {
      const [x, z] = along(along(wall.origin, wall.dir, distance), wall.out, sideways);
      return [x, y, z];
    };
    const rows = w.chunks.rows;
    for (const column of wall.columns) {
      if (!solidWall(wall.id)) {
        for (let row = 0; row < rows; row++) {
          add({
            kind: 'wallChunk',
            owner: wall.id,
            at: point(column.at, 0, row * rowHeight),
            turn,
            size: [column.length, rowHeight, w.thickness],
            shape: `wall:${round3(rowHeight)}:${String(row)}/${String(rows)}`,
            row,
            rows,
          });
        }
      }
      add({
        kind: 'battlement',
        owner: wall.id,
        at: point(column.at, parapetAt, w.height),
        turn,
        size: [column.length, w.parapet.height + w.merlon.height, w.parapet.thickness],
        shape: 'battlement',
      });
    }
  }
  /** The wall chunk at `distance` along a wall and `y` up, if the wall comes apart. */
  const wallChunkAt = (wall: LaidWall, distance: number, y: number): string | undefined => {
    if (solidWall(wall.id)) return undefined;
    const column = wall.columns.findIndex(
      (candidate) => Math.abs(distance - candidate.at) <= candidate.length / 2 + 1e-9,
    );
    if (column < 0) return undefined;
    const row = Math.max(0, Math.min(w.chunks.rows - 1, Math.floor(y / rowHeight)));
    return `${wall.id}.wallChunk.${String(column * w.chunks.rows + row)}`;
  };
  /** The tower wedge at `angle` round a tower and `y` up, if the tower comes apart. */
  const towerChunkAt = (tower: CastleTower, angle: number, y: number): string | undefined => {
    if (tower.solid || tower.shape !== 'round') return undefined;
    const chunking = towerChunking(castle, tower);
    const turn = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const sector = Math.min(castle.towerChunks.sectors - 1, Math.floor(turn / chunking.angle));
    const row = Math.max(0, Math.min(castle.towerChunks.rows - 1, Math.floor(y / chunking.row)));
    return `${tower.id}.towerChunk.${String(row * castle.towerChunks.sectors + sector)}`;
  };

  for (const tower of castle.towers) {
    const [x, z] = tower.at;
    const h = tower.height;
    const top = h + w.parapet.height;
    /** A gatehouse's block at a point, once its blocks are laid (see below). */
    let gatehouseBlockAt: (px: number, py: number, pz: number) => string | undefined = () =>
      undefined;
    if (tower.shape === 'round') {
      const rim = tower.size + details.corbel.out;
      if (!tower.solid) {
        const { angle, row: height } = towerChunking(castle, tower);
        const rows = castle.towerChunks.rows;
        for (let row = 0; row < rows; row++) {
          for (let sector = 0; sector < castle.towerChunks.sectors; sector++) {
            add({
              kind: 'towerChunk',
              owner: tower.id,
              at: [x, row * height, z],
              turn: sector * angle,
              size: [tower.size, height, angle],
              shape: `tower:${round3(tower.size)}:${round3(h)}:${tower.top}:${String(row)}/${String(rows)}`,
              row,
              rows,
            });
          }
        }
      } else if (tower.top === 'battlements') {
        // A solid tower's merlons still come off, one by one.
        const ring = rim - w.parapet.thickness / 2;
        const count = Math.floor((Math.PI * 2 * ring) / (w.merlon.width + w.merlon.gap));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          add({
            kind: 'merlon',
            owner: tower.id,
            at: [x + Math.sin(angle) * ring, top, z + Math.cos(angle) * ring],
            turn: angle,
            size: [w.merlon.width, w.merlon.height, w.parapet.thickness],
            shape: 'merlon',
          });
        }
      }
      if (tower.top === 'roof') {
        const across = (rim + castle.towerRoof.overhang) * 2;
        add({
          kind: 'towerRoof',
          owner: tower.id,
          at: [x, top, z],
          turn: 0,
          size: [across, across, across],
          shape: 'towerRoof',
        });
      }
      // Arrow slits looking out, away from the courtyard.
      const away = Math.atan2(x - cx, z - cz);
      for (const offset of [-0.7, 0.7]) {
        for (const y of [w.height * 0.45, (w.height + h) / 2]) {
          const angle = away + offset;
          const reach = tower.size - details.slit[2] / 2 + 0.04;
          const of = towerChunkAt(tower, angle, y);
          add({
            kind: 'slit',
            owner: tower.id,
            at: [x + Math.sin(angle) * reach, y, z + Math.cos(angle) * reach],
            turn: angle,
            size: details.slit,
            shape: 'slit',
            ...(of ? { of } : {}),
          });
        }
      }
    } else {
      const sx = tower.size;
      const sz = tower.depth ?? tower.size;
      // A gatehouse that comes apart: its piers (either side of the gate) and the stonework over
      // the gate, in blocks front to back, in rows. The left pier's are turned half round, so a
      // block's own +x is always away from the gate; the back blocks over the gate too, so their
      // own +z is always the gatehouse's face.
      const blocks: { id: string; min: Vec3; max: Vec3; top: boolean }[] = [];
      if (tower.gate && !tower.solid) {
        const { rows, deep } = castle.gatehouseChunks;
        const levels = gatehouseRows(castle, tower);
        const pier = sx - tower.gate.width / 2;
        const slab = (sz * 2) / deep;
        const ids = new Map<string, string>();
        for (let row = 0; row < rows; row++) {
          const y0 = levels[row] ?? 0;
          const height = (levels[row + 1] ?? h) - y0;
          for (let d = 0; d < deep; d++) {
            const zMid = z - sz + slab * (d + 0.5);
            const block = (
              column: -1 | 0 | 1,
              length: number,
              turned: boolean,
              on: (string | undefined)[],
            ) => {
              const xMid = x + column * (tower.gate ? tower.gate.width / 2 + pier / 2 : 0);
              const id = add({
                kind: 'gatehouseChunk',
                owner: tower.id,
                at: [xMid, y0, zMid],
                turn: turned ? Math.PI : 0,
                size: [length, height, slab],
                shape: `gatehouse:${tower.id}:${column === 0 ? 'over' : 'pier'}:${String(row)}:${String(turned ? deep - 1 - d : d)}`,
                row,
                rows,
                on: on.flatMap((entry) => (entry === undefined ? [] : [entry])),
              });
              ids.set(`${String(column)}:${String(row)}:${String(d)}`, id);
              blocks.push({
                id,
                min: [xMid - length / 2, y0, zMid - slab / 2],
                max: [xMid + length / 2, y0 + height, zMid + slab / 2],
                top: row === rows - 1,
              });
            };
            const under = (column: number, at: number) =>
              ids.get(`${String(column)}:${String(at)}:${String(d)}`);
            block(1, pier, false, [under(1, row - 1)]);
            block(-1, pier, true, [under(-1, row - 1)]);
            // Over the gate: the lowest is held between the piers' blocks beside it.
            if (row === 1) block(0, tower.gate.width, d < deep / 2, [under(1, 1), under(-1, 1)]);
            else if (row > 1) block(0, tower.gate.width, d < deep / 2, [under(0, row - 1)]);
          }
        }
      }
      /**
       * The gatehouse's block nearest a point (on its face, or out on its corbels), if it comes
       * apart: one of its top row for `top`, else one at the point's height.
       */
      const blockAt = (px: number, py: number, pz: number, top = false): string | undefined => {
        let best: { id: string; off: number } | undefined;
        for (const block of blocks) {
          if (top ? !block.top : py < block.min[1] || py > block.max[1]) continue;
          const off = Math.hypot(
            Math.max(block.min[0] - px, 0, px - block.max[0]),
            Math.max(block.min[2] - pz, 0, pz - block.max[2]),
          );
          if (!best || off < best.off - 1e-9) best = { id: block.id, off };
        }
        return best?.id;
      };
      gatehouseBlockAt = blockAt;
      // Round its top's four edges, standing out on the corbels.
      const edges: { length: number; half: number; turn: number; out: Vec2 }[] = [
        { length: sx * 2, half: sz, turn: 0, out: [0, 1] },
        { length: sx * 2, half: sz, turn: Math.PI, out: [0, -1] },
        { length: sz * 2, half: sx, turn: Math.PI / 2, out: [1, 0] },
        { length: sz * 2, half: sx, turn: -Math.PI / 2, out: [-1, 0] },
      ];
      for (const edge of edges) {
        const length = edge.length + details.corbel.out * 2;
        const reach = edge.half + details.corbel.out - w.parapet.thickness / 2;
        const pitch = w.merlon.width + w.merlon.gap;
        const count = Math.max(1, Math.floor((length + w.merlon.gap) / pitch));
        const used = count * w.merlon.width + (count - 1) * w.merlon.gap;
        const across: Vec2 = [Math.cos(edge.turn), -Math.sin(edge.turn)];
        for (let i = 0; i < count; i++) {
          const offset = -used / 2 + w.merlon.width / 2 + i * pitch;
          const mx = x + edge.out[0] * reach + across[0] * offset;
          const mz = z + edge.out[1] * reach + across[1] * offset;
          // On a gatehouse that comes apart, it stands on the block under it.
          const under = blockAt(mx, top, mz, true);
          add({
            kind: 'merlon',
            owner: tower.id,
            at: [mx, top, mz],
            turn: edge.turn,
            size: [w.merlon.width, w.merlon.height, w.parapet.thickness],
            shape: 'merlon',
            ...(under ? { on: [under] } : {}),
          });
        }
      }
      // Arrow slits on the face that looks out, either side of its middle.
      const outTurn =
        Math.abs(z - cz) >= Math.abs(x - cx)
          ? z > cz
            ? 0
            : Math.PI
          : x > cx
            ? Math.PI / 2
            : -Math.PI / 2;
      const facing: Vec2 = [Math.sin(outTurn), Math.cos(outTurn)];
      const across: Vec2 = [Math.cos(outTurn), -Math.sin(outTurn)];
      const depthOut = Math.abs(facing[1]) > 0.5 ? sz : sx;
      const reach = (Math.abs(facing[1]) > 0.5 ? sx : sz) * 0.55;
      for (const sideways of [-reach, reach]) {
        for (const y of [w.height * 0.45, (w.height + h) / 2]) {
          const out = depthOut - details.slit[2] / 2 + 0.04;
          const at: Vec3 = [
            x + facing[0] * out + across[0] * sideways,
            y,
            z + facing[1] * out + across[1] * sideways,
          ];
          const of = blockAt(at[0], at[1], at[2]);
          add({
            kind: 'slit',
            owner: tower.id,
            at,
            turn: outTurn,
            size: details.slit,
            shape: 'slit',
            ...(of ? { of } : {}),
          });
        }
      }
      if (tower.gate) {
        const { width, height } = tower.gate;
        add({
          kind: 'gate',
          owner: tower.id,
          at: [x, 0, z + sz - details.gateSetBack],
          turn: 0,
          size: [width, height, 0.16],
          shape: 'gate',
        });
      }
    }
    // A dark doorway where each wall's walk meets the tower.
    const joined = walls.filter((wall) => wall.from === tower.id || wall.to === tower.id);
    for (const wall of joined) {
      const toward: Vec2 = wall.from === tower.id ? wall.dir : [-wall.dir[0], -wall.dir[1]];
      const lateral = -w.parapet.thickness / 2;
      let at: Vec3;
      let turn: number;
      if (tower.shape === 'round') {
        const r = tower.size;
        const reach = Math.sqrt(Math.max(r * r - lateral * lateral, 0));
        turn = Math.atan2(
          toward[0] * reach + wall.out[0] * lateral,
          toward[1] * reach + wall.out[1] * lateral,
        );
        at = [x + Math.sin(turn) * (r - 0.08), w.height, z + Math.cos(turn) * (r - 0.08)];
      } else {
        const face = Math.abs(toward[0]) > 0.5 ? tower.size : (tower.depth ?? tower.size);
        at = [
          x + toward[0] * (face - 0.08) + wall.out[0] * lateral,
          w.height,
          z + toward[1] * (face - 0.08) + wall.out[1] * lateral,
        ];
        turn = Math.atan2(toward[0], toward[1]);
      }
      const of =
        towerChunkAt(tower, turn, w.height + 0.01) ??
        gatehouseBlockAt(at[0], w.height + details.doorway[1] / 2, at[2]);
      add({
        kind: 'doorway',
        owner: tower.id,
        at,
        turn,
        size: [details.doorway[0], details.doorway[1], 0.24],
        shape: 'doorway',
        ...(of ? { of } : {}),
      });
    }
  }

  for (const building of buildings) {
    const width = building.max[0] - building.min[0] + castle.roof.overhang * 2;
    const depth = building.max[1] - building.min[1] + castle.roof.overhang * 2;
    // Its top storeys in blocks, if they come apart: each on the one under it, the roof on the top
    // ones.
    const data = castle.buildings.find((candidate) => candidate.id === building.id);
    let under = new Map<string, string>();
    if (data?.chunks) {
      const chunks = data.chunks;
      for (let storey = data.storeys - chunks.storeys; storey < data.storeys; storey++) {
        const laid = new Map<string, string>();
        let x0 = building.min[0];
        chunks.across.forEach((across, i) => {
          const lengthX = across * castle.module;
          let z0 = building.min[1];
          chunks.deep.forEach((deep, j) => {
            const lengthZ = deep * castle.module;
            const key = `${String(i)}:${String(j)}`;
            const below = under.get(key);
            laid.set(
              key,
              add({
                kind: 'storeyChunk',
                owner: building.id,
                at: [x0 + lengthX / 2, storey * castle.storey, z0 + lengthZ / 2],
                turn: 0,
                size: [lengthX, castle.storey, lengthZ],
                shape: `storey:${building.id}`,
                on: below ? [below] : [],
              }),
            );
            z0 += lengthZ;
          });
          x0 += lengthX;
        });
        under = laid;
      }
    }
    add({
      kind: 'roof',
      owner: building.id,
      at: [
        (building.min[0] + building.max[0]) / 2,
        building.height,
        (building.min[1] + building.max[1]) / 2,
      ],
      turn: 0,
      size: [width, Math.min(width, depth) / 2, depth],
      shape: `roof:${building.id}`,
      on: [...under.values()],
    });
  }
  const bell = castle.bell;
  add({
    kind: 'bell',
    owner: bell.id,
    at: [bell.at[0], 0, bell.at[1]],
    turn: bell.turn * DEG,
    size: [bell.size[0], bell.size[1], 1],
    shape: 'bell',
  });

  // Ivy on the outer faces, scattered by a seeded draw so it's the same every time.
  const rng = new Rng(castle.vines.seed);
  const faces: ({ wall: LaidWall } | { tower: CastleTower })[] = [
    ...walls.map((wall) => ({ wall })),
    ...castle.towers.filter((tower) => tower.shape === 'round').map((tower) => ({ tower })),
  ];
  for (let i = 0; i < castle.vines.count; i++) {
    const face = faces[Math.floor(rng.next() * faces.length)];
    const piece = castle.vines.pieces[Math.floor(rng.next() * castle.vines.pieces.length)];
    const node = piece ? castle.pieces[piece]?.[0]?.node : undefined;
    if (!face || !node) continue;
    const y = w.height - w.course.height - rng.range(0.1, 1.4);
    if ('wall' in face) {
      const { wall } = face;
      const distance = rng.range(wall.clear[0] + 1, wall.clear[1] - 1);
      const [vx, vz] = along(
        along(wall.origin, wall.dir, distance),
        wall.out,
        w.thickness / 2 + 0.02,
      );
      const of = wallChunkAt(wall, distance, y);
      add({
        kind: 'vine',
        owner: wall.id,
        at: [vx, y, vz],
        turn: Math.atan2(wall.out[0], wall.out[1]),
        size: [1, 1, 1],
        shape: `vine:${node}`,
        piece: node,
        ...(of ? { of } : {}),
      });
    } else {
      const { tower } = face;
      const angle = Math.atan2(tower.at[0] - cx, tower.at[1] - cz) + rng.range(-1.2, 1.2);
      const r = tower.size + 0.02;
      const vy = y + rng.range(0, 2);
      const of = towerChunkAt(tower, angle, vy);
      add({
        kind: 'vine',
        owner: tower.id,
        at: [tower.at[0] + Math.sin(angle) * r, vy, tower.at[1] + Math.cos(angle) * r],
        turn: angle,
        size: [1, 1, 1],
        shape: `vine:${node}`,
        piece: node,
        ...(of ? { of } : {}),
      });
    }
  }
  return parts;
}

/**
 * A place a guard keeps at a post: his own stretch of a guard path (`from` to `to` m along it),
 * or a lookout on a tower.
 */
export type PostSlot =
  { post: string; kind: 'path'; from: number; to: number } | { post: string; kind: 'lookout' };

/** How long a guard path is (m), round its loop if it's one. */
export function pathLength(path: CastleLayout['anchors']['guardPaths'][number]): number {
  const { points, loop } = path;
  let total = 0;
  const legs = points.length - (loop ? 0 : 1);
  for (let i = 0; i < legs; i++) {
    const a = points[i]?.at;
    const b = points[(i + 1) % points.length]?.at;
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

/** The point `distance` m along a guard path (kept to its ends; round again, on a loop). */
export function pointAlong(
  path: CastleLayout['anchors']['guardPaths'][number],
  distance: number,
): Vec3 {
  const { points, loop } = path;
  const length = pathLength(path);
  let left = loop && length > 0 ? ((distance % length) + length) % length : distance;
  left = Math.min(Math.max(left, 0), length);
  const legs = points.length - (loop ? 0 : 1);
  for (let i = 0; i < legs; i++) {
    const a = points[i]?.at;
    const b = points[(i + 1) % points.length]?.at;
    if (!a || !b) continue;
    const leg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= leg || i === legs - 1) {
      const share = leg > 0 ? Math.min(left / leg, 1) : 0;
      return [
        a[0] + (b[0] - a[0]) * share,
        a[1] + (b[1] - a[1]) * share,
        a[2] + (b[2] - a[2]) * share,
      ];
    }
    left -= leg;
  }
  return points[0]?.at ?? [0, 0, 0];
}

/**
 * The places at `post` (a guard path or a lookout) a guard can keep, each `slot` m of the path
 * (as many as fit, evenly; at least one), or the lookout itself. None if there's no such post.
 */
export function postSlots(layout: CastleLayout, post: string, slot: number): PostSlot[] {
  if (layout.anchors.lookouts.some((lookout) => lookout.id === post)) {
    return [{ post, kind: 'lookout' }];
  }
  const path = layout.anchors.guardPaths.find((candidate) => candidate.id === post);
  if (!path) return [];
  const length = pathLength(path);
  const count = Math.max(1, Math.floor(length / slot + EPS));
  return Array.from({ length: count }, (_, index) => ({
    post,
    kind: 'path' as const,
    from: (length * index) / count,
    to: (length * (index + 1)) / count,
  }));
}

/** Every reason the castle doesn't hold together; none, if it does. */
export function castleProblems(castle: Castle): CastleProblem[] {
  const problems: CastleProblem[] = [];
  const issue = (path: (string | number)[], message: string) => {
    problems.push({ path: ['castle', ...path], message });
  };

  const seen = new Set<string>();
  const unique = (path: (string | number)[], id: string) => {
    if (seen.has(id)) issue(path, `Duplicate id "${id}"`);
    seen.add(id);
  };
  castle.towers.forEach((tower, index) => {
    unique(['towers', index, 'id'], tower.id);
  });
  castle.walls.forEach((wall, index) => {
    unique(['walls', index, 'id'], wall.id);
  });
  castle.buildings.forEach((building, index) => {
    unique(['buildings', index, 'id'], building.id);
  });
  castle.props.forEach((prop, index) => {
    unique(['props', index, 'id'], prop.id);
  });
  unique(['bell', 'id'], castle.bell.id);
  castle.stairs.forEach((stair, index) => {
    unique(['stairs', index, 'id'], stair.id);
  });

  const towers = new Map(castle.towers.map((tower) => [tower.id, tower]));
  castle.towers.forEach((tower, index) => {
    if (
      tower.at.some(
        (value) => Math.abs(value / castle.grid - Math.round(value / castle.grid)) > EPS,
      )
    ) {
      issue(['towers', index, 'at'], `Towers stand on the ${String(castle.grid)} m grid`);
    }
    if (tower.gate) {
      if (tower.shape !== 'square')
        issue(['towers', index, 'gate'], 'Only a square tower has a gate');
      if (tower.gate.width >= tower.size * 2) {
        issue(['towers', index, 'gate'], 'The gate must be narrower than its tower');
      }
      if (tower.gate.height >= tower.height) {
        issue(['towers', index, 'gate'], 'The gate must be lower than its tower');
      }
    }
    if (tower.shape === 'square' && !tower.solid && !tower.gate) {
      issue(
        ['towers', index, 'solid'],
        'A square tower without a gate is solid (only gatehouses and round towers come apart)',
      );
    }
    if (tower.height <= castle.wall.height + castle.wall.parapet.height) {
      issue(['towers', index, 'height'], 'A tower must stand above the wall and its parapet');
    }
  });
  let broken = false;
  for (const [index, wall] of castle.walls.entries()) {
    for (const end of ['from', 'to'] as const) {
      if (!towers.has(wall[end])) {
        issue(['walls', index, end], `Unknown tower "${wall[end]}"`);
        broken = true;
      }
    }
    const from = towers.get(wall.from);
    const to = towers.get(wall.to);
    if (!from || !to) continue;
    if (from === to) {
      issue(['walls', index], 'A wall must join two towers');
      broken = true;
    } else if (Math.abs(from.at[0] - to.at[0]) > EPS && Math.abs(from.at[1] - to.at[1]) > EPS) {
      issue(['walls', index], 'A wall runs straight along x or z');
    }
  }
  if (broken) return problems;
  const ringed = ringOf(castle);
  if ('problem' in ringed) {
    problems.push(ringed.problem);
    return problems;
  }
  // References, before anything is laid out by them.
  const before = problems.length;
  const wallIds = new Set(castle.walls.map((wall) => wall.id));
  const stairIds = new Set(castle.stairs.map((stair) => stair.id));
  castle.stairs.forEach((stair, index) => {
    if (!wallIds.has(stair.wall)) issue(['stairs', index, 'wall'], `Unknown wall "${stair.wall}"`);
  });
  castle.anchors.captainWindows.forEach((anchor, index) => {
    if (!castle.buildings.some((building) => building.id === anchor.building)) {
      issue(
        ['anchors', 'captainWindows', index, 'building'],
        `Unknown building "${anchor.building}"`,
      );
    }
  });
  castle.anchors.spearRacks.forEach((rack, index) => {
    if (!castle.props.some((prop) => prop.id === rack)) {
      issue(['anchors', 'spearRacks', index], `Unknown prop "${rack}"`);
    }
  });
  castle.anchors.lookouts.forEach((lookout, index) => {
    unique(['anchors', 'lookouts', index, 'id'], lookout.id);
    const tower = towers.get(lookout.tower);
    if (!tower) {
      issue(['anchors', 'lookouts', index, 'tower'], `Unknown tower "${lookout.tower}"`);
      return;
    }
    if (tower.top !== 'battlements') {
      issue(
        ['anchors', 'lookouts', index, 'tower'],
        'A lookout stands on a tower with battlements',
      );
    }
    // Inside its parapet (the corbels carry the parapet out past the tower's own face).
    const inner = tower.size + castle.details.corbel.out - castle.wall.parapet.thickness;
    const [dx, dz] = lookout.at;
    const inside =
      tower.shape === 'round'
        ? Math.hypot(dx, dz) < inner
        : Math.abs(dx) < inner && Math.abs(dz) < (tower.depth ?? tower.size) + inner - tower.size;
    if (!inside) issue(['anchors', 'lookouts', index, 'at'], 'Stand inside the tower’s parapet');
  });
  castle.anchors.guardPaths.forEach((guardPath, index) => {
    unique(['anchors', 'guardPaths', index, 'id'], guardPath.id);
  });
  castle.anchors.guardPaths.forEach((guardPath, index) => {
    guardPath.points.forEach((point, pointIndex) => {
      const here = ['anchors', 'guardPaths', index, 'points', pointIndex];
      if ('walk' in point && !wallIds.has(point.walk)) issue(here, `Unknown wall "${point.walk}"`);
      if ('stair' in point && !stairIds.has(point.stair))
        issue(here, `Unknown stair "${point.stair}"`);
    });
  });
  const posts = new Set([
    ...castle.anchors.guardPaths.map((path) => path.id),
    ...castle.anchors.lookouts.map((lookout) => lookout.id),
  ]);
  const routeIds = new Set(castle.anchors.bellRoutes.map((route) => route.id));
  const routed = new Set<string>();
  castle.anchors.bellRoutes.forEach((route, index) => {
    const path = ['anchors', 'bellRoutes', index];
    unique([...path, 'id'], route.id);
    route.points.forEach((point, pointIndex) => {
      const here = [...path, 'points', pointIndex];
      if ('walk' in point && !wallIds.has(point.walk)) issue(here, `Unknown wall "${point.walk}"`);
      if ('stair' in point && !stairIds.has(point.stair))
        issue(here, `Unknown stair "${point.stair}"`);
      if ('tower' in point && !towers.has(point.tower))
        issue(here, `Unknown tower "${point.tower}"`);
    });
    route.from.forEach((post, postIndex) => {
      if (!posts.has(post)) issue([...path, 'from', postIndex], `Unknown post "${post}"`);
      else if (routed.has(post)) {
        issue([...path, 'from', postIndex], `Post "${post}" already has a way to the bell`);
      }
      routed.add(post);
    });
    if (route.then !== undefined && !routeIds.has(route.then)) {
      issue([...path, 'then'], `Unknown route "${route.then}"`);
    }
    // Following `then` must come to an end.
    const seen = new Set<string>();
    for (let next: typeof route | undefined = route; next;) {
      if (seen.has(next.id)) {
        issue([...path, 'then'], `Route "${route.id}" goes round in a circle`);
        break;
      }
      seen.add(next.id);
      const then: string | undefined = next.then;
      next = castle.anchors.bellRoutes.find((candidate) => candidate.id === then);
    }
  });
  if (problems.length > before) return problems;
  const layout = layoutCastle(castle);
  const { walls, outline } = layout;

  // Walls only meet at their towers.
  walls.forEach((wall, index) => {
    if (wall.columns.some((column) => column.length / 2 <= castle.wall.merlon.width)) {
      issue(
        ['wall', 'chunks', 'length'],
        `Wall "${wall.id}"'s columns are too short for two merlons`,
      );
    }
    if (wall.clear[1] - wall.clear[0] < castle.grid) {
      issue(['walls', index], `Wall "${wall.id}" barely shows between its towers`);
    }
    walls.slice(index + 1).forEach((other) => {
      if ([wall.from, wall.to].some((end) => end === other.from || end === other.to)) return;
      const a = along(wall.origin, wall.dir, wall.length);
      const b = along(other.origin, other.dir, other.length);
      const crosses =
        segmentDistance(wall.origin, other.origin, b) < EPS ||
        segmentDistance(a, other.origin, b) < EPS ||
        segmentDistance(other.origin, wall.origin, a) < EPS ||
        segmentDistance(b, wall.origin, a) < EPS ||
        segmentsCross(wall.origin, a, other.origin, b);
      if (crosses) issue(['walls', index], `Wall "${wall.id}" crosses wall "${other.id}"`);
    });
  });
  // A gate passes front to back: the walls either side of it run across.
  castle.towers.forEach((tower, index) => {
    if (!tower.gate) return;
    const across = walls
      .filter((wall) => wall.from === tower.id || wall.to === tower.id)
      .every((wall) => Math.abs(wall.dir[1]) < EPS);
    if (!across) issue(['towers', index, 'gate'], 'The walls either side of a gate run along x');
  });

  // The courtyard: inside the ring, clear of the walls' feet and the towers.
  const wallClearance = castle.wall.thickness / 2 + castle.wall.plinth.out;
  const inCourtyard = (point: Vec2, margin = 0): boolean => {
    if (!insidePolygon(point, outline)) return false;
    for (const wall of walls) {
      const end = along(wall.origin, wall.dir, wall.length);
      if (segmentDistance(point, wall.origin, end) < wallClearance + margin) return false;
    }
    for (const tower of castle.towers) {
      const reach = Math.max(tower.size, tower.depth ?? 0);
      if (Math.hypot(point[0] - tower.at[0], point[1] - tower.at[1]) < reach + margin) return false;
    }
    return true;
  };
  const buildingBoxes = castle.buildings.map((building) => buildingBox(building, castle.module));
  const inBuilding = (point: Vec2, margin = 0) =>
    buildingBoxes.some((box) => insideBox(point, box, margin));

  castle.buildings.forEach((building, index) => {
    const path = ['buildings', index];
    const box = buildingBoxes[index];
    if (!box) return;
    const corners: Vec2[] = [box.min, box.max, [box.min[0], box.max[1]], [box.max[0], box.min[1]]];
    if (!corners.every((corner) => inCourtyard(corner))) {
      issue(path, `Building "${building.id}" must stand in the courtyard, clear of the walls`);
    }
    buildingBoxes.slice(index + 1).forEach((other, offset) => {
      if (boxesOverlap(box, other)) {
        issue(
          path,
          `Building "${building.id}" overlaps "${castle.buildings[index + 1 + offset]?.id ?? ''}"`,
        );
      }
    });
    if (building.chunks) {
      const { storeys, across, deep } = building.chunks;
      const sum = (list: readonly number[]) => list.reduce((total, value) => total + value, 0);
      if (storeys > building.storeys) {
        issue([...path, 'chunks', 'storeys'], 'No more storeys come apart than it has');
      }
      if (sum(across) !== building.modules[0]) {
        issue(
          [...path, 'chunks', 'across'],
          `Its blocks across must add up to ${String(building.modules[0])} modules`,
        );
      }
      if (sum(deep) !== building.modules[1]) {
        issue(
          [...path, 'chunks', 'deep'],
          `Its blocks deep must add up to ${String(building.modules[1])} modules`,
        );
      }
    }
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const storeys = building.facades[side];
      const modules = building.modules[sideFrame(side).axis];
      if (storeys.length !== building.storeys) {
        issue(
          [...path, 'facades', side],
          `Give ${String(building.storeys)} storeys, from the ground up`,
        );
      }
      storeys.forEach((storey, level) => {
        if (storey.length !== modules) {
          issue(
            [...path, 'facades', side, level],
            `Give ${String(modules)} modules, one letter each`,
          );
        }
        if (level > 0 && storey.includes('d')) {
          issue([...path, 'facades', side, level], 'Doors go on the ground floor');
        }
      });
    }
  });

  castle.anchors.captainWindows.forEach((anchor, index) => {
    const path = ['anchors', 'captainWindows', index];
    const building = castle.buildings.find((candidate) => candidate.id === anchor.building);
    if (!building) return;
    const letter = building.facades[anchor.side][anchor.storey]?.[anchor.module];
    if (letter !== 't' && letter !== 'w') {
      issue(
        path,
        `Not a window: ${anchor.side} storey ${String(anchor.storey)} module ${String(anchor.module)}`,
      );
    }
  });

  castle.props.forEach((prop, index) => {
    if (!(prop.piece in castle.pieces))
      issue(['props', index, 'piece'], `Unknown piece "${prop.piece}"`);
    if (!(prop.piece in castle.boxes)) {
      issue(['props', index, 'piece'], `Piece "${prop.piece}" needs a box (what spears hit)`);
    }
    if (!inCourtyard(prop.at) || inBuilding(prop.at, 0.5)) {
      issue(
        ['props', index, 'at'],
        `Prop "${prop.id}" must stand in the courtyard, clear of buildings`,
      );
    }
  });
  castle.dressing.forEach((dressing, index) => {
    if (!(dressing.piece in castle.pieces)) {
      issue(['dressing', index, 'piece'], `Unknown piece "${dressing.piece}"`);
    }
  });
  castle.vines.pieces.forEach((piece, index) => {
    if (!(piece in castle.pieces)) issue(['vines', 'pieces', index], `Unknown piece "${piece}"`);
  });
  if (
    !inCourtyard(castle.bell.at, castle.bell.size[0] / 2) ||
    inBuilding(castle.bell.at, castle.bell.size[0] / 2)
  ) {
    issue(['bell', 'at'], 'The bell must stand in the courtyard, clear of walls and buildings');
  }

  const stairOk = new Set<string>();
  castle.stairs.forEach((stair, index) => {
    const path = ['stairs', index];
    const wall = walls.find((candidate) => candidate.id === stair.wall);
    if (!wall) return;
    const ends = [stair.start, stair.start + stair.run];
    if (ends.some((end) => end < wall.clear[0] || end > wall.clear[1])) {
      issue(path, `Stair "${stair.id}" must climb within wall "${wall.id}"'s span`);
      return;
    }
    const laid = layout.stairs[index];
    if (laid && buildingBoxes.some((box) => boxesOverlap(laid, box))) {
      issue(path, `Stair "${stair.id}" runs into a building`);
      return;
    }
    stairOk.add(stair.id);
  });

  castle.anchors.guardPaths.forEach((guardPath, index) => {
    const path = ['anchors', 'guardPaths', index];
    // A path up a stair that's broken itself (reported with the stair) isn't checked further.
    const known = guardPath.points.every(
      (point) => !('stair' in point) || stairOk.has(point.stair),
    );
    guardPath.points.forEach((point, pointIndex) => {
      const here = [...path, 'points', pointIndex];
      if ('walk' in point) {
        const wall = walls.find((candidate) => candidate.id === point.walk);
        if (wall && (point.at < wall.clear[0] || point.at > wall.clear[1])) {
          issue(here, `Off the end of wall "${wall.id}"'s walk`);
        }
      } else if ('ground' in point) {
        if (!inCourtyard(point.ground) || inBuilding(point.ground)) {
          issue(here, 'On the ground in the courtyard, clear of buildings');
        }
      }
    });
    if (!known) return;
    const laidPath = layout.anchors.guardPaths[index];
    if (!laidPath) return;
    const points = laidPath.points;
    const pairs = points.length - (guardPath.loop ? 0 : 1);
    for (let i = 0; i < pairs; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a || !b) continue;
      if (a.stair !== undefined && a.stair === b.stair) continue;
      if (a.level !== b.level) {
        issue(path, `Steps between the ground and the walk without a stair (point ${String(i)})`);
      } else if (a.level === 'walk' && a.wall !== b.wall) {
        issue(
          path,
          `Leaves wall "${a.wall ?? ''}"'s walk for "${b.wall ?? ''}" (point ${String(i)})`,
        );
      } else if (
        a.level === 'ground' &&
        buildingBoxes.some((box) =>
          segmentHitsBox([a.at[0], a.at[2]], [b.at[0], b.at[2]], box.min, box.max),
        )
      ) {
        issue(path, `Walks through a building (point ${String(i)})`);
      }
    }
  });

  // The ways to the bell: each step stays on its level, changes it by a stair, or goes through a
  // tower between its walls' walks; it ends on the ground, and crosses to the rope from there.
  const wallsOf = (tower: string) =>
    walls.filter((wall) => wall.from === tower || wall.to === tower).map((wall) => wall.id);
  const stepProblem = (a: WayPoint, b: WayPoint): string | undefined => {
    if (a.stair !== undefined && a.stair === b.stair) return undefined;
    if (a.tower !== undefined || b.tower !== undefined) {
      if (a.tower !== undefined && b.tower !== undefined) {
        return a.tower === b.tower ? undefined : 'Goes from tower to tower without a walk';
      }
      const tower = a.tower ?? b.tower ?? '';
      const other = a.tower === undefined ? a : b;
      return other.wall !== undefined &&
        other.stair === undefined &&
        wallsOf(tower).includes(other.wall)
        ? undefined
        : `Goes in or out of tower "${tower}" other than along its walls' walks`;
    }
    if (a.level !== b.level) return 'Steps between the ground and the walk without a stair';
    if (a.level === 'walk' && a.wall !== b.wall) {
      return `Leaves wall "${a.wall ?? ''}"'s walk for "${b.wall ?? ''}"`;
    }
    if (
      a.level === 'ground' &&
      buildingBoxes.some((box) =>
        segmentHitsBox([a.at[0], a.at[2]], [b.at[0], b.at[2]], box.min, box.max),
      )
    ) {
      return 'Walks through a building';
    }
    return undefined;
  };
  const rope = layout.anchors.bell.rope;
  if (!inCourtyard([rope[0], rope[2]]) || inBuilding([rope[0], rope[2]])) {
    issue(['bell', 'rope'], 'The rope must hang in the courtyard, clear of buildings');
  }
  castle.anchors.bellRoutes.forEach((route, index) => {
    const path = ['anchors', 'bellRoutes', index];
    route.points.forEach((point, pointIndex) => {
      const here = [...path, 'points', pointIndex];
      if ('walk' in point) {
        const wall = walls.find((candidate) => candidate.id === point.walk);
        if (wall && (point.at < wall.clear[0] || point.at > wall.clear[1])) {
          issue(here, `Off the end of wall "${wall.id}"'s walk`);
        }
      } else if ('ground' in point) {
        if (!inCourtyard(point.ground) || inBuilding(point.ground)) {
          issue(here, 'On the ground in the courtyard, clear of buildings');
        }
      } else if ('stair' in point && !stairOk.has(point.stair)) {
        issue(here, `Stair "${point.stair}" is broken`);
      }
    });
    const laid = layout.anchors.bellRoutes[index];
    if (!laid) return;
    const points = laid.points;
    if (points.at(-2)?.level !== 'ground') {
      issue(path, 'End on the courtyard’s ground, to cross to the bell’s rope');
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a || !b) continue;
      const problem = stepProblem(a, b);
      if (problem) issue(path, `${problem} (point ${String(i - 1)})`);
    }
    // From each of its posts onto its first point.
    const first = points[0];
    route.from.forEach((post, postIndex) => {
      if (!first) return;
      const lookout = layout.anchors.lookouts.find((entry) => entry.id === post);
      const guardPath = layout.anchors.guardPaths.find((entry) => entry.id === post);
      const end: WayPoint | undefined = lookout
        ? { at: lookout.at, level: 'walk', tower: lookout.tower }
        : guardPath?.points.at(-1);
      const problem = end && stepProblem(end, first);
      if (problem) issue([...path, 'from', postIndex], `From "${post}": ${problem}`);
    });
  });

  castle.vantages.forEach((vantage, index) => {
    const point: Vec2 = [vantage.at[0], vantage.at[2]];
    if (insidePolygon(point, outline)) {
      issue(['vantages', index, 'at'], `Vantage "${vantage.id}" must be outside the walls`);
    }
    if (vantage.at.every((value, axis) => Math.abs(value - (vantage.look[axis] ?? 0)) < EPS)) {
      issue(['vantages', index, 'look'], 'Look somewhere other than where you stand');
    }
  });

  const { pitch, distance } = castle.preview;
  if (pitch.min > pitch.start || pitch.start > pitch.max) {
    issue(['preview', 'pitch'], 'Start between min and max');
  }
  if (distance.min > distance.start || distance.start > distance.max) {
    issue(['preview', 'distance'], 'Start between min and max');
  }
  return problems;
}

/** Whether two segments cross (properly, not just touch). */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const turn = (p: Vec2, q: Vec2, r: Vec2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = turn(c, d, a);
  const d2 = turn(c, d, b);
  const d3 = turn(a, b, c);
  const d4 = turn(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
