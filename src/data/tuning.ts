import type { GameDataInput } from './schema';

export const tuning = {
  // RuneScape's constants: level 2 at 83 XP, level 99 at 13,034,431 XP.
  xpCurve: { maxLevel: 99, base: 300, doublingLevels: 7, divisor: 4 },
  idle: { capMinutes: 30 },
  // Attack Run: "you recover about half of the thrown spears".
  weaponRecoveryOnWin: 0.5,
  // Guesses, to tune from `screen.load` / `screen.preload` in phone logs. A loading card that pops
  // up and vanishes at once reads as a flicker, so it only shows once a station is clearly slow.
  screens: { preloadIdleTimeoutMs: 1000, loadingCardDelayMs: 250 },
} satisfies GameDataInput['tuning'];
