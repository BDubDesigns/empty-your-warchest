/**
 * A hot streak's depth after a round: a top result (`hit`) adds a layer up to `cap`; anything less
 * drops `drop` layers, never below 1. Shared by every mini game with a streak.
 */
export function nextStreak(layers: number, hit: boolean, cap: number, drop: number): number {
  return hit ? Math.min(layers + 1, Math.max(cap, 1)) : Math.max(layers - drop, 1);
}
