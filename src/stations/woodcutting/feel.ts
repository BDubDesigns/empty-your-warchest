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
  { key: 'boulderRoll', label: 'Boulder roll distance', min: 60, max: 600, step: 10 },
  { key: 'boulderSpeed', label: 'Boulder speed', min: 60, max: 500, step: 10 },
  { key: 'boulderBounce', label: 'Boulder bounce kept', min: 0, max: 1, step: 0.05 },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1 },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 10 },
  { key: 'buzzChopMs', label: 'Vibrate: chop (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzPerfectMs', label: 'Vibrate: perfect chop (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzHitMs', label: 'Vibrate: tree hits tree (ms)', min: 0, max: 60, step: 1 },
  { key: 'buzzLandMs', label: 'Vibrate: landing (ms)', min: 0, max: 60, step: 1 },
  {
    key: 'buzzLandPerTreeMs',
    label: 'Vibrate: landing, + per tree (ms)',
    min: 0,
    max: 20,
    step: 1,
  },
  { key: 'buzzLandMaxMs', label: 'Vibrate: landing, max (ms)', min: 0, max: 100, step: 1 },
  { key: 'crashHitStopMs', label: 'Cabin crash: hit-stop (ms)', min: 0, max: 300, step: 10 },
  { key: 'crashShake', label: 'Cabin crash: shake', min: 0, max: 1.5, step: 0.05 },
  { key: 'crashPunch', label: 'Cabin crash: camera punch in', min: 0, max: 0.5, step: 0.01 },
  { key: 'crashSlowMo', label: 'Cabin crash: slow-mo speed', min: 0.05, max: 1, step: 0.05 },
  { key: 'crashSlowMoSeconds', label: 'Cabin crash: slow-mo (s)', min: 0, max: 2, step: 0.1 },
  { key: 'crashPush', label: 'Cabin crash: push from the hit', min: 0, max: 12, step: 0.5 },
  { key: 'crashShove', label: 'Cabin crash: random shove', min: 0, max: 5, step: 0.1 },
  { key: 'crashGravity', label: 'Cabin crash: gravity', min: 2, max: 30, step: 1 },
  { key: 'crashFriction', label: 'Cabin crash: friction', min: 0, max: 1, step: 0.05 },
  { key: 'crashBounce', label: 'Cabin crash: bounce', min: 0, max: 0.8, step: 0.05 },
  {
    key: 'crashRubble',
    label: 'Cabin crash: tree rests at (share of height)',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'crashSagSeconds',
    label: 'Cabin crash: tree sinks over (s)',
    min: 0.1,
    max: 2,
    step: 0.1,
  },
  { key: 'crashSettleSeconds', label: 'Cabin crash: summary waits (s)', min: 0, max: 6, step: 0.2 },
  {
    key: 'buzzCrashMs',
    label: 'Vibrate: cabin crash, first pulse (ms)',
    min: 0,
    max: 200,
    step: 5,
  },
  { key: 'buzzCrashPulses', label: 'Vibrate: cabin crash, pulses', min: 1, max: 10, step: 1 },
];

export function woodcuttingFeel(
  defaults: WoodcuttingFeel,
  store: KeyValueStore,
): LiveTuning<WoodcuttingFeel> {
  return new LiveTuning('woodcutting', defaults, woodcuttingTunables, store);
}
