import type { GameDataInput } from './schema';

// Fire-hardening (M5a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const firemaking = {
  recipe: 'harden_spear',
  fuel: 'log',
  // The starting setup (Brandon, Nov 24): 3 spots under 6 staves, 2 logs a spot.
  rack: { staves: 6, spots: 3, maxLogs: 2 },
  stars: { twoMissed: 2 },
  generator: {
    flat: 10,
    // A bit lumpy: a few logs' worth taken off, so a fire needs 2–4 logs to even out.
    answerLogs: { min: 2, max: 4 },
    noise: 0.3,
    minHeat: 3,
    // The answer's pull window is at least this long (seconds): readable, not a twitch test.
    minWindow: 0.8,
    tries: 40,
  },
  yard: { radius: 2.6, wear: 0.7 },
  feel: {
    heatPerLog: 2.5,
    spill: 1,
    cookSeconds: 5,
    charRatio: 1.3,
    smokeWisps: 0.45,
    smokeThick: 0.75,
    streakCap: 3,
    grabPx: 70,
    dragPx: 40,
    pullSeconds: 0.45,
    plungeSeconds: 0.9,
    pourDelaySeconds: 0.5,
    hitStopMs: 60,
    shakeStrength: 1,
    buzzLogMs: 15,
    buzzLayMs: 25,
    buzzPullMs: 30,
    buzzPlungeMs: 45,
  },
} satisfies GameDataInput['firemaking'];
