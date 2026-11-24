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
  /** Splits it took to make: 0 for the whole log. At the rules' `halvings`, it's a stave. */
  depth: number;
}

/** What became of a piece that's done: a stave, spoiled (a knot, too thin), or wasted. */
export type Fate = 'stave' | 'knot' | 'thin' | 'runout';

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

/** A log's knots, as arcs of its end face. */
export function knotArcs(log: RivingLog): { start: number; width: number }[] {
  return log.knots.map((knot) => ({
    start: normalize((knot.angle - knot.width / 2) * DEG),
    width: knot.width * DEG,
  }));
}

/** Whether a split at `angle` runs through a knot (it will run out). */
export function throughKnot(log: RivingLog, piece: Piece, angle: number): boolean {
  const knots = knotArcs(log);
  return splitLines(piece, angle).some((line) =>
    knots.some((knot) => inArc(line, knot.start, knot.width)),
  );
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

/** Whether a piece touches a knot (a stave that does is spoiled). */
export function touchesKnot(log: RivingLog, piece: Piece): boolean {
  return knotArcs(log).some((knot) => arcsOverlap(piece, knot));
}

/** What a piece becomes once it's split as far as it goes: a stave, or spoiled. */
export function fateOf(rules: Riving, log: RivingLog, piece: Piece): Fate | undefined {
  if (piece.depth < rules.halvings) return undefined;
  if (piece.width < rules.minStaveDegrees * DEG) return 'thin';
  if (touchesKnot(log, piece)) return 'knot';
  return 'stave';
}

/**
 * Which of a split's two pieces a runout wastes: the short side the crack ran off into (the
 * narrower one; the second if they're even).
 */
export function runoutSide(pieces: [Piece, Piece]): 0 | 1 {
  return pieces[0].width < pieces[1].width - 1e-9 ? 0 : 1;
}
