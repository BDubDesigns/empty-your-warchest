import type { GameDataInput } from './schema';

// The test skirmish, as a template rolled fresh each run (decided Nov 25). You always start with
// one guy and grow through gates. Rolls with `perLevel` grow with Command level, so a higher level
// means bigger gates and bigger enemy groups, never a bigger start. Gates are decisions, not tests:
// a clear gate, or a bigger one you fight through guards for, with the sides swapped at random.
// Every fight is paid for in spearmen, and extra bodies are only worth what you can arm. All numbers
// are first guesses, tuned in data.
export const levels = [
  {
    id: 'skirmish_1',
    name: 'Bandit camp',
    kind: 'skirmish',
    durationSeconds: 30,
    unit: 'spearman',
    startingRecruits: 1,
    events: [
      // The first recruits: a few for free, or more behind unarmed guards (a spear beats them).
      {
        type: 'gates',
        at: 0.08,
        left: { op: 'add', value: { min: 3, perLevel: 0.3 } },
        right: {
          op: 'add',
          value: { min: 6, perLevel: 0.5 },
          guards: { enemy: 'bandit', count: { min: 2, perLevel: 0.2 }, armedShare: 0 },
        },
      },
      // A warm-up: mostly unarmed, so spearmen tear through them.
      {
        type: 'enemies',
        at: 0.22,
        enemy: 'bandit',
        count: { min: 4, perLevel: 0.4 },
        armedShare: 0.25,
      },
      {
        type: 'gates',
        at: 0.38,
        left: { op: 'add', value: { min: 4, perLevel: 0.5 } },
        right: {
          op: 'multiply',
          value: 2,
          guards: { enemy: 'bandit', count: { min: 3, perLevel: 0.3 }, armedShare: 0 },
        },
      },
      {
        type: 'gates',
        at: 0.55,
        left: { op: 'add', value: { min: 6, perLevel: 0.6 } },
        right: {
          op: 'multiply',
          value: 3,
          guards: { enemy: 'bandit', count: { min: 4, perLevel: 0.4 }, armedShare: 0.5 },
        },
      },
      // The real test: mostly armed.
      {
        type: 'enemies',
        at: 0.78,
        enemy: 'bandit',
        count: { min: 10, perLevel: 1 },
        armedShare: 0.5,
      },
      {
        type: 'wall',
        at: 1,
        hp: { min: 40, perLevel: 4 },
        archers: { volleySeconds: 1.2, perVolley: 2 },
      },
    ],
    rewards: { xpPerEnemy: 10, xpPerSurvivor: 5 },
  },
] satisfies GameDataInput['levels'];
