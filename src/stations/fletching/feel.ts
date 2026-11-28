import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { FletchingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const fletchingTunables: readonly Tunable[] = [
  { key: 'tarFill', label: 'Tar rises (a full coat a second ×)', min: 0.15, max: 2, step: 0.05 },
  { key: 'tarLow', label: 'Green band: from (share of a full coat)', min: 0, max: 1, step: 0.01 },
  { key: 'tarHigh', label: 'Green band: to (share of a full coat)', min: 0, max: 1, step: 0.01 },
  { key: 'turnSpeed', label: 'Shaft turns (° a second)', min: 30, max: 400, step: 5 },
  { key: 'markWindowMs', label: 'Feather on its mark: within (± ms)', min: 20, max: 300, step: 5 },
  { key: 'leadSeconds', label: 'First mark comes up after (s)', min: 0, max: 2, step: 0.05 },
  { key: 'dipPx', label: 'Drag down to dip (px)', min: 10, max: 160, step: 5, more: true },
  { key: 'streakCap', label: 'Hot streak: at most (× the batch)', min: 1, max: 5, step: 1 },
  {
    key: 'finishSeconds',
    label: 'Batch off to the chest after (s)',
    min: 0,
    max: 2,
    step: 0.05,
    more: true,
  },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1, more: true },
  { key: 'buzzDipMs', label: 'Vibrate: into the tar (ms)', min: 0, max: 60, step: 1, more: true },
  { key: 'buzzSlapMs', label: 'Vibrate: feather on (ms)', min: 0, max: 80, step: 1, more: true },
  { key: 'buzzMissMs', label: 'Vibrate: feather off (ms)', min: 0, max: 120, step: 1, more: true },
  { key: 'buzzBucketMs', label: 'Vibrate: the bucket (ms)', min: 0, max: 120, step: 1, more: true },
];

export function fletchingFeel(
  defaults: FletchingFeel,
  store: KeyValueStore,
): LiveTuning<FletchingFeel> {
  return new LiveTuning('fletching', defaults, fletchingTunables, store);
}
