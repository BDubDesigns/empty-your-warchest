import type { GameDataInput } from './schema';

// What a new save starts with (M9): a brewing kit, so the cauldron can be tried before foraging
// pays much. About three Sense potions' worth.
export const newGame = {
  inventory: [
    { item: 'red_cap', count: 18 },
    { item: 'moss', count: 8 },
    { item: 'ash', count: 6 },
  ],
} satisfies GameDataInput['newGame'];
