import type { GameDataInput } from './schema';

// The Attack Run (M7a feel prototype). Every number is a first guess, meant to be tuned on a phone.
export const runner = {
  level: 'skirmish_1',
  trackWidth: 8,
  trackMetersPerSecond: 10,
  edgeMargin: 0.6,
  clash: {
    // A Poor spear sometimes dies without taking its bandit; unarmed recruits mostly soak hits.
    killChance: { poor: 0.75, good: 1, perfect: 1 },
    unarmedKillChance: 0.3,
    // Spear quality shows in the trade: a Perfect spear sometimes takes out two.
    doubleChance: { poor: 0, good: 0, perfect: 0.35 },
  },
  feel: {
    runSpeed: 10,
    steerSpeed: 30,
    steerSmoothing: 0.08,
    dragScale: 1.4,
    crowdSpread: 0.32,
    edgeLag: 0.6,
    tradeSeconds: 0.16,
    tradeSpeedup: 0.95,
    tradeMinSeconds: 0.03,
    wallHitSeconds: 0.12,
    flipAttackRate: 0.5,
    flipRange: 45,
    gateReadSeconds: 2.2,
    cameraAngle: 48,
    cameraDistance: 17,
    cameraPullback: 1.5,
    spearsPoor: 5,
    spearsGood: 15,
    spearsPerfect: 5,
    slowMoScale: 0.25,
    slowMoSeconds: 0.6,
    buzzGoodGateMs: 25,
    buzzBadGateMs: 60,
    buzzFlipMs: 40,
    buzzTradeMs: 6,
    buzzWallHitMs: 10,
    buzzWallBreakMs: 120,
    buzzLoseMs: 80,
  },
} satisfies GameDataInput['runner'];
