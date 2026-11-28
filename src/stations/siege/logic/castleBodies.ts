import {
  castleBreakableKinds,
  type Castle,
  type CastleLayout,
  type CastlePart,
  type Siege,
  type SiegePartKind,
  type Vec3,
} from '../../../data';

// The castle as the siege's bodies: pure numbers (no physics engine), built from its layout, so
// what the rules hit is where the castle is drawn. Each part that can come apart is a body of one
// or more shapes in its own frame (its foot's middle, turned about y), resting on the parts it's
// built on (a wall's upper chunks on the ones under them, a battlement on its column, a tower's
// rows on the rows below, its roof on its top row). What never comes apart (the keep, the gatehouse,
// the stretches of wall inside the towers, the stairs, the props) is one fixed body of shapes.

/** A shape in a body's frame: a box (half its size, its middle), a convex hull, or a cone. */
export type BodyShape =
  | { kind: 'box'; half: Vec3; at: Vec3; turn: number }
  | { kind: 'hull'; points: Vec3[] }
  | { kind: 'cone'; radius: number; height: number; at: Vec3 };

/** One of the castle's parts as a body. */
export interface PartBody {
  id: string;
  kind: SiegePartKind;
  /** The wall, tower, building or bell it belongs to (the prop, for the spear rack). */
  owner: string;
  /** Its frame: its foot's middle, turned `turn` radians about y. */
  foot: Vec3;
  turn: number;
  shapes: BodyShape[];
  /** The parts (by index) it's built on: if one goes, it comes loose. */
  supports: number[];
  /**
   * Where a guard can stand on it, in its frame: its top's height, and the footprint (a box's
   * half sizes across x and z, or a wedge's radius and its angles).
   */
  top:
    | { kind: 'box'; y: number; half: [number, number] }
    | { kind: 'wedge'; y: number; radius: number; from: number; to: number }
    | undefined;
}

/** The castle's bodies: what never comes apart, and each part that can. */
export interface CastleBodies {
  /** In the world's frame. */
  solids: BodyShape[];
  parts: PartBody[];
}

const UP_HULL_SIDES = 4;

/** A point turned `turn` radians about y (as three.js turns: +z toward +x). */
export function turnY(point: Vec3, turn: number): Vec3 {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos];
}

/** A box `size` (x, y, z) standing on `foot` (its bottom's middle), turned `turn` in its frame. */
function standing(size: readonly number[], foot: Vec3 = [0, 0, 0], turn = 0): BodyShape {
  const [x = 0, y = 0, z = 0] = size;
  return {
    kind: 'box',
    half: [x / 2, y / 2, z / 2],
    at: [foot[0], foot[1] + y / 2, foot[2]],
    turn,
  };
}

/**
 * The castle's bodies, from its layout: every part that can come apart (and the spear rack the
 * round keeps, `rack`), and the solid rest. Each part's body is `gap` m short of it along the way
 * it meets its neighbours, so a loose one slides free.
 */
