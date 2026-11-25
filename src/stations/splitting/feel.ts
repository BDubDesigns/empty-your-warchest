import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { SplittingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const splittingTunables: readonly Tunable[] = [
  { key: 'strikeSeconds', label: 'Press swings over (s)', min: 0.05, max: 1, step: 0.01 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  {
    key: 'buzzCutMs',
    label: 'Vibrate: a line starts/stops cutting a grain (ms)',
    min: 0,
    max: 30,
    step: 1,
  },
  { key: 'tickGapMs', label: 'Degree clicks at most every (ms)', min: 0, max: 150, step: 5 },
  { key: 'liftMs', label: 'Lift guard: still for (ms)', min: 0, max: 400, step: 10 },
  { key: 'liftPx', label: 'Lift guard: moved under (px)', min: 0, max: 30, step: 1 },
  { key: 'pumpTravel', label: 'Pump stroke (px)', min: 20, max: 250, step: 5 },
  { key: 'pumpsFew', label: 'Strokes, fewest-piece head', min: 1, max: 10, step: 1 },
  { key: 'pumpsMany', label: 'Strokes, most-piece head', min: 1, max: 12, step: 1 },
  { key: 'pumpSeconds', label: 'Head drives in per stroke (s)', min: 0.03, max: 0.5, step: 0.01 },
  { key: 'burstSeconds', label: 'Staves burst out (s)', min: 0.3, max: 3, step: 0.05 },
  { key: 'heapSeconds', label: 'Heap waits before pouring (s)', min: 0, max: 3, step: 0.05 },
  { key: 'buzzStrikeMs', label: 'Vibrate: head lands (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzPumpMs', label: 'Vibrate: each stroke (ms)', min: 0, max: 80, step: 1 },
  {
    key: 'buzzPumpBuildMs',
    label: 'Vibrate: extra by the last stroke (ms)',
    min: 0,
    max: 100,
    step: 1,
  },
  { key: 'buzzBurstMs', label: 'Vibrate: burst (ms)', min: 0, max: 150, step: 1 },
];

export function splittingFeel(
  defaults: SplittingFeel,
  store: KeyValueStore,
): LiveTuning<SplittingFeel> {
  return new LiveTuning('splitting', defaults, splittingTunables, store);
}
