import { LiveChoice, type GraphicsTier, type KeyValueStore } from '../../core';

/** Which tree models the 3D clearing uses: the detailed Quaternius ones, or the simpler Kenney ones. */
export type TreeStyle = 'kenney' | 'quaternius';
/** The debug menu's pick: one of the styles, or `auto` (by the graphics tier). */
export type TreeStyleSetting = 'auto' | TreeStyle;

/**
 * The tree style, a debug menu choice kept on this phone. On Auto (the default) it follows the
 * graphics tier: the detailed trees on high, the simple ones on low.
 */
export function treeStyleChoice(store: KeyValueStore): LiveChoice<TreeStyleSetting> {
  return new LiveChoice<TreeStyleSetting>(
    'warchest.woodcutting.treeStyle',
    'Woodcutting trees',
    [
      { value: 'auto', label: 'Auto' },
      { value: 'quaternius', label: 'Detailed (Quaternius)' },
      { value: 'kenney', label: 'Simple (Kenney)' },
    ],
    'auto',
    store,
  );
}

/** The trees to draw: the one picked, or on Auto the graphics tier's. */
export function treeStyleFor(setting: TreeStyleSetting, tier: GraphicsTier): TreeStyle {
  if (setting !== 'auto') return setting;
  return tier === 'low' ? 'kenney' : 'quaternius';
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
