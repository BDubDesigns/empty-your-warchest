import { LiveTuning, type KeyValueStore, type Tunable } from '../../core';
import type { BrewingFeel } from '../../data';

/** Slider ranges for the debug menu's live tuning panel. */
export const brewingTunables: readonly Tunable[] = [
  { key: 'stirPerTurn', label: 'Stir: blended per turn (share)', min: 0.05, max: 1, step: 0.01 },
  { key: 'maxTurnsPerSecond', label: 'Stir: top speed (turns/s)', min: 0.2, max: 5, step: 0.1 },
  { key: 'stirDeadPx', label: 'Stir: dead zone (px)', min: 0, max: 40, step: 1, more: true },
  { key: 'dropSeconds', label: 'Drop falls in (s)', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'swirlDrift', label: 'Swirls drift (turns/s)', min: 0, max: 0.5, step: 0.01, more: true },
  {
    key: 'revealUnmixed',
    label: 'Map shows the ring below (unstirred share)',
    min: 0,
    max: 1,
    step: 0.01,
  },
  { key: 'cloudPx', label: 'Map: unstirred blur (px)', min: 0, max: 40, step: 1, more: true },
  { key: 'dragStartPx', label: 'Drag: lifts after (px)', min: 0, max: 40, step: 1, more: true },
  { key: 'snapBackSeconds', label: 'Drag: a miss snaps back (s)', min: 0.05, max: 1, step: 0.05 },
  { key: 'dropPadPx', label: 'Drag: drop zone past the pot (px)', min: 0, max: 120, step: 2 },
  { key: 'buzzDropMs', label: 'Vibrate: a drop (ms)', min: 0, max: 60, step: 1, more: true },
  {
    key: 'buzzStirMs',
    label: 'Vibrate: a quarter stir (ms)',
    min: 0,
    max: 30,
    step: 1,
    more: true,
  },
  { key: 'buzzBottleMs', label: 'Vibrate: bottling (ms)', min: 0, max: 120, step: 1, more: true },
];

export function brewingFeel(defaults: BrewingFeel, store: KeyValueStore): LiveTuning<BrewingFeel> {
  return new LiveTuning('brewing', defaults, brewingTunables, store);
}
