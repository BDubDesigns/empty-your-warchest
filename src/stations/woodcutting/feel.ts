import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { WoodcuttingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const woodcuttingTunables: readonly Tunable[] = [
  { key: 'maxPull', label: 'Full pull distance', min: 40, max: 200, step: 5 },
  { key: 'swingTarget', label: 'Gold band position', min: 0.2, max: 0.9, step: 0.02 },
  { key: 'timingWindow', label: 'Green band width', min: 0.1, max: 0.8, step: 0.02 },
  { key: 'perfectWindow', label: 'Gold band width', min: 0.02, max: 0.4, step: 0.01 },
  { key: 'goodScatter', label: 'Good swing aim drift (°)', min: 0, max: 45, step: 1 },
  { key: 'glancingScatter', label: 'Glancing swing aim drift (°)', min: 0, max: 60, step: 1 },
  { key: 'windArc', label: 'Axe wind-up arc (°)', min: 30, max: 170, step: 5 },
  { key: 'swingSeconds', label: 'Swing time (s)', min: 0.05, max: 0.5, step: 0.01 },
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
