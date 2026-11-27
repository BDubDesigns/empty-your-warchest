// What a finger on a debug slider means, kept apart from the DOM so it can be unit tested. A touch
// that starts on a slider might be someone scrolling the menu or someone dragging the slider, and
// the first few pixels it moves decide which.

/** The debug sliders' touch numbers (`tuning.debugSliders` in data). */
export interface SliderDragTuning {
  /** How far (CSS px) a touch moves before its direction counts. */
  slopPx: number;
  /** How many times as far across as up or down it must go to drag the slider. */
  sideways: number;
}

/** Not yet known, dragging the slider, or scrolling the menu (the slider is left alone). */
export type DragIntent = 'undecided' | 'drag' | 'scroll';

/** What a touch that has moved (`dx`, `dy`) px from where it went down means. */
export function dragIntent(dx: number, dy: number, tuning: SliderDragTuning): DragIntent {
  if (Math.hypot(dx, dy) < tuning.slopPx) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) * tuning.sideways ? 'drag' : 'scroll';
}

/** A slider's numbers, as on its input. */
export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

const decimals = (step: number): number => {
  const text = String(step);
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
};

/** `value` on the slider: clamped to its ends and snapped to its steps (counted from `min`). */
export function snapToSlider(value: number, range: SliderRange): number {
  const { min, max, step } = range;
  const steps = step > 0 ? Math.round((value - min) / step) : 0;
  const snapped = step > 0 ? min + steps * step : value;
  const clamped = Math.min(Math.max(snapped, min), max);
  // 0.1 + 0.2 is 0.30000000000000004: round to as many places as the step has.
  return Number(clamped.toFixed(Math.max(decimals(step), decimals(min))));
}

/**
 * A slider's value after a finger has dragged `dx` px across a track `width` px wide, from
 * `start`: the whole track is the whole range, and the value moves from where it was rather than
 * jumping to the finger, so a drag can start anywhere on the slider.
 */
export function draggedValue(start: number, dx: number, width: number, range: SliderRange): number {
  if (width <= 0) return snapToSlider(start, range);
  return snapToSlider(start + (dx / width) * (range.max - range.min), range);
}

/** The value under a mouse `x` px along a track `width` px wide, as a native slider jumps to. */
export function valueAt(x: number, width: number, range: SliderRange): number {
  const share = width > 0 ? Math.min(Math.max(x / width, 0), 1) : 0;
  return snapToSlider(range.min + share * (range.max - range.min), range);
}
