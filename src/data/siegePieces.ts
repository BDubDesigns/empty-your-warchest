import type { SiegePiece, SiegeParts } from './schema';

// Forts are assembled from prebuilt pieces (walls, gates, towers, a keep …), here laid out as the
// blocks and guards the siege's physics plays with. Pure numbers: no rendering, no physics, so a
// generator can assemble forts the same way one day.

type Vec3 = [number, number, number];

export type PieceKind = SiegePiece['kind'];

/** One block of a fort: a box `size` (width, height, depth) with its middle `at`, upright. */
export interface FortBlock {
  material: string;
  size: Vec3;
  at: Vec3;
  /** The banner: the last position is won when it comes down. One per fort at most. */
  banner: boolean;
  /** A weak point (a thin post holding up something heavy, a gate): drawn so it stands out. */
  weak: boolean;
  /** A merlon on top of a wall: the cover a guard on the walkway behind ducks behind. */
  merlon: boolean;
  /** A window's pane of glass: seen through, and shattered by a touch. */
  pane: boolean;
  /** Its own hit points, in place of its material's. */
  hp?: number;
  /** The piece it's part of (its index in the fort's pieces) and what kind that is. */
  piece: number;
  pieceKind: PieceKind;
}

/** A guard, standing with its feet `at` (on the ground or on top of a block), facing the ballista. */
export interface FortGuard {
  at: Vec3;
  piece: number;
  /** How he keeps watch until alerted. */
  watch: 'stand' | 'patrol' | 'sleep';
  /** On a walkway: how far along x his feet can go (from, to), walking it or pacing it. */
  walk?: [number, number];
  /**
   * On a walkway: where along x the merlons in front of it are (his cover, alerted), and how far
   * to one side of one the gap is (where he leans out).
   */
  cover?: number[];
  gap?: number;
}

/** A fort's pieces as blocks, and its guards by the position (index) they guard. */
export interface BuiltFort {
  blocks: FortBlock[];
  guards: FortGuard[][];
}

/** Lays out a fort's pieces as blocks and guards. */
export function buildFort(
  pieces: readonly SiegePiece[],
  positions: number,
  parts: SiegeParts,
): BuiltFort {
  const blocks: FortBlock[] = [];
  const guards: FortGuard[][] = Array.from({ length: positions }, () => []);
  pieces.forEach((piece, index) => {
    const block = (
      material: string,
      size: Vec3,
      at: Vec3,
      extra: Partial<Pick<FortBlock, 'banner' | 'weak' | 'hp' | 'merlon' | 'pane'>> = {},
    ) => {
      blocks.push({
        material,
        size,
        at,
        banner: extra.banner ?? false,
        weak: extra.weak ?? false,
        merlon: extra.merlon ?? false,
        pane: extra.pane ?? false,
        ...(extra.hp !== undefined && { hp: extra.hp }),
        piece: index,
        pieceKind: piece.kind,
      });
    };
    const guard = (position: number | undefined, at: Vec3, walk?: [number, number]) => {
      if (position === undefined) return;
      const watch = 'watch' in piece ? piece.watch : 'stand';
      guards[position]?.push({ at, piece: index, watch, ...(walk && { walk }) });
    };
    const [x, z] = piece.at;
    switch (piece.kind) {
      case 'wall':
        wall(
          piece.length,
          piece.courses,
          x,
          z,
          piece.material,
          piece.merlons,
          parts,
          block,
          piece.windows,
        );
        break;
      case 'cover':
        wall(piece.length, 2, x, z, piece.material, false, parts, block, []);
        break;
      case 'gate': {
        // Two leaves, meeting in the middle.
        const leaf = piece.width / 2;
        for (const side of [-1, 1]) {
          block(
            piece.material,
            [leaf, piece.height, parts.gateDepth],
            [x + (side * leaf) / 2, piece.height / 2, z],
            { weak: true, hp: parts.gateHp },
          );
        }
        break;
      }
      case 'tower': {
        const height = parts.stone[1];
        for (let course = 0; course < piece.courses; course++) {
          block(
            piece.material,
            [parts.towerBlock, height, parts.towerBlock],
            [x, height / 2 + course * height, z],
          );
        }
        guard(piece.guard, [x, piece.courses * height, z]);
        break;
      }
      case 'keep':
        keep(piece, parts, block);
        break;
      case 'platform': {
        const size = parts.platform;
        const half = size / 2 - parts.post / 2;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            block(
              'wood',
              [parts.post, piece.height, parts.post],
              [x + sx * half, piece.height / 2, z + sz * half],
            );
          }
        }
        block(
          'wood',
          [size, parts.platformSlab, size],
          [x, piece.height + parts.platformSlab / 2, z],
        );
        guard(piece.guard, [x, piece.height + parts.platformSlab, z]);
        break;
      }
      case 'post':
        guard(piece.guard, [x, 0, z]);
        break;
      case 'walkway': {
        const length = piece.segments * parts.walkway;
        for (let segment = 0; segment < piece.segments; segment++) {
          block(
            'wood',
            [parts.walkway, piece.height, parts.walkwayWidth],
            [x - length / 2 + (segment + 0.5) * parts.walkway, piece.height / 2, z],
          );
        }
        // His feet stay on it, a little in from either end.
        const end = length / 2 - parts.walkwayWidth / 2;
        guard(piece.guard, [x, piece.height, z], [x - end, x + end]);
        break;
      }
    }
  });
  // A walkway guard's cover: the merlons on the wall just in front of his walk.
  for (const guard of guards.flat()) {
    const walk = guard.walk;
    if (!walk) continue;
    const [, , z] = guard.at;
    guard.cover = blocks
      .filter(
        (block) =>
          block.merlon &&
          block.at[2] > z &&
          block.at[2] - z <= parts.walkwayWidth + parts.stone[2] &&
          block.at[0] >= walk[0] &&
          block.at[0] <= walk[1],
      )
      .map((block) => block.at[0])
      .sort((a, b) => a - b);
    guard.gap = parts.stone[0] / 2;
  }
  return { blocks, guards };
}