export function castleBodies(
  castle: Castle,
  layout: CastleLayout,
  bodies: Siege['bodies'],
  rack: string | undefined,
): CastleBodies {
  const gap = bodies.gap;
  const { wall: w, details } = castle;
  const parts: PartBody[] = [];
  const index = new Map<string, number>();
  const breakable = layout.parts.filter((part) => castleBreakableKinds.includes(part.kind));
  breakable.forEach((part, at) => index.set(part.id, at));
  const of = (id: string) => index.get(id);
  const solidWall = (id: string) => castle.walls.find((wall) => wall.id === id)?.solid ?? false;

  for (const part of breakable) {
    const shapes: BodyShape[] = [];
    const supports: number[] = [];
    let top: PartBody['top'];
    const kind = part.kind as SiegePartKind;
    const [length, height, depth] = part.size;
    const below = (id: string) => {
      const found = of(id);
      if (found !== undefined) supports.push(found);
    };
    const number = Number(part.id.slice(part.id.lastIndexOf('.') + 1));
    switch (part.kind) {
      case 'wallChunk': {
        shapes.push(standing([length - gap * 2, height, depth]));
        const rows = part.rows ?? 1;
        if ((part.row ?? 0) > 0) below(`${part.owner}.wallChunk.${String(number - 1)}`);
        if ((part.row ?? 0) === rows - 1) {
          // The walk: from the inner face to the parapet.
          top = { kind: 'box', y: height, half: [length / 2, depth / 2] };
        }
        break;
      }
      case 'battlement': {
        shapes.push(standing([length - gap * 2, w.parapet.height, w.parapet.thickness]));
        for (const x of [-length / 4, length / 4]) {
          shapes.push(
            standing(
              [w.merlon.width, w.merlon.height, w.parapet.thickness],
              [x, w.parapet.height, 0],
            ),
          );
        }
        if (!solidWall(part.owner)) {
          const rows = w.chunks.rows;
          below(`${part.owner}.wallChunk.${String(number * rows + rows - 1)}`);
        }
        break;
      }
      case 'towerChunk': {
        const tower = castle.towers.find((candidate) => candidate.id === part.owner);
        if (!tower) throw new Error(`No tower "${part.owner}"`);
        const [radius, rowHeight, angle] = part.size;
        const sectors = castle.towerChunks.sectors;
        const row = part.row ?? 0;
        const last = row === (part.rows ?? 1) - 1;
        const trim = gap / Math.max(radius, 0.1);
        const fan = (
          from: number,
          to: number,
          inner: number,
          outer: number,
          y0: number,
          y1: number,
        ) => {
          const points: Vec3[] = [];
          for (let i = 0; i <= UP_HULL_SIDES; i++) {
            const a = from + ((to - from) * i) / UP_HULL_SIDES;
            for (const y of [y0, y1]) {
              points.push([Math.sin(a) * outer, y, Math.cos(a) * outer]);
              if (inner > 0) points.push([Math.sin(a) * inner, y, Math.cos(a) * inner]);
            }
          }
          if (inner <= 0) points.push([0, y0, 0], [0, y1, 0]);
          return { kind: 'hull' as const, points };
        };
        if (!last) {
          shapes.push(fan(trim, angle - trim, 0, radius, 0, rowHeight));
        } else {
          const rim = radius + details.corbel.out;
          const walk = rowHeight;
          shapes.push(fan(trim, angle - trim, 0, radius, 0, walk - details.corbel.height));
          shapes.push(fan(trim, angle - trim, 0, rim, walk - details.corbel.height, walk));
          if (tower.top === 'roof') {
            shapes.push(fan(trim, angle - trim, 0, rim, walk, walk + w.parapet.height));
          } else {
            // The parapet's stretch round it, in two halves (a hull of the whole would fill in
            // the walk inside it), and its share of the merlons.
            const inner = rim - w.parapet.thickness;
            const middle = angle / 2;
            shapes.push(fan(trim, middle, inner, rim, walk, walk + w.parapet.height));
            shapes.push(fan(middle, angle - trim, inner, rim, walk, walk + w.parapet.height));
            const ring = rim - w.parapet.thickness / 2;
            const all = Math.floor((Math.PI * 2 * ring) / (w.merlon.width + w.merlon.gap));
            const each = Math.max(1, Math.round(all / sectors));
            for (let i = 0; i < each; i++) {
              const turn = (angle * (i + 0.5)) / each;
              shapes.push(
                standing(
                  [w.merlon.width, w.merlon.height, w.parapet.thickness],
                  [Math.sin(turn) * ring, walk + w.parapet.height, Math.cos(turn) * ring],
                  turn,
                ),
              );
            }
            top = { kind: 'wedge', y: walk, radius: inner, from: 0, to: angle };
          }
        }
        if (row > 0) below(`${part.owner}.towerChunk.${String(number - sectors)}`);
        break;
      }
      case 'merlon':
        shapes.push(standing([length - gap * 2, height, depth]));
        break;
      case 'gate':
        shapes.push(standing([length, height, depth], [0, 0, depth / 2]));
        break;
      case 'towerRoof': {
        const across = length;
        shapes.push({
          kind: 'cone',
          radius: across / 2 - gap,
          height: across * castle.towerRoof.rise,
          at: [0, 0, 0],
        });
        const tower = castle.towers.find((candidate) => candidate.id === part.owner);
        if (tower && !tower.solid) {
          const sectors = castle.towerChunks.sectors;
          const rows = castle.towerChunks.rows;
          for (let sector = 0; sector < sectors; sector++) {
            below(`${part.owner}.towerChunk.${String((rows - 1) * sectors + sector)}`);
          }
        }
        break;
      }
      case 'roof': {
        // A ridge roof: its ridge along its longer side.
        const [x, rise, z] = [length / 2, height, depth / 2];
        const ridge: Vec3[] =
          x >= z
            ? [
                [-x, rise, 0],
                [x, rise, 0],
              ]
            : [
                [0, rise, -z],
                [0, rise, z],
              ];
        shapes.push({
          kind: 'hull',
          points: [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], ...ridge],
        });
        break;
      }
      case 'bell': {
        const bell = castle.bell;
        const [width, tall] = bell.size;
        for (const side of [-1, 1])
          shapes.push(standing([0.26, tall, 0.26], [(side * width) / 2, 0, 0]));
        shapes.push(standing([width + 0.7, 0.3, 0.34], [0, tall, 0]));
        shapes.push(standing([bell.bell, bell.bell, bell.bell], [0, tall - bell.bell - 0.02, 0]));
        break;
      }
      default:
        throw new Error(`A castle ${part.kind} isn't a body`);
    }
    parts.push({
      id: part.id,
      kind,
      owner: part.owner,
      foot: part.at,
      turn: part.turn,
      shapes,
      supports,
      top,
    });
  }

  // The spear rack the round keeps: a prop, as its box.
  if (rack) {
    const spot = layout.anchors.spearRacks.find((candidate) => candidate.id === rack);
    const prop = castle.props.find((candidate) => candidate.id === rack);
    const box = prop ? castle.boxes[prop.piece] : undefined;
    if (!spot || !box) throw new Error(`No spear rack "${rack}"`);
    parts.push({
      id: rack,
      kind: 'rack',
      owner: rack,
      foot: spot.at,
      turn: spot.turn,
      shapes: [{ kind: 'box', half: halves(box.size), at: box.middle, turn: 0 }],
      supports: [],
      top: undefined,
    });
  }

  return { solids: solidShapes(castle, layout, bodies), parts };
}

