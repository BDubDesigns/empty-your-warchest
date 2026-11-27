import type { GameDataInput } from './schema';

// What a new save starts with (M9): a brewing kit, so the cauldron can be tried before foraging
// pays much. About three Sense potions' worth with some to spare (a brew takes up to 3 red caps,
// 7 woad, 2 moss and 6 ash). Woad only comes from here and the debug menu until farming.
export const newGame = {
  inventory: [
    { item: 'red_cap', count: 12 },
    { item: 'woad', count: 24 },
    { item: 'moss', count: 6 },
    { item: 'ash', count: 12 },
  ],
} satisfies GameDataInput['newGame'];
