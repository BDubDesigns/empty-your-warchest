import { LiveChoice, LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { SiegeFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const siegeTunables: readonly Tunable[] = [
  {
    key: 'sightBlend',
    label: 'Camera: behind (0) to down the sights (1)',
    min: 0,
    max: 1,
    step: 0.05,
  },
  { key: 'crosshairSpeed', label: 'Crosshair: drag speed', min: 0.1, max: 2, step: 0.05 },
  { key: 'maxAim', label: 'Most turn to the side (°)', min: 5, max: 60, step: 1 },
  { key: 'aimLineLength', label: 'Aim line length (m)', min: 0, max: 20, step: 0.5 },
  { key: 'ghostWidth', label: 'Last shot line thickness (m)', min: 0.01, max: 0.3, step: 0.01 },
  { key: 'aimedSpread', label: 'Aimed: stray sideways (°)', min: 0, max: 10, step: 0.1 },
  { key: 'aimedTiltSpread', label: 'Aimed: stray up and down (°)', min: 0, max: 10, step: 0.1 },
  { key: 'aimedSpeedStray', label: 'Aimed: speed stray', min: 0, max: 0.2, step: 0.005 },
  { key: 'barrageSpread', label: 'Barrage: stray sideways (°)', min: 0, max: 25, step: 0.5 },
  { key: 'barrageTiltSpread', label: 'Barrage: stray up and down (°)', min: 0, max: 15, step: 0.5 },
  { key: 'barrageSpeedStray', label: 'Barrage: speed stray', min: 0, max: 0.2, step: 0.005 },
  { key: 'spearMass', label: 'Spear mass (kg)', min: 2, max: 150, step: 1 },
  { key: 'reloadSeconds', label: 'Reload (s)', min: 0, max: 3, step: 0.05 },
  {
    key: 'barrageStagger',
    label: 'Barrage: gap between waves (s)',
    min: 0,
    max: 0.5,
    step: 0.01,
    more: true,
  },
  { key: 'lineStagger', label: 'Volley ripple (s)', min: 0, max: 0.2, step: 0.005, more: true },
  { key: 'spotSeconds', label: 'Move to a spot (s)', min: 0.1, max: 3, step: 0.05, more: true },
  {
    key: 'advanceDelaySeconds',
    label: 'Position won: wait before moving on (s)',
    min: 0,
    max: 4,
    step: 0.1,
    more: true,
  },
  {
    key: 'advanceSeconds',
    label: 'Roll on to the next position (s)',
    min: 0.3,
    max: 6,
    step: 0.1,
    more: true,
  },
  {
    key: 'cameraTurn',
    label: 'Camera turns with the aim (share)',
    min: 0,
    max: 1,
    step: 0.05,
    more: true,
  },
  { key: 'scoutHeight', label: 'Scout: height (m)', min: 5, max: 60, step: 1, more: true },
  { key: 'scoutBack', label: 'Scout: short of the fort (m)', min: 0, max: 40, step: 1, more: true },
  { key: 'scoutSeconds', label: 'Scout: rise (s)', min: 0.1, max: 3, step: 0.05, more: true },
  { key: 'cameraHeight', label: 'Camera height (m)', min: 1, max: 15, step: 0.1, more: true },
  { key: 'cameraBack', label: 'Camera back (m)', min: 1, max: 20, step: 0.1, more: true },
  { key: 'cameraLookAhead', label: 'Camera looks out (m)', min: 3, max: 40, step: 0.5, more: true },
  {
    key: 'cameraLookHeight',
    label: 'Camera looks at height (m)',
    min: 0,
    max: 6,
    step: 0.1,
    more: true,
  },
  {
    key: 'cameraClearance',
    label: 'Camera stops short of a wall (m)',
    min: 0,
    max: 3,
    step: 0.1,
    more: true,
  },
  { key: 'followSeconds', label: 'Follow the spear (s)', min: 0, max: 3, step: 0.05, more: true },
  { key: 'follow', label: 'Follow: how far', min: 0, max: 1, step: 0.05, more: true },
  {
    key: 'followReturnSeconds',
    label: 'Follow: ease back (s)',
    min: 0.1,
    max: 3,
    step: 0.05,
    more: true,
  },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 5, more: true },
  {
    key: 'heavyHitStopMs',
    label: 'Heavy hit/break stop (ms)',
    min: 0,
    max: 300,
    step: 5,
    more: true,
  },
  { key: 'heavyHitSpeed', label: 'Heavy hit from (m/s)', min: 5, max: 40, step: 0.5, more: true },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.1, more: true },
  { key: 'thudSpeed', label: 'Thud from (m/s change)', min: 0.5, max: 10, step: 0.1, more: true },
  {
    key: 'thudGapSeconds',
    label: 'Thud gap per block (s)',
    min: 0,
    max: 1,
    step: 0.05,
    more: true,
  },
  { key: 'dust', label: 'Dust puffs', min: 0, max: 20, step: 1, more: true },
  {
    key: 'slowMo',
    label: 'Banner falls: slow-mo speed',
    min: 0.05,
    max: 1,
    step: 0.05,
    more: true,
  },
  {
    key: 'slowMoSeconds',
    label: 'Banner falls: slow-mo (s)',
    min: 0,
    max: 4,
    step: 0.1,
    more: true,
  },
  { key: 'buzzThrowMs', label: 'Vibrate: aimed shot (ms)', min: 0, max: 80, step: 1, more: true },
  { key: 'buzzBarrageMs', label: 'Vibrate: barrage (ms)', min: 0, max: 120, step: 1, more: true },
  { key: 'buzzHitMs', label: 'Vibrate: spear hits (ms)', min: 0, max: 60, step: 1, more: true },
  { key: 'buzzThudMs', label: 'Vibrate: block thud (ms)', min: 0, max: 60, step: 1, more: true },
  {
    key: 'buzzBreakMs',
    label: 'Vibrate: block breaks (ms)',
    min: 0,
    max: 120,
    step: 1,
    more: true,
  },
  {
    key: 'buzzGuardMs',
    label: 'Vibrate: guard down (ms)',
    min: 0,
    max: 120,
    step: 1,
    more: true,
  },
  {
    key: 'buzzBannerMs',
    label: 'Vibrate: banner falls (ms)',
    min: 0,
    max: 300,
    step: 5,
    more: true,
  },
];

export function siegeFeel(defaults: SiegeFeel, store: KeyValueStore): LiveTuning<SiegeFeel> {
  return new LiveTuning('siege', defaults, siegeTunables, store);
}

export type WarTent = 'siege' | 'runner';

/**
 * What the War tent opens, kept on this phone: the siege, or the gate runner it replaced (M7a),
 * kept playable for comparison.
 */
export function warTentChoice(store: KeyValueStore): LiveChoice<WarTent> {
  return new LiveChoice<WarTent>(
    'warchest.warTent',
    'War tent opens',
    [
      { value: 'siege', label: 'Siege' },
      { value: 'runner', label: 'Gate runner' },
    ],
    'siege',
    store,
  );
}
