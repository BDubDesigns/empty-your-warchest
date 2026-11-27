import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { ArcheryFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const archeryTunables: readonly Tunable[] = [
  { key: 'gravity', label: 'Gravity on arrows (next round)', min: 4, max: 50, step: 0.5 },
  { key: 'arrowSpeed', label: 'Arrow speed × (next round)', min: 0.4, max: 2, step: 0.05 },
  { key: 'birdSpeed', label: 'Bird speed × (next round)', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'hitRadius', label: 'Bird hit size × (next round)', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'nearMiss', label: 'Near miss scares within (next round)', min: 0, max: 6, step: 0.1 },
  { key: 'fullDrawPx', label: 'Drag for a full draw (px)', min: 40, max: 320, step: 5 },
  { key: 'minDraw', label: 'Least draw that shoots (share)', min: 0, max: 0.6, step: 0.01 },
  { key: 'previewSeconds', label: 'Aim preview (s of flight)', min: 0, max: 1.5, step: 0.05 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10, more: true },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1, more: true },
  { key: 'buzzDrawMs', label: 'Vibrate: drawing (ms)', min: 0, max: 40, step: 1, more: true },
  { key: 'buzzReleaseMs', label: 'Vibrate: release (ms)', min: 0, max: 80, step: 1, more: true },
  { key: 'buzzHitMs', label: 'Vibrate: a hit (ms)', min: 0, max: 120, step: 1, more: true },
  { key: 'buzzPoopMs', label: 'Vibrate: a scared bird (ms)', min: 0, max: 80, step: 1, more: true },
];

export function archeryFeel(defaults: ArcheryFeel, store: KeyValueStore): LiveTuning<ArcheryFeel> {
  return new LiveTuning('archery', defaults, archeryTunables, store);
}
