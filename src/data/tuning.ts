import type { GameDataInput } from './schema';

export const tuning = {
  // RuneScape's constants: level 2 at 83 XP, level 99 at 13,034,431 XP.
  xpCurve: { maxLevel: 99, base: 300, doublingLevels: 7, divisor: 4 },
  // Attack Run: "you recover about half of the thrown spears".
  weaponRecoveryOnWin: 0.5,
} satisfies GameDataInput['tuning'];
