import { LiveChoice, type Choice, type KeyValueStore } from '../core';

export type Vibration = 'on' | 'off';

/** Whether the game vibrates, kept on this phone. In the debug menu for now; a player setting later. */
export function vibrationChoice(store: KeyValueStore): LiveChoice<Vibration> {
  return new LiveChoice<Vibration>(
    'warchest.vibration',
    'Vibration',
    [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    'on',
    store,
  );
}

/**
 * Brief vibration pulses for juice: a chop landing, a chest opening. Android phones only; iPhone
 * browsers can't vibrate. Each pulse replaces any still running, so quick ones never pile up.
 */
export class Haptics {
  readonly #enabled: Choice<Vibration>;

  constructor(enabled: Choice<Vibration>) {
    this.#enabled = enabled;
  }

  /** Vibrates for `ms` milliseconds; 0 (e.g. tuned off in data) does nothing. */
  pulse(ms: number): void {
    if (ms <= 0 || this.#enabled.value === 'off' || !('vibrate' in navigator)) return;
    navigator.vibrate(Math.round(ms));
  }

  /**
   * A rumble that dies away: `pulses` pulses, the first `ms` long and each shorter than the last,
   * with short gaps between them (a crash, not a tap).
   */
  rumble(ms: number, pulses: number): void {
    if (ms <= 0 || this.#enabled.value === 'off' || !('vibrate' in navigator)) return;
    const pattern: number[] = [];
    for (let pulse = 0; pulse < pulses; pulse++) {
      const fade = 1 - pulse / pulses;
      if (pulse > 0) pattern.push(Math.round(25 + 30 * (1 - fade)));
      pattern.push(Math.max(Math.round(ms * fade), 8));
    }
    navigator.vibrate(pattern);
  }
}
