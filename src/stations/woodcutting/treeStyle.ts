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

/** Whether the 3D clearing draws the grass, plants and forest outside its fence. */
export type SceneryDetail = 'full' | 'off';

/**
 * The scenery outside the fence, a debug menu choice kept on this phone: full by default, off for
 * a phone that struggles (and for the e2e tests, which draw 3D in software).
 */
export function sceneryChoice(store: KeyValueStore): LiveChoice<SceneryDetail> {
  return new LiveChoice<SceneryDetail>(
    'warchest.woodcutting.scenery',
    'Woodcutting scenery',
    [
      { value: 'full', label: 'Full' },
      { value: 'off', label: 'Off' },
    ],
    'full',
    store,
  );
}
