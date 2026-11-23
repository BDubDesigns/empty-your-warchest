/** One reading of the aim while the finger moves. `t` is in seconds. */
export interface AimSample {
  t: number;
  angle: number;
}

/**
 * The aim as it was just before the finger lifted. Fingers roll a few pixels as they come
 * up, so the last `ignore` seconds are dropped.
 */
export function angleBeforeLift(
  samples: readonly AimSample[],
  liftedAt: number,
  ignore: number,
): number | undefined {
  let chosen: AimSample | undefined;
  for (const sample of samples) {
    if (sample.t <= liftedAt - ignore) chosen = sample;
  }
  return (chosen ?? samples[0])?.angle;
}

/** Fine-tuning: dragging sideways turns the aim slowly, like a dial. */
export function fineTune(startAngle: number, dragX: number, degreesPerPixel: number): number {
  return startAngle + (dragX * degreesPerPixel * Math.PI) / 180;
}
