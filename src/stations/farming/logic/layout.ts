import type { Farming } from '../../../data';

/** Where a plot is on the field (m): its middle, x across and z toward the camera. */
export interface PlotSpot {
  plot: number;
  x: number;
  z: number;
}

/**
 * The field's plots in rows of `columns`, from the far left (plot 0) to the near right, the field
 * centred on the origin. `width` and `depth` are the whole field's.
 */
export function plotLayout(
  looks: Pick<Farming['looks'], 'plotSize' | 'plotGap' | 'columns'>,
  count: number,
): { spots: PlotSpot[]; width: number; depth: number } {
  const { plotSize, plotGap, columns } = looks;
  const across = Math.min(columns, Math.max(count, 1));
  const rows = Math.max(Math.ceil(count / columns), 1);
  const width = across * plotSize + (across - 1) * plotGap;
  const depth = rows * plotSize + (rows - 1) * plotGap;
  const spots = Array.from({ length: count }, (_, plot) => {
    const column = plot % columns;
    const row = Math.floor(plot / columns);
    return {
      plot,
      x: -width / 2 + plotSize / 2 + column * (plotSize + plotGap),
      z: -depth / 2 + plotSize / 2 + row * (plotSize + plotGap),
    };
  });
  return { spots, width, depth };
}

/** The plot whose square holds the field point (x, z), if any (`pad` m round each counts too). */
export function plotAt(
  spots: readonly PlotSpot[],
  size: number,
  x: number,
  z: number,
  pad = 0,
): number | undefined {
  const half = size / 2 + pad;
  for (const spot of spots) {
    if (Math.abs(x - spot.x) <= half && Math.abs(z - spot.z) <= half) return spot.plot;
  }
  return undefined;
}

/**
 * The plots a swipe crossed from (x0, z0) to (x1, z1), in the order it crossed them: sampled
 * along the segment, so a fast swipe doesn't skip one between two pointer moves.
 */
export function plotsCrossed(
  spots: readonly PlotSpot[],
  size: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
): number[] {
  const crossed: number[] = [];
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(Math.ceil(length / (size / 6)), 1);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const plot = plotAt(spots, size, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (plot !== undefined && !crossed.includes(plot)) crossed.push(plot);
  }
  return crossed;
}
