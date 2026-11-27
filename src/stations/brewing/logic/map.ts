import type { Lab } from './color';

/**
 * The colour map beside the pot, without any rendering: OKLab's a (green → red) across and b
 * (blue → yellow) up, so hue runs round the middle and chroma out from it, with lightness on a
 * bar beside it. Every drop pulls the pot toward its own colour on the map; ash and water sit in
 * the grey middle and move it along the lightness bar.
 */

/** The square of a and b the map shows, and the lightness the bar runs over. */
export interface MapBounds {
  /** The map's middle in a and b, and how far it reaches either side. */
  a: number;
  b: number;
  half: number;
  /** The lightness bar: from `low` at the bottom to `high` at the top. */
  low: number;
  high: number;
}

/** Where a colour sits on the map: x across and y down (0–1), and up the lightness bar (0–1). */
export interface MapPoint {
  x: number;
  y: number;
  /** 0 at the bar's bottom (darkest), 1 at its top. */
  l: number;
}

/** The map round some colours (the shelf's): a square holding them all, `margin` past them. */
export function mapBounds(colors: readonly Lab[], margin: number): MapBounds {
  const as = colors.map((color) => color.a);
  const bs = colors.map((color) => color.b);
  const Ls = colors.map((color) => color.L);
  const [aLow, aHigh] = [Math.min(...as), Math.max(...as)];
  const [bLow, bHigh] = [Math.min(...bs), Math.max(...bs)];
  return {
    a: (aLow + aHigh) / 2,
    b: (bLow + bHigh) / 2,
    half: Math.max(aHigh - aLow, bHigh - bLow) / 2 + margin,
    low: Math.min(...Ls),
    high: Math.max(...Ls),
  };
}

/** A colour's place on the map (it may fall off the edge: views clamp it). */
export function mapPoint(bounds: MapBounds, color: Lab): MapPoint {
  const span = bounds.half * 2;
  return {
    x: (color.a - (bounds.a - bounds.half)) / span,
    y: (bounds.b + bounds.half - color.b) / span,
    l: (color.L - bounds.low) / Math.max(bounds.high - bounds.low, 1e-6),
  };
}

/** How far a distance in OKLab reaches across the map (a share of its width). */
export function mapScale(bounds: MapBounds, distance: number): number {
  return distance / (bounds.half * 2);
}

/** One drop's part of the pot's cloud on the map. */
export interface CloudPoint {
  color: Lab;
  /** How much it counts (its strength). */
  weight: number;
  /** How much of it is still unstirred, 1 → 0: views blur it by this. */
  unmixed: number;
}

/**
 * The pot on the map as a cloud: each drop sits between the pot's true colour and its own, as far
 * toward its own as it's unstirred. Stirring pulls every drop in to the true colour, so a fully
 * stirred pot is one crisp point, and stirring is what shows where the pot really is.
 */
export function potCloud(
  mixed: Lab,
  drops: readonly { color: Lab; weight: number; unmixed: number }[],
): CloudPoint[] {
  return drops.map((drop) => ({
    color: {
      L: mixed.L + (drop.color.L - mixed.L) * drop.unmixed,
      a: mixed.a + (drop.color.a - mixed.a) * drop.unmixed,
      b: mixed.b + (drop.color.b - mixed.b) * drop.unmixed,
    },
    weight: drop.weight,
    unmixed: drop.unmixed,
  }));
}
