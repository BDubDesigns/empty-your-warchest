import { LiveTuning, type KeyValueStore, type Tunable } from '../core';
import type { RunnerFeel } from '../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const runnerTunables: readonly Tunable[] = [
  { key: 'spearsPoor', label: 'Spears: Poor', min: 0, max: 100, step: 1 },
  { key: 'spearsGood', label: 'Spears: Good', min: 0, max: 100, step: 1 },
  { key: 'spearsPerfect', label: 'Spears: Perfect', min: 0, max: 100, step: 1 },
  { key: 'runSpeed', label: 'Run speed (m/s)', min: 4, max: 25, step: 0.5 },
  { key: 'steerSpeed', label: 'Steering speed (m/s)', min: 5, max: 80, step: 1 },
  { key: 'steerSmoothing', label: 'Steering smoothing (s)', min: 0, max: 0.4, step: 0.01 },
  { key: 'dragScale', label: 'Drag: track widths per screen', min: 0.5, max: 3, step: 0.1 },
  { key: 'crowdSpread', label: 'Crowd spread', min: 0.1, max: 0.8, step: 0.02 },
  { key: 'edgeLag', label: 'Crowd edge lag', min: 0, max: 2, step: 0.05 },
  { key: 'tradeSeconds', label: 'Clash: first trade gap (s)', min: 0.03, max: 0.5, step: 0.01 },
  { key: 'tradeSpeedup', label: 'Clash: speed-up per trade', min: 0.8, max: 1, step: 0.01 },
  { key: 'tradeMinSeconds', label: 'Clash: fastest gap (s)', min: 0.01, max: 0.2, step: 0.01 },
  { key: 'wallHitSeconds', label: 'Wall: first hit gap (s)', min: 0.03, max: 0.5, step: 0.01 },
  { key: 'flipAttackRate', label: 'Flip gate attack rate', min: 0, max: 3, step: 0.05 },
  { key: 'flipRange', label: 'Flip gate attack range (m)', min: 10, max: 120, step: 5 },
  { key: 'gateReadSeconds', label: 'Gate read-ahead (s)', min: 0.5, max: 5, step: 0.1 },
  { key: 'cameraAngle', label: 'Camera angle (°)', min: 15, max: 75, step: 1 },
  { key: 'cameraDistance', label: 'Camera distance (m)', min: 6, max: 40, step: 0.5 },
  { key: 'cameraPullback', label: 'Camera pull-back per crowd m', min: 0, max: 4, step: 0.1 },
  { key: 'slowMoScale', label: 'Wall break slow-mo speed', min: 0.05, max: 1, step: 0.05 },
  { key: 'slowMoSeconds', label: 'Wall break slow-mo (s)', min: 0, max: 2, step: 0.1 },
  { key: 'buzzGoodGateMs', label: 'Vibrate: good gate (ms)', min: 0, max: 100, step: 1 },
  { key: 'buzzBadGateMs', label: 'Vibrate: bad gate (ms)', min: 0, max: 150, step: 1 },
  { key: 'buzzFlipMs', label: 'Vibrate: gate flips (ms)', min: 0, max: 100, step: 1 },
  { key: 'buzzTradeMs', label: 'Vibrate: clash trade (ms)', min: 0, max: 40, step: 1 },
  { key: 'buzzWallHitMs', label: 'Vibrate: wall hit (ms)', min: 0, max: 40, step: 1 },
  { key: 'buzzWallBreakMs', label: 'Vibrate: wall breaks (ms)', min: 0, max: 300, step: 5 },
  { key: 'buzzLoseMs', label: 'Vibrate: retreat (ms)', min: 0, max: 200, step: 5 },
];

export function runnerFeel(defaults: RunnerFeel, store: KeyValueStore): LiveTuning<RunnerFeel> {
  return new LiveTuning('runner', defaults, runnerTunables, store);
}
