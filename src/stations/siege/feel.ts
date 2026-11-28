import { LiveChoice, LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { SiegeFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const siegeTunables: readonly Tunable[] = [
  { key: 'aimPerPx', label: 'Aim: view turns per pixel dragged', min: 0.2, max: 4, step: 0.05 },
  {
    key: 'aimFallback',
    label: 'Aim: reach with nothing under it (m)',
    min: 20,
    max: 300,
    step: 5,
    more: true,
  },
  { key: 'reticleSize', label: 'Sight: ring size (px)', min: 20, max: 160, step: 2 },
  { key: 'aimedSpread', label: 'Aimed: stray sideways (°)', min: 0, max: 3, step: 0.05 },
  { key: 'aimedTiltSpread', label: 'Aimed: stray up and down (°)', min: 0, max: 2, step: 0.05 },
  {
    key: 'aimedSpeedStray',
    label: 'Aimed: speed stray',
    min: 0,
    max: 0.2,
    step: 0.005,
    more: true,
  },
  { key: 'barrageSpread', label: 'Barrage: stray sideways (°)', min: 0, max: 20, step: 0.5 },
  { key: 'barrageTiltSpread', label: 'Barrage: stray up and down (°)', min: 0, max: 8, step: 0.1 },
  {
    key: 'barrageSpeedStray',
    label: 'Barrage: speed stray',
    min: 0,
    max: 0.3,
    step: 0.01,
    more: true,
  },
  {
    key: 'barrageStagger',
    label: 'Barrage: waves apart (s)',
    min: 0,
    max: 0.6,
    step: 0.01,
    more: true,
  },
  { key: 'lineStagger', label: 'Volley ripple (s)', min: 0, max: 0.2, step: 0.005, more: true },
  {
    key: 'ghostWidth',
    label: 'Last shot line thickness (m)',
    min: 0.01,
    max: 0.4,
    step: 0.01,
    more: true,
  },
  {
    key: 'ghostPx',
    label: 'Last shot line: least width (px)',
    min: 1,
    max: 12,
    step: 0.5,
    more: true,
  },
  { key: 'spearMass', label: 'Spear mass (kg)', min: 1, max: 30, step: 0.5 },
  { key: 'reloadSeconds', label: 'Reload (s)', min: 0, max: 4, step: 0.05 },
  { key: 'kickBack', label: 'Shot kick: back (m)', min: 0, max: 1.5, step: 0.05, more: true },
  { key: 'kickTilt', label: 'Shot kick: up (°)', min: 0, max: 6, step: 0.1, more: true },
  {
    key: 'kickSeconds',
    label: 'Shot kick: settles (s)',
    min: 0.05,
    max: 1,
    step: 0.01,
    more: true,
  },
  { key: 'senseSeconds', label: 'Sense potion: lasts (s)', min: 1, max: 30, step: 0.5 },
  { key: 'markSize', label: 'Objectives: gold mark size (m)', min: 0.2, max: 4, step: 0.05 },
  { key: 'followBack', label: 'Follow shot: behind the spear (m)', min: 2, max: 30, step: 0.5 },
  {
    key: 'followRise',
    label: 'Follow shot: above the spear (m)',
    min: 0,
    max: 10,
    step: 0.1,
    more: true,
  },
  {
    key: 'followInSeconds',
    label: 'Follow shot: gets there (s)',
    min: 0.02,
    max: 1,
    step: 0.01,
    more: true,
  },
  { key: 'followSlowMo', label: 'Follow shot: flight speed', min: 0.05, max: 1, step: 0.05 },
  {
    key: 'followHoldSeconds',
    label: 'Follow shot: holds on the hit (s)',
    min: 0,
    max: 3,
    step: 0.05,
  },
  {
    key: 'followReturnSeconds',
    label: 'Follow shot: comes back (s)',
    min: 0.05,
    max: 2,
    step: 0.05,
  },
  { key: 'killCamSeconds', label: 'Kill look: length (s)', min: 0, max: 3, step: 0.05 },
  { key: 'killCamSlowMo', label: 'Kill look: slow-mo speed', min: 0.05, max: 1, step: 0.05 },
  { key: 'killCamStopMs', label: 'Kill look: freeze (ms)', min: 0, max: 300, step: 5, more: true },
  {
    key: 'killCamZoom',
    label: 'Kill look: zoom (share of the view)',
    min: 0.2,
    max: 1,
    step: 0.05,
  },
  {
    key: 'killCamInSeconds',
    label: 'Kill look: turns there (s)',
    min: 0.02,
    max: 1,
    step: 0.01,
    more: true,
  },
  {
    key: 'killCamOutSeconds',
    label: 'Kill look: turns back (s)',
    min: 0.05,
    max: 2,
    step: 0.05,
    more: true,
  },
  {
    key: 'collapseParts',
    label: 'Collapse look: parts breaking',
    min: 1,
    max: 20,
    step: 1,
    more: true,
  },
  {
    key: 'collapseWindowSeconds',
    label: 'Collapse look: within (s)',
    min: 0.1,
    max: 3,
    step: 0.05,
    more: true,
  },
  { key: 'buzzKillMs', label: 'Vibrate: kill look (ms)', min: 0, max: 200, step: 5, more: true },
  { key: 'hitStopMs', label: 'Hit-stop (ms)', min: 0, max: 200, step: 5 },
  { key: 'heavyHitStopMs', label: 'Heavy hit-stop (ms)', min: 0, max: 300, step: 5, more: true },
  { key: 'heavyHitSpeed', label: 'Heavy hit from (m/s)', min: 10, max: 120, step: 1, more: true },
  { key: 'shakeStrength', label: 'Shake strength', min: 0, max: 3, step: 0.05 },
  { key: 'thudSpeed', label: 'Thud from (m/s change)', min: 0.5, max: 10, step: 0.1, more: true },
  {
    key: 'thudGapSeconds',
    label: 'Thuds a part apart (s)',
    min: 0,
    max: 1,
    step: 0.01,
    more: true,
  },
  { key: 'dust', label: 'Dust puffs', min: 0, max: 20, step: 1 },
  {
    key: 'slowMo',
    label: 'Last objective: slow-mo speed',
    min: 0.05,
    max: 1,
    step: 0.05,
    more: true,
  },
  {
    key: 'slowMoSeconds',
    label: 'Last objective: slow-mo (s)',
    min: 0,
    max: 5,
    step: 0.1,
    more: true,
  },
  { key: 'buzzThrowMs', label: 'Vibrate: aimed shot (ms)', min: 0, max: 120, step: 5, more: true },
  { key: 'buzzBarrageMs', label: 'Vibrate: barrage (ms)', min: 0, max: 120, step: 5, more: true },
  { key: 'buzzHitMs', label: 'Vibrate: spear hits (ms)', min: 0, max: 120, step: 5, more: true },
  { key: 'buzzThudMs', label: 'Vibrate: part thud (ms)', min: 0, max: 120, step: 1, more: true },
  { key: 'buzzBreakMs', label: 'Vibrate: part breaks (ms)', min: 0, max: 200, step: 5, more: true },
  { key: 'buzzGuardMs', label: 'Vibrate: guard down (ms)', min: 0, max: 200, step: 5, more: true },
  {
    key: 'buzzObjectiveMs',
    label: 'Vibrate: objective done (ms)',
    min: 0,
    max: 300,
    step: 5,
    more: true,
  },
  {
    key: 'buzzWinMs',
    label: 'Vibrate: every objective done (ms)',
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

export type HitBoxes = 'on' | 'off';

/** Debug: whether the siege draws its guards' hit boxes (the rules' boxes) over them. */
export function hitBoxChoice(store: KeyValueStore): LiveChoice<HitBoxes> {
  return new LiveChoice<HitBoxes>(
    'warchest.siege.hitBoxes',
    'Siege: guards’ hit boxes',
    [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    'off',
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
