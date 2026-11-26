import type { GameDataInput } from './schema';

// One set of numbers for everyone (decided Nov 24): a Good spear is the baseline, Poor does half
// its damage and Perfect half again; unarmed recruits mostly soak up hits.
export const units = [
  {
    id: 'spearman',
    name: 'Spearman',
    hp: 10,
    unarmedDamage: 1,
    weapon: { item: 'spear', damage: 4 },
  },
] satisfies GameDataInput['units'];

// Bandits fight exactly like recruits: unarmed ones like unarmed recruits, armed ones like a
// spearman with a Good spear.
export const enemies = [
  { id: 'bandit', name: 'Bandit', unit: 'spearman' },
] satisfies GameDataInput['enemies'];
