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
      // Safe vs greedy: a clear +10, or fight through a few bandits for ×3. ×3 mostly adds unarmed men
      // unless you brought spare spears: a gate is only worth what you can arm.
      { type: 'enemies', at: 0.45, enemy: 'bandit', count: 4, armed: 1, lane: 'right' },
      {
        type: 'gates',
        at: 0.49,
        left: { op: 'add', value: 10 },
        right: { op: 'multiply', value: 3 },
      },
      // Risk-reward: commit early and cut down its guards for ×3 (more than you can arm), or take the
      // safe +5.
      {
        type: 'gates',
        at: 0.65,
        left: { op: 'add', value: 5 },
        right: {
          op: 'subtract',
          value: 10,
          flip: { op: 'multiply', value: 3, hp: 120, guards: 5 },
        },
      },
      // The real test: mostly armed.
      { type: 'enemies', at: 0.82, enemy: 'bandit', count: 18, armed: 10 },
      { type: 'wall', at: 1, hp: 120, archers: { volleySeconds: 1.2, perVolley: 2 } },
    ],
    rewards: { xpPerEnemy: 10, xpPerSurvivor: 5 },
  },
] satisfies GameDataInput['levels'];
