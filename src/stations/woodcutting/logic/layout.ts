import type { Clearing } from '../../../data';

/** Screen space kept free around the clearing: the back button above, the chop meter below. */
export const CLEARING_MARGIN = { top: 72, bottom: 128, side: 12 };

/** Scales the clearing to fit the screen, centered. */
export function fitClearing(viewWidth: number, viewHeight: number, clearing: Clearing) {
  const areaWidth = viewWidth - CLEARING_MARGIN.side * 2;
  const areaHeight = viewHeight - CLEARING_MARGIN.top - CLEARING_MARGIN.bottom;
  const scale = Math.min(areaWidth / clearing.width, areaHeight / clearing.height);
  return {
    scale,
    offsetX: (viewWidth - clearing.width * scale) / 2,
    offsetY: CLEARING_MARGIN.top + (areaHeight - clearing.height * scale) / 2,
  };
}

export function toScreen(
  fit: ReturnType<typeof fitClearing>,
  point: { x: number; y: number },
): { x: number; y: number } {
  return { x: fit.offsetX + point.x * fit.scale, y: fit.offsetY + point.y * fit.scale };
}
