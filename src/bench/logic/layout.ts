import { Rng } from '../../core/rng';
import type { BenchCameraKey, BenchLayout, BenchPack, BenchRole } from '../../data/bench';

// Where everything in a stress-test scene goes, the same for every pack: a fort with a tower in its
// courtyard and crates stacked by it, houses, props, trees and people, copied side by side for 2×
// and 4×. Pieces are sized from their own measured size (a pack's units are its own), so each
// pack's wall is a module wide. Each piece stands at (x, y, z) by the middle of its bottom.

/** A piece's size (x, y, z) in its own units, laid along x with its outside facing +z. */
export type Size = readonly [number, number, number];

/** A part of a pack: one of its roles, or one of its props (by index). */
export type PieceId = { role: BenchRole } | { prop: number };

export interface Placed {
  piece: PieceId;
  /** Which copy of the scene it's in. */
  copy: number;
  x: number;
  y: number;
  z: number;
  /** About y, radians. */
  turn: number;
  scale: number;
  /** Its size as placed (m). */
  size: Size;
  /** Turns into a physics body when the fort comes down. */
  collapse: boolean;
  /** The building (or the props, or the crates) it's part of, within its copy. */
  group: string;
}

export interface PlacedTree {
  model: number;
  x: number;
  z: number;
  height: number;
  turn: number;
}

export interface PlacedCharacter {
  model: number;
  copy: number;
  /** A walker goes back and forth from `from` to `to`; an idle one stands at `from`. */
  walk: boolean;
  from: readonly [number, number];
  to: readonly [number, number];
  turn: number;
  /** Where along its beat it starts (0 to 1). */
  phase: number;
}

export interface SceneLayout {
  pieces: Placed[];
  trees: PlacedTree[];
  characters: PlacedCharacter[];
}

export interface LayoutInput {
  pack: BenchPack;
  layout: BenchLayout;
  /** Each role's and prop's measured size. */
  sizes: { roles: Partial<Record<BenchRole, Size>>; props: readonly Size[] };
  /** Physics bodies per copy: the fort's pieces first, then crates to make up the number. */
  bodies: number;
  copies: number;
  treeModels: number;
  characterModels: number;
}

/** The four sides of a ring, from its front (+z) round to its left; `turn` faces each outward. */
const SIDES = [
  { turn: 0, along: (w: number, d: number, at: number) => [-w / 2 + at, d / 2] as const },
  { turn: Math.PI / 2, along: (w: number, d: number, at: number) => [w / 2, d / 2 - at] as const },
  { turn: Math.PI, along: (w: number, d: number, at: number) => [w / 2 - at, -d / 2] as const },
  {
    turn: -Math.PI / 2,
    along: (w: number, d: number, at: number) => [-w / 2, -d / 2 + at] as const,
  },
];

