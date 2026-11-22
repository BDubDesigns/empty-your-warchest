import type { GameDataInput } from './schema';

export const tuning = {
  // RuneScape's constants: level 2 at 83 XP, level 99 at 13,034,431 XP.
  xpCurve: { maxLevel: 99, base: 300, doublingLevels: 7, divisor: 4 },
  idle: { capMinutes: 30 },
  // Attack Run: "you recover about half of the thrown spears".
  weaponRecoveryOnWin: { poor: 0.5, good: 0.5, perfect: 0.5 },
} satisfies GameDataInput['tuning'];
