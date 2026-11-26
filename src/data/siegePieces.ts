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
      extra: Partial<Pick<FortBlock, 'banner' | 'weak' | 'hp'>> = {},
    ) => {
      blocks.push({
        material,
        size,
        at,
        banner: extra.banner ?? false,
        weak: extra.weak ?? false,
        ...(extra.hp !== undefined && { hp: extra.hp }),
        piece: index,
        pieceKind: piece.kind,
      });
    };
    const guard = (position: number | undefined, at: Vec3) => {
      if (position === undefined) return;
      guards[position]?.push({ at, piece: index });
    };
    const [x, z] = piece.at;
    switch (piece.kind) {
      case 'wall':
        wall(piece.length, piece.courses, x, z, piece.material, piece.merlons, parts, block);
        break;
      case 'cover':
        wall(piece.length, 2, x, z, piece.material, false, parts, block);
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
    }
  });
  return { blocks, guards };
}

type AddBlock = (
  material: string,
  size: Vec3,
  at: Vec3,
  extra?: Partial<Pick<FortBlock, 'banner' | 'weak' | 'hp'>>,
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
): void {
  const [, height] = parts.stone;
  for (let course = 0; course < courses; course++) {
    const y = height / 2 + course * height;
    const shifted = course % 2 === 1 && wide > 1;
    const stones = shifted ? wide - 1 : wide;
    for (let index = 0; index < stones; index++) {
      block(material, parts.stone, [x + (index - (stones - 1) / 2) * parts.stone[0], y, z]);
    }
    if (shifted) {
      const end = (wide * parts.stone[0]) / 2 - parts.halfStone[0] / 2;
      block(material, parts.halfStone, [x - end, y, z]);
      block(material, parts.halfStone, [x + end, y, z]);
    }
  }
  if (!merlons) return;
  const top = courses * height;
  const topStones = courses % 2 === 0 && wide > 1 ? wide - 1 : wide;
  for (let index = 0; index < topStones; index++) {
    const across = x + (index - (topStones - 1) / 2) * parts.stone[0];
    block(material, parts.merlon, [across, top + parts.merlon[1] / 2, z]);
  }
}

/** The keep: storeys of corner posts and plank floors, the banner's pole on the top floor. */
function keep(
  piece: Extract<SiegePiece, { kind: 'keep' }>,
  parts: SiegeParts,
  block: AddBlock,
): void {
  const [x, z] = piece.at;
  const inset = parts.post / 2 + 0.1;
  let floor = 0;
  piece.storeys.forEach((height, storey) => {
    for (const sx of [-1, 1]) {
      for (const side of [-1, 1]) {
        // +z is the front, toward the ballista.
        const thin = storey === piece.weak && side === 1;
        const across = thin ? parts.thinPost : parts.post;
        block(
          'wood',
          [across, height, across],
          [
            x + sx * (piece.width / 2 - inset),
            floor + height / 2,
            z + side * (piece.depth / 2 - inset),
          ],
          thin ? { weak: true, hp: parts.weakHp } : {},
        );
      }
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