/** (x, z) turned `turn` about the origin, as a turn about y does. */
function rotate(x: number, z: number, turn: number): [number, number] {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return [x * cos + z * sin, -x * sin + z * cos];
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const inside = (rect: Rect, x: number, z: number, margin = 0) =>
  x > rect.minX - margin &&
  x < rect.maxX + margin &&
  z > rect.minZ - margin &&
  z < rect.maxZ + margin;

/** Lays out one pack's scene. Throws if a role the pack's buildings need has no size. */
export function layoutScene(input: LayoutInput): SceneLayout {
  const { pack, layout } = input;
  const module = layout.module;
  const sizeOf = (role: BenchRole): Size => {
    const size = input.sizes.roles[role];
    if (!size) throw new Error(`${pack.name} has no "${role}" piece`);
    return size;
  };
  const has = (role: BenchRole) => input.sizes.roles[role] !== undefined;
  /** A piece scaled so its width is `width`, or (`byHeight`) its height. */
  const fitted = (size: Size, length: number, byHeight = false) => {
    const scale = length / Math.max(byHeight ? size[1] : size[0], 1e-6);
    return { scale, size: [size[0] * scale, size[1] * scale, size[2] * scale] as const };
  };

  // One copy of the scene, about (0, 0); copies are moved after.
  const pieces: Omit<Placed, 'copy'>[] = [];
  /** The building being put up: what `add` files its pieces under. */
  let group = 'fort';
  const blocked: Rect[] = [];
  const add = (
    piece: PieceId,
    size: Size,
    length: number,
    at: { x: number; y: number; z: number; turn: number },
    collapse: boolean,
    byHeight = false,
  ) => {
    const fit = fitted(size, length, byHeight);
    pieces.push({ piece, ...at, scale: fit.scale, size: fit.size, collapse, group });
    return fit.size;
  };
  const roof = (
    role: BenchRole,
    cx: number,
    cz: number,
    width: number,
    top: number,
    turn: number,
    collapse: boolean,
  ) => {
    const size = sizeOf(role);
    const sink = pack.roles[role]?.sink ?? 0;
    const scaled = fitted(size, width).size;
    add({ role }, size, width, { x: cx, y: top - scaled[1] * sink, z: cz, turn }, collapse);
  };

  /** A ring of walls `wide` × `deep` modules, `storeys` high; returns its height. */
  const ring = (options: {
    cx: number;
    cz: number;
    wide: number;
    deep: number;
    turn: number;
    storeys: number;
    roleAt: (storey: number, side: number, index: number, count: number) => BenchRole;
    corner?: BenchRole;
    collapse: boolean;
  }): number => {
    const { cx, cz, wide, deep, turn, storeys } = options;
    const wallSize = sizeOf(options.roleAt(0, 1, 0, deep));
    const storeyHeight = fitted(wallSize, module).size[1];
    const [w, d] = [wide * module, deep * module];
    for (let storey = 0; storey < storeys; storey++) {
      SIDES.forEach((side, sideIndex) => {
        const count = sideIndex % 2 === 0 ? wide : deep;
        for (let index = 0; index < count; index++) {
          const [lx, lz] = side.along(w, d, module * (index + 0.5));
          const [x, z] = rotate(lx, lz, turn);
          const role = options.roleAt(storey, sideIndex, index, count);
          add(
            { role },
            sizeOf(role),
            module,
            { x: cx + x, y: storey * storeyHeight, z: cz + z, turn: turn + side.turn },
            options.collapse,
          );
        }
      });
      if (options.corner) {
        for (const [sx, sz] of [
          [1, 1],
          [1, -1],
          [-1, -1],
          [-1, 1],
        ] as const) {
          const [x, z] = rotate((sx * w) / 2, (sz * d) / 2, turn);
          const corner = options.corner;
          add(
            { role: corner },
            sizeOf(corner),
            storeyHeight,
            { x: cx + x, y: storey * storeyHeight, z: cz + z, turn },
            options.collapse,
            true,
          );
        }
      }
    }
    const [hw, hd] = [(w + module) / 2, (d + module) / 2];
    const corners = [rotate(hw, hd, turn), rotate(-hw, hd, turn)];
    const reachX = Math.max(...corners.map(([x]) => Math.abs(x)));
    const reachZ = Math.max(...corners.map(([, z]) => Math.abs(z)));
    blocked.push({ minX: cx - reachX, maxX: cx + reachX, minZ: cz - reachZ, maxZ: cz + reachZ });
    return storeys * storeyHeight;
  };

  /** A stack of blocks `width` across, one a storey; returns its height. */
  const stack = (options: {
    cx: number;
    cz: number;
    width: number;
    turn: number;
    storeys: number;
    base?: BenchRole;
    block: BenchRole;
    collapse: boolean;
  }): number => {
    let y = 0;
    for (let storey = 0; storey < options.storeys; storey++) {
      const role = storey === 0 && options.base ? options.base : options.block;
      const placed = add(
        { role },
        sizeOf(role),
        options.width,
        { x: options.cx, y, z: options.cz, turn: options.turn },
        options.collapse,
      );
      y += placed[1];
    }
    const half = options.width / 2;
    blocked.push({
      minX: options.cx - half,
      maxX: options.cx + half,
      minZ: options.cz - half,
      maxZ: options.cz + half,
    });
    return y;
  };

  const windowAt = (index: number) => index % layout.windowEvery === 1;

  // The fort, its tower, and (to make up the bodies) the crates in its courtyard.
  const fort = layout.fort;
  ring({
    cx: fort.at[0],
    cz: fort.at[1],
    wide: fort.wide,
    deep: fort.deep,
    turn: 0,
    storeys: pack.fort.storeys,
    roleAt: (storey, side, index, count) => {
      if (storey === 0 && side === 0 && index === Math.floor(count / 2)) return 'gate';
      if ((storey > 0 || side === 0) && windowAt(index)) return 'wallWindow';
      return 'wall';
    },
    corner: 'corner',
    collapse: true,
  });
  group = 'tower';
  const tower = layout.tower;
  const towerWidth = tower.modules * module;
  const towerHeight =
    pack.tower.shape === 'ring'
      ? ring({
          cx: tower.at[0],
          cz: tower.at[1],
          wide: tower.modules,
          deep: tower.modules,
          turn: 0,
          storeys: pack.tower.storeys,
          roleAt: () => 'towerWall',
          collapse: true,
        })
      : stack({
          cx: tower.at[0],
          cz: tower.at[1],
          width: towerWidth,
          turn: 0,
          storeys: pack.tower.storeys,
          ...(has('towerBase') ? { base: 'towerBase' as const } : {}),
          block: has('towerWall') ? 'towerWall' : 'towerBase',
          collapse: true,
        });
  roof('towerRoof', tower.at[0], tower.at[1], towerWidth * 1.1, towerHeight, 0, true);
  const fortPieces = pieces.length;

  group = 'crates';
  const crates = Math.max(0, input.bodies - fortPieces);
  const { crates: pile } = layout;
  const crateSize = sizeOf('crate');
  const perLayer = pile.columns * pile.rows;
  for (let index = 0; index < crates; index++) {
    const layer = Math.floor(index / perLayer);
    const column = index % pile.columns;
    const row = Math.floor((index % perLayer) / pile.columns);
    const gap = pile.size * 1.04;
    add(
      { role: 'crate' },
      crateSize,
      pile.size,
      {
        x: pile.at[0] + (column - (pile.columns - 1) / 2) * gap,
        y: layer * fitted(crateSize, pile.size).size[1],
        z: pile.at[1] + (row - (pile.rows - 1) / 2) * gap,
        turn: 0,
      },
      true,
    );
  }
  // More fort than bodies: only the first `bodies` come down, the rest stand.
  pieces.forEach((piece, index) => {
    if (index >= input.bodies) piece.collapse = false;
  });

  // The houses, each with its roof and chimney.
  layout.houses.forEach((house, index) => {
    group = `house-${String(index)}`;
    const [cx, cz] = house.at;
    const width = house.wide * module;
    const height =
      pack.house.shape === 'ring'
        ? ring({
            cx,
            cz,
            wide: house.wide,
            deep: house.deep,
            turn: house.turn,
            storeys: pack.house.storeys,
            roleAt: (storey, side, index, count) => {
              if (storey === 0 && side === 0 && index === Math.floor(count / 2)) return 'houseDoor';
              if (windowAt(index)) return 'houseWindow';
              return 'houseWall';
            },
            collapse: false,
          })
        : stack({
            cx,
            cz,
            width,
            turn: house.turn,
            storeys: pack.house.storeys,
            block: 'houseWall',
            collapse: false,
          });
    roof('houseRoof', cx, cz, width * 1.08, height, house.turn, false);
    if (has('chimney')) {
      const [x, z] = rotate(width / 2 - module * 0.6, -width / 2 + module * 0.6, house.turn);
      add(
        { role: 'chimney' },
        sizeOf('chimney'),
        module * 1.5,
        { x: cx + x, y: height, z: cz + z, turn: house.turn },
        false,
        true,
      );
    }
  });

  // Props, scattered clear of the buildings and the sights' lane, sized by their longer side.
  const rng = new Rng(layout.seed);
  pack.props.forEach((prop, index) => {
    const size = input.sizes.props[index];
    if (!size) throw new Error(`${pack.name}'s prop ${String(index)} has no size`);
    const scale = prop.width / Math.max(size[0], size[2], 1e-6);
    for (let made = 0, tries = 0; made < prop.count && tries < prop.count * 40; tries++) {
      const x = rng.range(layout.props.from[0], layout.props.to[0]);
      const z = rng.range(layout.props.from[1], layout.props.to[1]);
      if (Math.abs(x) < layout.props.lane) continue;
      if (blocked.some((rect) => inside(rect, x, z, prop.width))) continue;
      pieces.push({
        piece: { prop: index },
        x,
        y: 0,
        z,
        turn: rng.range(0, Math.PI * 2),
        scale,
        size: [size[0] * scale, size[1] * scale, size[2] * scale],
        collapse: false,
        group: 'props',
      });
      made++;
    }
  });

  // Copies, and the trees and people in each.
  const offsets = layout.copies.slice(0, input.copies);
  const placed: Placed[] = offsets.flatMap(([ox, oz], copy) =>
    pieces.map((piece) => ({ ...piece, copy, x: piece.x + ox, z: piece.z + oz })),
  );
  const { trees: woods } = layout;
  const clear = offsets.map(([ox, oz]) => ({
    minX: woods.clearFrom[0] + ox,
    maxX: woods.clearTo[0] + ox,
    minZ: woods.clearFrom[1] + oz,
    maxZ: woods.clearTo[1] + oz,
  }));
  const trees: PlacedTree[] = [];
  offsets.forEach(([ox, oz]) => {
    for (let made = 0, tries = 0; made < woods.count && tries < woods.count * 50; tries++) {
      const x = ox + rng.range(woods.from[0], woods.to[0]);
      const z = oz + rng.range(woods.from[1], woods.to[1]);
      if (clear.some((rect) => inside(rect, x, z))) continue;
      trees.push({
        model: made % Math.max(input.treeModels, 1),
        x,
        z,
        height: rng.range(woods.minHeight, woods.maxHeight),
        turn: rng.range(0, Math.PI * 2),
      });
      made++;
    }
  });
  const people = layout.characters;
  const characters: PlacedCharacter[] = [];
  if (input.characterModels > 0) {
    offsets.forEach(([ox, oz], copy) => {
      people.walks.forEach(([x1, z1, x2, z2]) => {
        characters.push({
          model: characters.length % input.characterModels,
          copy,
          walk: true,
          from: [x1 + ox, z1 + oz],
          to: [x2 + ox, z2 + oz],
          turn: 0,
          phase: rng.next(),
        });
      });
      people.idles.forEach(([x, z, turn]) => {
        characters.push({
          model: characters.length % input.characterModels,
          copy,
          walk: false,
          from: [x + ox, z + oz],
          to: [x + ox, z + oz],
          turn,
          phase: rng.next(),
        });
      });
    });
  }
  return { pieces: placed, trees, characters };
}

/** Where a walker is at `seconds` (x, z), and which way it faces (a turn about y; 0 faces +z). */
export function walkerAt(
  character: PlacedCharacter,
  speed: number,
  seconds: number,
): { x: number; z: number; turn: number } {
  const [x1, z1] = character.from;
  const [x2, z2] = character.to;
  const length = Math.hypot(x2 - x1, z2 - z1);
  if (!character.walk || length < 1e-6) return { x: x1, z: z1, turn: character.turn };
  const lap = length * 2;
  const along = (((seconds * speed + character.phase * lap) % lap) + lap) % lap;
  const out = along < length;
  const share = out ? along / length : 2 - along / length;
  const [dx, dz] = out ? [x2 - x1, z2 - z1] : [x1 - x2, z1 - z2];
  return { x: x1 + (x2 - x1) * share, z: z1 + (z2 - z1) * share, turn: Math.atan2(dx, dz) };
}

type Vec3 = readonly [number, number, number];

/** A Catmull-Rom spline's point between `p1` and `p2` (`u` from 0 to 1), its ends `p0` and `p3`. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): [number, number, number] {
  const u2 = u * u;
  const u3 = u2 * u;
  const axis = (i: 0 | 1 | 2) =>
    0.5 *
    (2 * p1[i] +
      (-p0[i] + p2[i]) * u +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
  return [axis(0), axis(1), axis(2)];
}

const same = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

/**
 * The camera at `seconds`: a smooth curve through the keys, at each key at its time. Where two keys
 * are in the same place, it holds still there.
 */
export function cameraAt(
  keys: readonly BenchCameraKey[],
  seconds: number,
): { from: [number, number, number]; look: [number, number, number] } {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) throw new Error('The camera has no keys');
  const t = Math.min(Math.max(seconds, first.at), last.at);
  let index = 0;
  while (index < keys.length - 2 && t > (keys[index + 1]?.at ?? Infinity)) index++;
  const k1 = keys[index] ?? first;
  const k2 = keys[index + 1] ?? last;
  const k0 = keys[index - 1] ?? k1;
  const k3 = keys[index + 2] ?? k2;
  const u = k2.at > k1.at ? (t - k1.at) / (k2.at - k1.at) : 0;
  const curve = (pick: (key: BenchCameraKey) => Vec3): [number, number, number] => {
    const [p0, p1, p2, p3] = [pick(k0), pick(k1), pick(k2), pick(k3)];
    if (same(p1, p2)) return [p1[0], p1[1], p1[2]];
    // Coming out of or going into a hold, the curve meets it at rest (its slope there is nought).
    return catmullRom(same(p0, p1) ? p2 : p0, p1, p2, same(p2, p3) ? p1 : p3, u);
  };
  return { from: curve((key) => key.from), look: curve((key) => key.look) };
}
