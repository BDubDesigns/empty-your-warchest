import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { RivingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const rivingTunables: readonly Tunable[] = [
  { key: 'fineAimStep', label: 'Fine-tune step (°)', min: 0.25, max: 5, step: 0.25 },
  { key: 'strikeSeconds', label: 'Mallet swing (s)', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  { key: 'leverTravel', label: 'Drag for a full crack (px)', min: 80, max: 500, step: 10 },
  { key: 'bandLow', label: 'Steady band: slowest (logs/s)', min: 0.1, max: 2, step: 0.05 },
  { key: 'bandHigh', label: 'Steady band: fastest (logs/s)', min: 0.3, max: 4, step: 0.05 },
  { key: 'bindSeconds', label: 'Too slow before it binds (s)', min: 0.2, max: 3, step: 0.05 },
  { key: 'speedWindow', label: 'Speed averaged over (s)', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'strainRise', label: 'Strain gain (yanking)', min: 0.2, max: 10, step: 0.1 },
  { key: 'strainRecover', label: 'Strain recovery (/s)', min: 0, max: 5, step: 0.1 },
  { key: 'checkEase', label: 'Strain along a check (×)', min: 0, max: 1, step: 0.05 },
  { key: 'pieceSeconds', label: 'Pieces come apart (s)', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'buzzStrikeMs', label: 'Vibrate: strike (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzCrackMs', label: 'Vibrate: strain tick (ms)', min: 0, max: 40, step: 1 },
  { key: 'buzzCleanMs', label: 'Vibrate: clean split (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzRunoutMs', label: 'Vibrate: runout (ms)', min: 0, max: 100, step: 1 },
];

export function rivingFeel(defaults: RivingFeel, store: KeyValueStore): LiveTuning<RivingFeel> {
  return new LiveTuning('riving', defaults, rivingTunables, store);
}