function halves(size: readonly [number, number, number]): Vec3 {
  return [size[0] / 2, size[1] / 2, size[2] / 2];
}

/** A box `size` with its foot at `foot` in the world, turned `turn`. */
function worldBox(size: readonly number[], foot: Vec3, turn: number): BodyShape {
  return standing(size, foot, turn);
}

/** What never comes apart, in the world's frame. */
function solidShapes(castle: Castle, layout: CastleLayout, bodies: Siege['bodies']): BodyShape[] {
  const shapes: BodyShape[] = [];
  const { wall: w, details } = castle;
  const parapetAt = w.thickness / 2 - w.parapet.thickness / 2;

  // The stretches of wall run into the towers (and a solid wall's whole length).
  for (const wall of layout.walls) {
    const solid = castle.walls.find((candidate) => candidate.id === wall.id)?.solid ?? false;
    const turn = Math.atan2(wall.out[0], wall.out[1]);
    const stretches: [number, number][] = solid
      ? [[wall.body[0], wall.body[1]]]
      : [
          [wall.body[0], wall.clear[0]],
          [wall.clear[1], wall.body[1]],
        ];
    for (const [a, b] of stretches) {
      if (b - a <= 0) continue;
      const middle = (a + b) / 2;
      const at = (sideways: number, y: number): Vec3 => [
        wall.origin[0] + wall.dir[0] * middle + wall.out[0] * sideways,
        y,
        wall.origin[1] + wall.dir[1] * middle + wall.out[1] * sideways,
      ];
      shapes.push(worldBox([b - a, w.height, w.thickness], at(0, 0), turn));
      if (!solid) {
        shapes.push(
          worldBox([b - a, w.parapet.height, w.parapet.thickness], at(parapetAt, w.height), turn),
        );
      }
    }
  }

  for (const tower of castle.towers) {
    const [x, z] = tower.at;
    const h = tower.height;
    if (tower.shape === 'round') {
      if (!tower.solid) continue;
      // A drum, as a hull of its rim top and bottom.
      const rim = tower.size + details.corbel.out;
      const points: Vec3[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        points.push([x + Math.sin(a) * tower.size, 0, z + Math.cos(a) * tower.size]);
        points.push([x + Math.sin(a) * rim, h + w.parapet.height, z + Math.cos(a) * rim]);
      }
      shapes.push({ kind: 'hull', points });
      continue;
    }
    const sx = tower.size;
    const sz = tower.depth ?? tower.size;
    if (tower.gate) {
      // Either side of the gate, and over it.
      const { width, height } = tower.gate;
      const pier = sx - width / 2;
      for (const sign of [-1, 1]) {
        shapes.push(worldBox([pier, h, sz * 2], [x + sign * (width / 2 + pier / 2), 0, z], 0));
      }
      shapes.push(worldBox([width, h - height, sz * 2], [x, height, z], 0));
    } else {
      shapes.push(worldBox([sx * 2, h, sz * 2], [x, 0, z], 0));
    }
    // Its parapet round the top, out on the corbels (the merlons on it are parts).
    const edges: { along: number; half: number; turn: number; out: [number, number] }[] = [
      { along: sx * 2, half: sz, turn: 0, out: [0, 1] },
      { along: sx * 2, half: sz, turn: Math.PI, out: [0, -1] },
      { along: sz * 2, half: sx, turn: Math.PI / 2, out: [1, 0] },
      { along: sz * 2, half: sx, turn: -Math.PI / 2, out: [-1, 0] },
    ];
    for (const edge of edges) {
      const reach = edge.half + details.corbel.out - w.parapet.thickness / 2;
      shapes.push(
        worldBox(
          [edge.along + details.corbel.out * 2, w.parapet.height, w.parapet.thickness],
          [x + edge.out[0] * reach, h, z + edge.out[1] * reach],
          edge.turn,
        ),
      );
    }
  }

  // The buildings, inset so the captain stands in a window.
  for (const building of layout.buildings) {
    const inset = bodies.keepInset;
    const width = building.max[0] - building.min[0] - inset * 2;
    const depth = building.max[1] - building.min[1] - inset * 2;
    shapes.push(
      worldBox(
        [width, building.height, depth],
        [(building.min[0] + building.max[0]) / 2, 0, (building.min[1] + building.max[1]) / 2],
        0,
      ),
    );
  }

  // The stairs: a ramp from the ground at its foot to the walk at its top.
  for (const stair of layout.stairs) {
    const wall = layout.walls.find((candidate) => candidate.id === stair.wall);
    if (!wall) continue;
    // Along the wall: the end of its footprint nearer its top is the high one.
    const along = Math.abs(wall.dir[0]) > 0.5 ? 0 : 1;
    const topAlong = along === 0 ? stair.top[0] : stair.top[2];
    const high =
      Math.abs(topAlong - stair.min[along]) < Math.abs(topAlong - stair.max[along])
        ? stair.min[along]
        : stair.max[along];
    const corners: [number, number][] = [
      [stair.min[0], stair.min[1]],
      [stair.max[0], stair.min[1]],
      [stair.max[0], stair.max[1]],
      [stair.min[0], stair.max[1]],
    ];
    const points: Vec3[] = corners.map(([cx, cz]) => [cx, 0, cz]);
    for (const corner of corners) {
      if (Math.abs(corner[along] - high) < 1e-6) points.push([corner[0], w.height, corner[1]]);
    }
    shapes.push({ kind: 'hull', points });
  }

  // The props (but the spear racks: the round's is a part, the others aren't there).
  for (const prop of castle.props) {
    if (castle.anchors.spearRacks.includes(prop.id)) continue;
    const box = castle.boxes[prop.piece];
    if (!box) continue;
    const turn = (prop.turn * Math.PI) / 180;
    const middle = turnY(box.middle, turn);
    shapes.push({
      kind: 'box',
      half: halves(box.size),
      at: [prop.at[0] + middle[0], middle[1], prop.at[1] + middle[2]],
      turn,
    });
  }
  return shapes;
}

/**
 * Whether a guard's feet at `point` (in the world) stand on `part`'s top: over its footprint (a
 * little past its edges, `reach` m), within `reach` of its top's height.
 */
export function standsOn(part: PartBody, point: Vec3, reach: number): boolean {
  const top = part.top;
  if (!top) return false;
  const local = turnY(
    [point[0] - part.foot[0], point[1] - part.foot[1], point[2] - part.foot[2]],
    -part.turn,
  );
  if (Math.abs(local[1] - top.y) > reach) return false;
  if (top.kind === 'box') {
    return Math.abs(local[0]) <= top.half[0] + reach && Math.abs(local[2]) <= top.half[1] + reach;
  }
  const radius = Math.hypot(local[0], local[2]);
  if (radius > top.radius + reach) return false;
  const angle = (Math.atan2(local[0], local[2]) + Math.PI * 2) % (Math.PI * 2);
  const slack = radius > 0 ? reach / radius : Math.PI;
  return angle >= top.from - slack && angle <= top.to + slack;
}

/** The parts of `layout` drawn fixed to a part that comes apart (slits, doorways, ivy). */
export function fixedTo(layout: CastleLayout): CastlePart[] {
  return layout.parts.filter((part) => part.of !== undefined);
}
