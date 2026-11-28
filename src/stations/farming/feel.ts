import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { FarmingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const farmingTunables: readonly Tunable[] = [
  { key: 'pourRate', label: 'Can pours (a gauge a second ×)', min: 0.1, max: 1.5, step: 0.02 },
  { key: 'liftPx', label: 'Stream lands above the finger (px)', min: 0, max: 160, step: 5 },
  {
    key: 'dryEndSeconds',
    label: 'Ends after the can runs dry (s)',
    min: 0,
    max: 3,
    step: 0.1,
    more: true,
  },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1, more: true },
  { key: 'buzzPlantMs', label: 'Vibrate: a seed in (ms)', min: 0, max: 60, step: 1, more: true },
  { key: 'buzzBandMs', label: 'Vibrate: in the band (ms)', min: 0, max: 80, step: 1, more: true },
  { key: 'buzzMudMs', label: 'Vibrate: mud (ms)', min: 0, max: 120, step: 1, more: true },
  { key: 'buzzHarvestMs', label: 'Vibrate: a harvest (ms)', min: 0, max: 80, step: 1, more: true },
];

export function farmingFeel(defaults: FarmingFeel, store: KeyValueStore): LiveTuning<FarmingFeel> {
  return new LiveTuning('farming', defaults, farmingTunables, store);
}
