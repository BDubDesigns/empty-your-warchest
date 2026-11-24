import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { RivingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const rivingTunables: readonly Tunable[] = [
  { key: 'fineAimStep', label: 'Fine-tune step (°)', min: 0.1, max: 5, step: 0.1 },
  { key: 'strikeSeconds', label: 'Head drop (s)', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  { key: 'leverTravel', label: 'Lever drag, top to bottom (px)', min: 80, max: 600, step: 10 },
  { key: 'pressureAt', label: 'Full pressure ahead (share)', min: 0.05, max: 1, step: 0.05 },
  { key: 'driveSeconds', label: 'Through at full pressure (s)', min: 0.3, max: 5, step: 0.1 },
  {
    key: 'slowDriveSeconds',
    label: 'Through at gentle pressure (s)',
    min: 0.5,
    max: 10,
    step: 0.1,
  },
  { key: 'pressurePull', label: 'Extra wander at full pressure (×)', min: 0, max: 5, step: 0.1 },
  { key: 'wobble', label: 'Wander, any head', min: 0, max: 4, step: 0.05 },
  { key: 'wobbleFrom', label: 'Extra wander above (pieces)', min: 2, max: 16, step: 1 },
  { key: 'wobblePerStave', label: 'Extra wander per piece', min: 0, max: 2, step: 0.05 },
  { key: 'wobbleSeconds', label: 'Wander changes every (s)', min: 0.05, max: 1, step: 0.05 },
  { key: 'leanRate', label: 'Lean strength', min: 0.2, max: 6, step: 0.1 },
  { key: 'leanTravel', label: 'Drag for a full lean (px)', min: 20, max: 200, step: 5 },
  { key: 'knotJitter', label: 'Wander per line through a knot', min: 0, max: 4, step: 0.1 },
  { key: 'checkEase', label: 'Wander along checks (×)', min: 0, max: 1, step: 0.05 },
  { key: 'pieceSeconds', label: 'Lost piece falls (s)', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'burstSeconds', label: 'Staves burst out (s)', min: 0.3, max: 3, step: 0.05 },
  { key: 'heapSeconds', label: 'Heap waits before pouring (s)', min: 0, max: 3, step: 0.05 },
  { key: 'buzzStrikeMs', label: 'Vibrate: head lands (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzPressMs', label: 'Vibrate: pressure pulse (ms)', min: 0, max: 40, step: 1 },
  { key: 'pressPulseSlow', label: 'Pulses at the start (s apart)', min: 0.05, max: 1, step: 0.01 },
  { key: 'pressPulseFast', label: 'Pulses at the end (s apart)', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'buzzLostMs', label: 'Vibrate: piece lost (ms)', min: 0, max: 100, step: 1 },
  { key: 'buzzBurstMs', label: 'Vibrate: burst (ms)', min: 0, max: 150, step: 1 },
];

export function rivingFeel(defaults: RivingFeel, store: KeyValueStore): LiveTuning<RivingFeel> {
  return new LiveTuning('riving', defaults, rivingTunables, store);
}
