import { LiveChoice, type KeyValueStore } from '../../core';

/** Which tree models the 3D clearing uses: the detailed Quaternius ones, or the simpler Kenney ones. */
export type TreeStyle = 'kenney' | 'quaternius';

/**
 * The tree style, a debug menu choice kept on this phone. Defaults to the detailed trees; the 3D
 * view switches to the simple ones for good on a slow phone unless one was already picked.
 */
export function treeStyleChoice(store: KeyValueStore): LiveChoice<TreeStyle> {
  return new LiveChoice<TreeStyle>(
    'warchest.woodcutting.treeStyle',
    'Woodcutting trees',
    [
      { value: 'quaternius', label: 'Detailed (Quaternius)' },
      { value: 'kenney', label: 'Simple (Kenney)' },
    ],
    'quaternius',
    store,
  );
}
