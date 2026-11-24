import type { GameDataInput } from './schema';

// The M7a test skirmish (decided Nov 24). Gates are decisions, not tests: after one obvious
// teaching pair, both sides are good or both cost something, and which is better depends on your
// count and spears at that moment. Counts and hit points are first guesses, tuned in data.
export const levels = [
  {
    id: 'skirmish_1',
    name: 'Bandit camp',
    kind: 'skirmish',
    durationSeconds: 30,
    unit: 'spearman',
    startingRecruits: 10,
    events: [
      // Teaches colour and shape: the one obvious pair.
      {
        type: 'gates',
        at: 0.12,
        left: { op: 'add', value: 10 },
        right: { op: 'subtract', value: 3 },
      },
      { type: 'enemies', at: 0.3, enemy: 'bandit', count: 6 },
      // Both good: which wins depends on how the clash went.
      {
        type: 'gates',
        at: 0.48,
        left: { op: 'add', value: 15 },
        right: { op: 'multiply', value: 2 },
      },
      // Risk-reward: commit early and attack it for ×3 (more than you can arm), or take the safe +5.
      {
        type: 'gates',
        at: 0.64,
        left: { op: 'add', value: 5 },
        right: { op: 'subtract', value: 10, flip: { op: 'multiply', value: 3, hp: 120 } },
      },
      { type: 'enemies', at: 0.82, enemy: 'bandit', count: 19 },
      { type: 'wall', at: 1, hp: 24 },
    ],
    rewards: { xpPerEnemy: 10, xpPerSurvivor: 5 },
  },
] satisfies GameDataInput['levels'];
