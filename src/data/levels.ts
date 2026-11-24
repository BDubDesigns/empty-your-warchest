import type { GameDataInput } from './schema';

// The M7a test skirmish. Gates are decisions, not tests (decided Nov 24): after one obvious
// teaching pair, each choice is safe vs greedy. Counts, hit points and timings are first guesses,
// tuned in data.
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
        at: 0.1,
        left: { op: 'add', value: 10 },
        right: { op: 'subtract', value: 3 },
      },
      // A warm-up: mostly unarmed, so spearmen tear through them.
      { type: 'enemies', at: 0.26, enemy: 'bandit', count: 8, armed: 2 },
      // Safe vs greedy, twice, each riskier than the last: fight through the guards for a bigger gate,
      // or take the clear one. Every fight is paid for in spearmen, and the extra bodies are only
      // worth what you can arm.
      {
        type: 'gates',
        at: 0.49,
        left: { op: 'add', value: 10 },
        right: { op: 'multiply', value: 2, guards: { enemy: 'bandit', count: 3, armed: 1 } },
      },
      {
        type: 'gates',
        at: 0.65,
        left: { op: 'add', value: 5 },
        right: { op: 'multiply', value: 3, guards: { enemy: 'bandit', count: 6, armed: 5 } },
      },
      // The real test: mostly armed.
      { type: 'enemies', at: 0.82, enemy: 'bandit', count: 22, armed: 13 },
      { type: 'wall', at: 1, hp: 120, archers: { volleySeconds: 1.2, perVolley: 2 } },
    ],
    rewards: { xpPerEnemy: 10, xpPerSurvivor: 5 },
  },
] satisfies GameDataInput['levels'];
