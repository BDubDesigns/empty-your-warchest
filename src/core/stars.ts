/** Bonus shares for 2 and 3 stars (none for 1), as every station has in its data. */
export interface StarBonus {
  two: number;
  three: number;
}

/** The share of what a round earned that its stars add on top: none below 2 stars. */
export function starBonusShare(stars: number, bonus: StarBonus): number {
  return stars >= 3 ? bonus.three : stars === 2 ? bonus.two : 0;
}

/** The star bonus on `amount` (logs, spears, XP …) for `stars`, rounded. The rule at every station. */
export function starBonus(amount: number, stars: number, bonus: StarBonus): number {
  return Math.round(amount * starBonusShare(stars, bonus));
}
