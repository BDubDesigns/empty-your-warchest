import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { WoodcuttingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const woodcuttingTunables: readonly Tunable[] = [
  { key: 'meterSpeed', label: 'Bar marker speed (passes/s)', min: 0.3, max: 3, step: 0.1 },
  { key: 'timingWindow', label: 'Green zone width', min: 0.1, max: 0.8, step: 0.02 },
  { key: 'perfectWindow', label: 'Yellow width, hard pull', min: 0.02, max: 0.4, step: 0.01 },
  { key: 'perfectWindowLight', label: 'Yellow width, light pull', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'goodScatter', label: 'Good chop aim drift (°)', min: 0, max: 45, step: 1 },
  { key: 'glancingScatter', label: 'Glancing chop aim drift (°)', min: 0, max: 60, step: 1 },
  { key: 'swingSeconds', label: 'Swing time (s)', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'chopPoints', label: 'Chop points to fell', min: 1, max: 12, step: 1 },
  { key: 'fullPullPoints', label: 'Points for a full pull', min: 1, max: 6, step: 1 },
  { key: 'perfectBonus', label: 'Yellow bonus points', min: 0, max: 4, step: 1 },
  { key: 'fineAimStep', label: 'Fine-tune step (°)', min: 0.25, max: 5, step: 0.25 },
  { key: 'fallSeconds', label: 'Fall time (s)', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'fallEase', label: 'Fall acceleration', min: 1, max: 4, step: 0.1 },
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
