/** One flying piece of a deposit into the warchest. */
export interface PourPiece {
  /** Which source point it flies from (an index into the sources). */
  from: number;
  /** How many items it carries into the chest. */
  share: number;
  /** Seconds after the pour starts that it leaves its source. */
  delay: number;
}

/**
 * Splits a deposit of `amount` items into at most `maxPieces` flying pieces, taking turns between
 * the `sources` (e.g. each stump) and leaving `stagger` seconds between launches. Each piece
 * carries a whole share and the shares add up to exactly `amount`, so the chest's count always
 * ends right however few pieces fly.
 */
export function splitDeposit(
  amount: number,
  sources: number,
  maxPieces: number,
  stagger: number,
): PourPiece[] {
  if (amount <= 0 || sources <= 0) return [];
  const pieces = Math.min(amount, Math.max(maxPieces, sources));
  const base = Math.floor(amount / pieces);
  const extra = amount % pieces;
  return Array.from({ length: pieces }, (_, index) => ({
    from: index % sources,
    share: base + (index < extra ? 1 : 0),
    delay: index * stagger,
  }));
}
