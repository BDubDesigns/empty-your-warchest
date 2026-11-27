import { labDistance, type Lab } from './color';
import type { MapBounds } from './map';

/**
 * Where the pot can still get to, without any rendering. Nothing comes back out but the ladle,
 * so every drop narrows what the pot can become: these work out what's left from what's in it
 * and the fill left, so the map can show it the moment a colour (or a star) goes out of reach.
 *
 * The map is two slices through the target, both in true OKLab distance: the square is every a
 * and b at the target's lightness, the bar every lightness at the target's a and b. Each place on
 * them is shaded by the nearest pot you can still make: lit within the 3-star band of it, half
 * dimmed within the 2-star band, dark past that. So the target itself is lit exactly while 3 stars
 * can still be had, and the half-lit part shows where 2 stars still can.
 */

/** One thing on the shelf, as far as mixing goes. */
export interface ReachEntry {
  id: string;
  color: Lab;
  strength: number;
}

export interface Reach {
  /** Every colour the pot can still be: as it stands (if anything's in it), and with each way of
   * adding whole drops within the room left. */
  colors: Lab[];
  /** The nearest of them to the target, and the drops to add for it (none: bottle it as it is). */
  best: { distance: number; add: Record<string, number> };
}

/**
 * What the pot can still become: `counts` in it now (they may be fractions, after the ladle),
 * up to `room` more whole drops, and no more of an entry than `left` says the warchest holds. For
 * the 10-drop pot and 5 shelf entries that's at most 3003 pots, cheap enough for every drop.
 */
export function reachFrom(
  shelf: readonly ReachEntry[],
  counts: Record<string, number>,
  room: number,
  left: (id: string) => number,
  target: Lab,
): Reach {
  // The pot as it stands, as running sums (colour × weight), so each pot is a few adds.
  let weight = 0;
  const sum = { L: 0, a: 0, b: 0 };
  for (const entry of shelf) {
    const w = entry.strength * (counts[entry.id] ?? 0);
    weight += w;
    sum.L += entry.color.L * w;
    sum.a += entry.color.a * w;
    sum.b += entry.color.b * w;
  }
  const colors: Lab[] = [];
  const adding = new Array<number>(shelf.length).fill(0);
  let best = { distance: Infinity, add: {} as Record<string, number> };
  const walk = (index: number, roomLeft: number, w: number, L: number, a: number, b: number) => {
    if (index === shelf.length) {
      if (w <= 0) return;
      const color = { L: L / w, a: a / w, b: b / w };
      colors.push(color);
      const distance = labDistance(color, target);
      if (distance < best.distance) {
        const add: Record<string, number> = {};
        shelf.forEach((entry, at) => {
          if ((adding[at] ?? 0) > 0) add[entry.id] = adding[at] ?? 0;
        });
        best = { distance, add };
      }
      return;
    }
    const entry = shelf[index];
    if (!entry) return;
    const most = Math.min(roomLeft, Math.max(Math.floor(left(entry.id)), 0));
    const { strength, color } = entry;
    for (let count = 0; count <= most; count++) {
      adding[index] = count;
      const add = strength * count;
      walk(
        index + 1,
        roomLeft - count,
        w + add,
        L + color.L * add,
        a + color.a * add,
        b + color.b * add,
      );
    }
    adding[index] = 0;
  };
  walk(0, Math.max(Math.floor(room), 0), weight, sum.L, sum.a, sum.b);
  return { colors, best };
}

/** The thinning before the map's cells are marked: patches this many to a cell across. */
const PATCHES_PER_CELL = 3;

/**
 * The map's square, `cells` across and down (row by row from the top, as the view paints it):
 * how near any reachable colour comes to each cell's colour at lightness `L`, or Infinity where
 * none is within `within`. Each colour only marks the cells round it, and first the colours are
 * thinned: of those in the same small patch of a and b (a third of a cell across), only the one
 * nearest lightness `L` is kept. That can only overstate a distance by the patch's width (about
 * 0.004 on the real map, a seventh of the 3-star band), and it makes this several times cheaper.
 */
export function reachCells(
  bounds: MapBounds,
  colors: readonly Lab[],
  L: number,
  within: number,
  cells: number,
): Float32Array {
  const near = new Float32Array(cells * cells).fill(Infinity);
  const size = (bounds.half * 2) / cells;
  const left = bounds.a - bounds.half;
  const top = bounds.b + bounds.half;
  const patch = size / PATCHES_PER_CELL;
  const limit = within * within;
  const kept = new Map<number, Lab>();
  for (const color of colors) {
    const dL = Math.abs(color.L - L);
    if (dL > within) continue;
    // Patches off the map count too: their colours still reach cells near its edge.
    const column = Math.floor((color.a - left) / patch) + 4096;
    const row = Math.floor((top - color.b) / patch) + 4096;
    const key = column * 8192 + row;
    const was = kept.get(key);
    if (!was || Math.abs(was.L - L) > dL) kept.set(key, color);
  }
  for (const color of kept.values()) {
    const dL = color.L - L;
    const reach = Math.sqrt(limit - dL * dL);
    const columns = [
      Math.max(Math.floor((color.a - reach - left) / size), 0),
      Math.min(Math.floor((color.a + reach - left) / size), cells - 1),
    ] as const;
    const rows = [
      Math.max(Math.floor((top - (color.b + reach)) / size), 0),
      Math.min(Math.floor((top - (color.b - reach)) / size), cells - 1),
    ] as const;
    // Squared distances while marking (no square roots in the inner loop).
    for (let row = rows[0]; row <= rows[1]; row++) {
      const db = color.b - (top - (row + 0.5) * size);
      const across = dL * dL + db * db;
      for (let column = columns[0]; column <= columns[1]; column++) {
        const da = color.a - (left + (column + 0.5) * size);
        const squared = across + da * da;
        const at = row * cells + column;
        if (squared <= limit && squared < (near[at] ?? Infinity)) near[at] = squared;
      }
    }
  }
  return near.map(Math.sqrt);
}

/**
 * The lightness bar, `rows` high (from the top, lightest): how near any reachable colour comes
 * to each row's lightness at the target's `a` and `b`, or Infinity where none is within `within`.
 */
export function reachBar(
  bounds: MapBounds,
  colors: readonly Lab[],
  a: number,
  b: number,
  within: number,
  rows: number,
): Float32Array {
  const near = new Float32Array(rows).fill(Infinity);
  const span = Math.max(bounds.high - bounds.low, 1e-6);
  const limit = within * within;
  for (const color of colors) {
    const da = color.a - a;
    const db = color.b - b;
    const flat = da * da + db * db;
    if (flat > limit) continue;
    for (let row = 0; row < rows; row++) {
      const dL = color.L - (bounds.high - ((row + 0.5) / rows) * span);
      const squared = flat + dL * dL;
      if (squared <= limit && squared < (near[row] ?? Infinity)) near[row] = squared;
    }
  }
  return near.map(Math.sqrt);
}
