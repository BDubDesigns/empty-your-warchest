import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { WoodcuttingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const woodcuttingTunables: readonly Tunable[] = [
  { key: 'meterSpeed', label: 'Meter speed (passes/s)', min: 0.3, max: 3, step: 0.1 },
  { key: 'timingWindow', label: 'Timing window', min: 0.1, max: 0.9, step: 0.05 },
  { key: 'perfectWindow', label: 'Perfect window', min: 0.02, max: 0.4, step: 0.01 },
  { key: 'chopPoints', label: 'Chop points to fell', min: 1, max: 8, step: 1 },
  { key: 'fallSeconds', label: 'Fall time (s)', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'fallEase', label: 'Fall acceleration', min: 1, max: 4, step: 0.1 },
  { key: 'maxDeflection', label: 'Max deflection (°)', min: 0, max: 90, step: 5 },
  { key: 'chainDelay', label: 'Chain delay (s)', min: 0, max: 0.6, step: 0.02 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
];

export function woodcuttingFeel(
  defaults: WoodcuttingFeel,
  store: KeyValueStore,
): LiveTuning<WoodcuttingFeel> {
  return new LiveTuning('woodcutting', defaults, woodcuttingTunables, store);
}
