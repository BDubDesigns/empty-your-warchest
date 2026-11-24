import type { Riving, RivingLog } from '../../../data';

const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/**
 * A piece of the log, seen on its end: the arc of the end face it covers, from `start` (radians,
 * going round by increasing angle) for `width`. The whole log is the full circle.
 */
export interface Piece {
  id: string;
  start: number;
  width: number;
  /** Splits it took to make: 0 for the whole log. */
  depth: number;
}

/** What became of a piece that's done: a stave, kindling (too thin), or lost to a runout. */
export type Fate = 'stave' | 'kindling' | 'runout';

/** What a piece is, by its width: kindling (too thin), a stave, or a slab to split again. */
export type Size = 'kindling' | 'stave' | 'slab';

/** An angle brought into 0 to 2π. */
export function normalize(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export function isWhole(piece: Piece): boolean {
  return piece.width >= TAU - 1e-9;
}

/** Whether `angle` lies strictly inside the arc from `start` for `width`. */
export function inArc(angle: number, start: number, width: number): boolean {
  const offset = normalize(angle - start);
  return offset > 1e-9 && offset < width - 1e-9;
}

/** Whether two arcs share any of the end face. */
export function arcsOverlap(
  a: { start: number; width: number },
  b: { start: number; width: number },
): boolean {
  if (a.width >= TAU - 1e-9 || b.width >= TAU - 1e-9) return true;
  return (
    inArc(b.start, a.start, a.width) ||
    inArc(a.start, b.start, b.width) ||
    Math.abs(normalize(a.start - b.start)) < 1e-9
  );
}

/** The whole log, before any split. */
export function wholeLog(): Piece {
  return { id: 'log', start: 0, width: TAU, depth: 0 };
}

/**
 * Where a split at `angle` cuts the end face: a split runs along a radius through the pith, so
 * the first one crosses the whole log (both ends of the diameter) and later ones are one radius.
 */
export function splitLines(piece: Piece, angle: number): number[] {
  return isWhole(piece) ? [normalize(angle), normalize(angle + Math.PI)] : [normalize(angle)];
}

/** Keeps the froe inside the piece, `margin` (radians) clear of its edges. */
export function clampAim(piece: Piece, angle: number, margin: number): number {
  if (isWhole(piece)) return normalize(angle);
  const offset = normalize(angle - piece.start);
  // An angle outside the piece snaps to whichever edge it's nearer.
  const clamped =
    offset > piece.width ? (offset - piece.width < TAU - offset ? piece.width : 0) : offset;
  return normalize(piece.start + Math.min(Math.max(clamped, margin), piece.width - margin));
}

/** The middle of a piece: a fair first aim. */
export function middle(piece: Piece): number {
  return isWhole(piece) ? 0 : normalize(piece.start + piece.width / 2);
}

/** The two pieces a split at `angle` makes. */
export function splitPiece(piece: Piece, angle: number): [Piece, Piece] {
  const depth = piece.depth + 1;
  if (isWhole(piece)) {
    const at = normalize(angle);
    return [
      { id: `${piece.id}.a`, start: at, width: Math.PI, depth },
      { id: `${piece.id}.b`, start: normalize(at + Math.PI), width: Math.PI, depth },
    ];
  }
  const offset = normalize(angle - piece.start);
  return [
    { id: `${piece.id}.a`, start: piece.start, width: offset, depth },
    { id: `${piece.id}.b`, start: normalize(angle), width: piece.width - offset, depth },
  ];
}

/** A grain's arc of the end face. */
export function grainArc(grain: RivingLog['grains'][number]): { start: number; width: number } {
  return { start: normalize((grain.angle - grain.width / 2) * DEG), width: grain.width * DEG };
}

/** The grains (by index, of those still `live`) a split at `angle` would cut through. */
export function grainsCut(
  log: RivingLog,
  piece: Piece,
  angle: number,
  live: ReadonlySet<number>,
): number[] {
  const lines = splitLines(piece, angle);
  return log.grains.flatMap((grain, index) => {
    if (!live.has(index)) return [];
    const arc = grainArc(grain);
    return lines.some((line) => inArc(line, arc.start, arc.width)) ? [index] : [];
  });
}

export function sizeOf(rules: Riving, piece: Piece): Size {
  const degrees = piece.width / DEG;
  if (degrees < rules.stave.min - 1e-9) return 'kindling';
  if (degrees <= rules.stave.max + 1e-9) return 'stave';
  return 'slab';
}

/** Whether a piece could still be split into two staves (or it's a slab, which has to be). */
export function splittable(rules: Riving, piece: Piece): boolean {
  return isWhole(piece) || piece.width / DEG >= rules.stave.min * 2 - 1e-9;
}

/** How uneven a split at `angle` is: 0 for two equal sides, towards 1 for a sliver. */
export function unevenness(piece: Piece, angle: number): number {
  if (isWhole(piece)) return 0;
  const offset = normalize(angle - piece.start);
  return Math.abs(piece.width - 2 * offset) / piece.width;
}

/** A split's thin side (the second if they're even): the one a crack pulls toward. */
export function thinSide(pieces: [Piece, Piece]): 0 | 1 {
  return pieces[0].width < pieces[1].width - 1e-9 ? 0 : 1;
}

/**
 * The grains (by index) that count: still whole (no line cut them) and in one of the `staves`
 * you kept (a grain no line cut lies wholly in one piece, so its middle says which).
 */
export function grainsKept(
  log: RivingLog,
  staves: readonly Piece[],
  live: ReadonlySet<number>,
): number[] {
  return log.grains.flatMap((grain, index) =>
    live.has(index) && staves.some((piece) => inArc(grain.angle * DEG, piece.start, piece.width))
      ? [index]
      : [],
  );
}

/** What the grains that count multiply the log's staves by, together, up to the rules' cap. */
export function logMultiplier(rules: Riving, log: RivingLog, kept: readonly number[]): number {
  const product = kept.reduce((total, index) => {
    const kind = rules.grainKinds.find((entry) => entry.id === log.grains[index]?.kind);
    return total * (kind?.multiplier ?? 1);
  }, 1);
  return Math.min(product, rules.multiplierCap);
}

/** Whether a split at `angle` runs along the log's checks (every end of it): it splits easier. */
export function alongCheck(rules: Riving, log: RivingLog, piece: Piece, angle: number): boolean {
  if (log.checks.length === 0) return false;
  const tolerance = rules.checkTolerance * DEG;
  return splitLines(piece, angle).every((line) =>
    log.checks.some((check) => {
      const gap = normalize(line - check * DEG);
      return Math.min(gap, TAU - gap) <= tolerance;
    }),
  );
}
