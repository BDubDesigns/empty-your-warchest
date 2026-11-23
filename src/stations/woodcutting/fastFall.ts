import { LiveChoice, type KeyValueStore } from '../../core';

export type FastFall = 'on' | 'off';

/**
 * The fast-fall switch (unlocked at a woodcutting level, see `unlocks`), kept on this phone:
 * trees fall and chain at the faster speeds in `woodcutting.fastFall`.
 */
export function fastFallChoice(store: KeyValueStore): LiveChoice<FastFall> {
  return new LiveChoice<FastFall>(
    'warchest.woodcutting.fastFall',
    'Fast fall',
    [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    'off',
    store,
  );
}
