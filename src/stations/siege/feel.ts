import { LiveChoice, LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { SiegeFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const siegeTunables: readonly Tunable[] = [
  {
    key: 'lookYawPerPx',
    label: 'Look: turn per pixel dragged (°)',
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'lookTiltPerPx',
    label: 'Look: tilt per pixel dragged (°)',
    min: 0.01,
    max: 0.3,
    step: 0.005,
  },
  { key: 'maxAim', label: 'Most turn to the side (°)', min: 5, max: 80, step: 1 },
  {
    key: 'aimFallback',
    label: 'Aim: reach with nothing under it (m)',
    min: 10,
    max: 200,
    step: 5,
    more: true,
  },
  { key: 'reticleSize', label: 'Sight: ring size (px)', min: 20, max: 160, step: 2 },
  {
    key: 'sightNear',
    label: 'Sights: nothing drawn nearer (m)',
    min: 0.05,
    max: 3,
    step: 0.05,
    more: true,
  },
  { key: 'kickBack', label: 'Shot kick: back (m)', min: 0, max: 1.5, step: 0.05 },
  { key: 'kickTilt', label: 'Shot kick: up (°)', min: 0, max: 6, step: 0.1 },
  { key: 'kickSeconds', label: 'Shot kick: settles (s)', min: 0.05, max: 1, step: 0.01 },
  { key: 'sightFov', label: 'Sights: field of view (°)', min: 20, max: 80, step: 1 },
  {
    key: 'sightBack',
    label: 'Sights: eye behind the pivot (m)',
    min: 0,
    max: 2,
    step: 0.05,
    more: true,
  },
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
  { key: 'zzzSize', label: 'Sleeper: Z z z size (m)', min: 0.1, max: 2, step: 0.05, more: true },
  { key: 'markSize', label: 'Alerted: ! size (m)', min: 0.1, max: 2, step: 0.05, more: true },
  { key: 'markSeconds', label: 'Alerted: ! shows (s)', min: 0, max: 5, step: 0.1, more: true },
  { key: 'flyoverSeconds', label: 'Flyover: length (s)', min: 1, max: 20, step: 0.5 },
  { key: 'flyoverHeight', label: 'Flyover: height (m)', min: 2, max: 60, step: 1, more: true },
  {
    key: 'flyoverBack',
    label: 'Flyover: back from what it shows (m)',
    min: 0,
    max: 50,
    step: 1,
    more: true,
  },
  { key: 'scoutHeight', label: 'Scout: height (m)', min: 5, max: 100, step: 1, more: true },
  { key: 'scoutBack', label: 'Scout: short of the fort (m)', min: 0, max: 40, step: 1, more: true },
  { key: 'scoutSeconds', label: 'Scout: rise (s)', min: 0.1, max: 3, step: 0.05, more: true },
  {
    key: 'cameraClearance',
    label: 'Camera stops short of a wall (m)',
    min: 0,
    max: 3,
    step: 0.1,
    more: true,
  },
  { key: 'boltCamBack', label: 'Bolt cam: behind the spear (m)', min: 0, max: 8, step: 0.1 },
  { key: 'boltCamRise', label: 'Bolt cam: above the spear (m)', min: 0, max: 3, step: 0.05 },
  {
    key: 'boltCamInSeconds',
    label: 'Bolt cam: cut in (s)',
    min: 0.01,
    max: 1,
    step: 0.01,
    more: true,
  },
  { key: 'boltCamHoldSeconds', label: 'Bolt cam: hold on the hit (s)', min: 0, max: 2, step: 0.05 },
  {
    key: 'boltCamReturnSeconds',
    label: 'Bolt cam: back to the sights (s)',
    min: 0.05,
    max: 2,
    step: 0.05,
  },
  { key: 'killCamSeconds', label: 'Kill cam: length (s)', min: 0, max: 3, step: 0.05 },
  { key: 'killCamSlowMo', label: 'Kill cam: slow-mo speed', min: 0.05, max: 1, step: 0.05 },
  { key: 'killCamStopMs', label: 'Kill cam: freeze (ms)', min: 0, max: 400, step: 5, more: true },
  {
    key: 'killCamDistance',
    label: 'Kill cam: distance (m)',
    min: 1,
    max: 15,
    step: 0.25,
    more: true,
  },
  {
    key: 'collapseCamDistance',
    label: 'Collapse cam: distance (m)',
    min: 2,
    max: 30,
    step: 0.5,
    more: true,
  },
  { key: 'killCamRise', label: 'Kill cam: height (m)', min: 0, max: 6, step: 0.1, more: true },
  {
    key: 'collapseBlocks',
    label: 'Collapse cam: blocks breaking',
    min: 2,
    max: 30,
    step: 1,
    more: true,
  },
  {
    key: 'collapseWindowSeconds',
    label: 'Collapse cam: within (s)',
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
  { key: 'buzzKillMs', label: 'Vibrate: kill cam (ms)', min: 0, max: 200, step: 5, more: true },
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

export type GhostLine = 'on' | 'off';

/** Whether the siege draws the last shot's path, kept on this phone (the player's switch). */
export function ghostChoice(store: KeyValueStore): LiveChoice<GhostLine> {
  return new LiveChoice<GhostLine>(
    'warchest.siege.ghost',
    'Siege: last shot line',
    [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    'on',
    store,
  );
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