type AddBlock = (
  material: string,
  size: Vec3,
  at: Vec3,
  extra?: Partial<Pick<FortBlock, 'banner' | 'weak' | 'hp' | 'merlon' | 'pane'>>,
) => void;

/**
 * A wall `wide` stones across and `courses` high, centred on (`x`, `z`), laid like brickwork
 * (every other course shifted half a stone, so the joints don't line up), with a merlon on every
 * stone of the top course if `merlons`.
 */
function wall(
  wide: number,
  courses: number,
  x: number,
  z: number,
  material: string,
  merlons: boolean,
  parts: SiegeParts,
  block: AddBlock,
  windows: Extract<SiegePiece, { kind: 'wall' }>['windows'],
): void {
  const [across, height, deep] = parts.stone;
  const left = x - (wide * across) / 2;
  // Each window's opening (along x, up y), and the course its lintel takes.
  const openings = windows.map((window) => ({
    from: left + window.from * across,
    to: left + (window.from + window.width) * across,
    low: window.sill,
    high: window.sill + window.courses,
    window,
  }));
  // A stone goes where no window, nor the stones a lintel takes the place of, would be.
  const clear = (course: number, middle: number, width: number) =>
    openings.every((opening) => {
      const reach = course === opening.high ? across : 0;
      const inside = course >= opening.low && course <= opening.high;
      return (
        !inside ||
        middle + width / 2 <= opening.from - reach + 1e-6 ||
        middle - width / 2 >= opening.to + reach - 1e-6
      );
    });
  for (let course = 0; course < courses; course++) {
    const y = height / 2 + course * height;
    const shifted = course % 2 === 1 && wide > 1;
    const stones = shifted ? wide - 1 : wide;
    for (let index = 0; index < stones; index++) {
      const middle = x + (index - (stones - 1) / 2) * across;
      if (clear(course, middle, across)) block(material, parts.stone, [middle, y, z]);
    }
    if (shifted) {
      const end = (wide * across) / 2 - parts.halfStone[0] / 2;
      for (const side of [-1, 1]) {
        if (clear(course, x + side * end, parts.halfStone[0])) {
          block(material, parts.halfStone, [x + side * end, y, z]);
        }
      }
    }
  }
  for (const opening of openings) {
    const width = opening.to - opening.from;
    const middle = (opening.from + opening.to) / 2;
    // The pane, thin, in the middle of the wall; the lintel over it, a stone wider each side.
    const tall = opening.window.courses * height;
    block(
      opening.window.glass,
      [width, tall, parts.pane],
      [middle, opening.low * height + tall / 2, z],
      {
        pane: true,
      },
    );
    block(
      opening.window.lintel,
      [width + 2 * across, height, deep],
      [middle, opening.high * height + height / 2, z],
    );
  }
  if (!merlons) return;
  const top = courses * height;
  const topStones = courses % 2 === 0 && wide > 1 ? wide - 1 : wide;
  for (let index = 0; index < topStones; index++) {
    const across = x + (index - (topStones - 1) / 2) * parts.stone[0];
    block(material, parts.merlon, [across, top + parts.merlon[1] / 2, z], { merlon: true });
  }
}

/**
 * The keep: storeys of corner posts and plank floors, the banner's pole on the top floor. Its weak
 * storey stands on two thin posts at the front and a wall of `back` across the back: either thin
 * post can go and the floor above still stands, so it takes both (more than one volley) to bring
 * the keep down. Its other posts and that wall are sturdy (`keepPostHp`): the way in is the thin
 * posts.
 */
function keep(
  piece: Extract<SiegePiece, { kind: 'keep' }>,
  parts: SiegeParts,
  block: AddBlock,
): void {
  const [x, z] = piece.at;
  const inset = parts.post / 2 + 0.1;
  let floor = 0;
  piece.storeys.forEach((height, storey) => {
    const weak = storey === piece.weak;
    for (const sx of [-1, 1]) {
      for (const side of [-1, 1]) {
        // +z is the front, toward the ballista. The weak storey's back is a wall (below).
        if (weak && side === -1) continue;
        const thin = weak && side === 1;
        const across = thin ? parts.thinPost : parts.post;
        block(
          'wood',
          [across, height, across],
          [
            x + sx * (piece.width / 2 - inset),
            floor + height / 2,
            z + side * (piece.depth / 2 - inset),
          ],
          thin ? { weak: true, hp: parts.weakHp } : { hp: parts.keepPostHp },
        );
      }
    }
    if (weak) {
      // A heavy wall across the back: spears through a broken front post stop on it, and with
      // only one front post gone the floor above still stands on it and the other.
      block(
        piece.back,
        [piece.width - 0.2, height, parts.post],
        [x, floor + height / 2, z - (piece.depth / 2 - inset)],
        { hp: parts.keepPostHp },
      );
    }
    floor += height;
    block('wood', [piece.width, parts.slab, piece.depth], [x, floor + parts.slab / 2, z]);
    floor += parts.slab;
  });
  block('wood', parts.pole, [x, floor + parts.pole[1] / 2, z], {
    banner: true,
    hp: parts.bannerHp,
  });
}
