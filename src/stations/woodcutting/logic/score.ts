/** Logs a chain of `trees` is worth: trees^exponent, as a whole number (at least 1). */
export function chainLogs(trees: number, exponent: number): number {
  return Math.max(1, Math.round(trees ** exponent));
}

/** Shares of par a round's logs need for two and three stars. */
export interface StarThresholds {
  two: number;
  three: number;
}

/** Bonus logs as a share of the round's logs, for 2 and 3 stars (none for 1). */
export interface StarBonus {
  two: number;
  three: number;
}

/** The star bonus for a round that ended with `logs` and `stars`: rounded, 0 below 2 stars. */
export function starBonusLogs(logs: number, stars: number, bonus: StarBonus): number {
  const share = stars >= 3 ? bonus.three : stars === 2 ? bonus.two : 0;
  return Math.round(logs * share);
}

/** 0–3 stars for a round's logs against par: 1 for any banked chain, more for nearing par. */
export function starsFor(logs: number, par: number, thresholds: StarThresholds): number {
  if (logs <= 0) return 0;
  const share = par > 0 ? logs / par : 1;
  if (share >= thresholds.three) return 3;
  if (share >= thresholds.two) return 2;
  return 1;
}
