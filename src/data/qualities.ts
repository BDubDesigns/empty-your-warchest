import type { GameDataInput } from './schema';

/** Quality tiers for tiered items, worst to best. */
export const qualities = [
  { id: 'poor', name: 'Poor' },
  { id: 'good', name: 'Good' },
  { id: 'perfect', name: 'Perfect' },
] satisfies GameDataInput['qualities'];
