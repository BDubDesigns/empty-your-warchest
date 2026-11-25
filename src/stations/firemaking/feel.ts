import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { FiremakingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const firemakingTunables: readonly Tunable[] = [
  { key: 'heatPerLog', label: 'Heat per log (next fire)', min: 0.5, max: 6, step: 0.1 },
  { key: 'spill', label: 'Spill onto neighbours (next fire)', min: 0, max: 3, step: 0.1 },
  { key: 'cookSeconds', label: 'Cook time at an even fire (s)', min: 1, max: 15, step: 0.1 },
  { key: 'charRatio', label: 'Pull window (chars at × cook time)', min: 1.05, max: 2, step: 0.01 },
  { key: 'smokeWisps', label: 'Smoke: wisps from (share of cook)', min: 0, max: 0.95, step: 0.01 },
  {
    key: 'smokeThick',
    label: 'Smoke: thick from (share of cook)',
    min: 0.05,
    max: 0.99,
    step: 0.01,
  },
  { key: 'streakCap', label: 'Hot streak: most layers', min: 1, max: 5, step: 1 },
  { key: 'grabPx', label: 'Handle grab reach (px)', min: 20, max: 160, step: 5 },
  { key: 'dragPx', label: 'Drag to pull (px)', min: 5, max: 150, step: 5 },
  { key: 'pullSeconds', label: 'Rack slides out (s)', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'plungeSeconds', label: 'Spears plunge (s)', min: 0.2, max: 2, step: 0.05 },
  { key: 'pourDelaySeconds', label: 'Wait before pouring (s)', min: 0, max: 2, step: 0.05 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  { key: 'buzzLogMs', label: 'Vibrate: log drops in (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzLayMs', label: 'Vibrate: rack goes on (ms)', min: 0, max: 80, step: 1 },
  { key: 'buzzPullMs', label: 'Vibrate: the pull (ms)', min: 0, max: 80, step: 1 },
  { key: 'buzzPlungeMs', label: 'Vibrate: the plunge (ms)', min: 0, max: 120, step: 1 },
];

export function firemakingFeel(
  defaults: FiremakingFeel,
  store: KeyValueStore,
): LiveTuning<FiremakingFeel> {
  return new LiveTuning('firemaking', defaults, firemakingTunables, store);
}
