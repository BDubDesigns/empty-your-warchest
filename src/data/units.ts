import type { GameDataInput } from './schema';

// Combat numbers are placeholder guesses, to be tuned in M7–M9.
export const units = [
  {
    id: 'spearman',
    name: 'Spearman',
    hp: 10,
    unarmedDamage: 1,
    weapon: { item: 'spear', damageByQuality: { poor: 3, good: 4, perfect: 6 } },
  },
] satisfies GameDataInput['units'];

export const enemies = [
  { id: 'bandit', name: 'Bandit', hp: 10, damage: 3 },
] satisfies GameDataInput['enemies'];
