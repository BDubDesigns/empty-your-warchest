// The numbers a run's frames come to. Frame times are in milliseconds, one per frame drawn.

/** The value `share` of the way up `sorted` (ascending), by linear interpolation. */
export function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(Math.max(share, 0), 1) * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (at - low);
}

export interface FrameStats {
  frames: number;
  /** Frames per second: the median frame's. */
  medianFps: number;
  /** The 5th-percentile frame rate: 95% of frames were at least this smooth. */
  p5Fps: number;
  /** The "1% low": the average rate over the slowest 1% of frames (at least one). */
  low1Fps: number;
  /** The longest frame (ms). */
  worstMs: number;
  /** The average rate over the whole run (frames / seconds). */
  averageFps: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** What a run's frame times come to. */
export function frameStats(frameMs: readonly number[]): FrameStats {
  const sorted = frameMs.filter((ms) => ms > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { frames: 0, medianFps: 0, p5Fps: 0, low1Fps: 0, worstMs: 0, averageFps: 0 };
  }
  const fps = (ms: number) => (ms > 0 ? 1000 / ms : 0);
  const slowest = sorted.slice(sorted.length - Math.max(1, Math.round(sorted.length / 100)));
  const slowAverage = slowest.reduce((sum, ms) => sum + ms, 0) / slowest.length;
  const total = sorted.reduce((sum, ms) => sum + ms, 0);
  return {
    frames: sorted.length,
    medianFps: round1(fps(percentile(sorted, 0.5))),
    p5Fps: round1(fps(percentile(sorted, 0.95))),
    low1Fps: round1(fps(slowAverage)),
    worstMs: round1(sorted[sorted.length - 1] ?? 0),
    averageFps: round1((sorted.length * 1000) / total),
  };
}

/** The median and the 95th percentile of some timings (ms), and the most. */
export function timingStats(ms: readonly number[]): { median: number; p95: number; max: number } {
  const sorted = [...ms].sort((a, b) => a - b);
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    median: round2(percentile(sorted, 0.5)),
    p95: round2(percentile(sorted, 0.95)),
    max: round2(sorted[sorted.length - 1] ?? 0),
  };
}

/**
 * Bytes a texture takes on the GPU: `width` × `height` pixels of `bytesPerPixel` (RGBA8 is 4),
 * and a third as much again for its mipmaps (the smaller copies drawn at a distance).
 */
export function textureBytes(
  width: number,
  height: number,
  { mipmaps = true, bytesPerPixel = 4 }: { mipmaps?: boolean; bytesPerPixel?: number } = {},
): number {
  const base = width * height * bytesPerPixel;
  return mipmaps ? Math.round((base * 4) / 3) : base;
}
