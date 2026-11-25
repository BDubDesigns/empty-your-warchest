import type { GameDataInput } from './schema';

// Fire-hardening (M5a feel prototype). All numbers are first guesses, meant to be tuned on a phone.
export const firemaking = {
  recipe: 'harden_spear',
  fuel: 'log',
  // The starting setup (Brandon, Nov 24): 3 spots under 6 staves, 2 logs a spot. Then a spot and
  // 2 staves more every 5 levels up to 9 spots (18 staves) at 30 (Brandon, Nov 25); past 30 the
  // puzzle grows other ways (other woods). Bigger fires take more logs to even out.
  rack: {
    stavesPerSpot: 2,
    maxLogs: 2,
    sizes: [
      { spots: 3, level: 1, answerLogs: { min: 2, max: 4 } },
      { spots: 4, level: 5, answerLogs: { min: 2, max: 5 } },
      { spots: 5, level: 10, answerLogs: { min: 3, max: 6 } },
      { spots: 6, level: 15, answerLogs: { min: 3, max: 7 } },
      { spots: 7, level: 20, answerLogs: { min: 4, max: 8 } },
      { spots: 8, level: 25, answerLogs: { min: 4, max: 9 } },
      { spots: 9, level: 30, answerLogs: { min: 5, max: 10 } },
    ],
  },
  // Up to a third of a layer missed is still 2 stars (2 of the starting 6).
  stars: { twoMissedShare: 0.34 },
  // The same as woodcutting's and splitting's.
  starBonus: { two: 0.1, three: 0.25 },
  generator: {
    flat: 10,
    noise: 0.3,
    minHeat: 3,
    // The answer's pull window is at least this long (seconds): readable, not a twitch test.
    minWindow: 0.8,
    tries: 40,
    // 3^6 = 729 fuelings to search; 9 spots would be 19,683 every rack.
    searchSpots: 6,
  },
  yard: { radius: 2.6, wear: 0.7 },
  feel: {
    heatPerLog: 2.5,
    spill: 1,
    cookSeconds: 5,
    // Playtest 1 (Nov 25): 1.3 was a 1.25 s window at an even fire, too tight to read; 1.4 is
    // about 2 s. Smoke started at 45% done, so "it's smoking" didn't mean "nearly ready".
    charRatio: 1.4,
    smokeWisps: 0.75,
    smokeThick: 0.9,
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
    buzzCharMs: 45,
    buzzPullMs: 30,
    buzzPlungeMs: 45,
  },
} satisfies GameDataInput['firemaking'];
