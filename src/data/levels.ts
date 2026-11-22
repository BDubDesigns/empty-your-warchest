import type { GameDataInput } from './schema';

// Placeholder layout and numbers; M7 settles the real skirmish.
export const levels = [
  {
    id: 'skirmish_1',
    name: 'Bandit camp',
    kind: 'skirmish',
    durationSeconds: 30,
    unit: 'spearman',
    startingRecruits: 10,
    events: [
      {
        type: 'gates',
        at: 0.15,
        left: { op: 'add', value: 10 },
        right: { op: 'subtract', value: 5 },
      },
      { type: 'enemies', at: 0.35, enemy: 'bandit', count: 8 },
      {
        type: 'gates',
        at: 0.55,
        left: { op: 'multiply', value: 2 },
        right: { op: 'divide', value: 2, flippable: true },
      },
      { type: 'enemies', at: 0.75, enemy: 'bandit', count: 15 },
      { type: 'wall', at: 1, hp: 50 },
    ],
    rewards: { xpPerEnemy: 10, xpPerSurvivor: 5 },
  },
] satisfies GameDataInput['levels'];
