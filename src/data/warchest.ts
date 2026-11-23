import type { GameDataInput } from './schema';

// How deposits pour into the warchest in the HUD. Feel numbers: halved in speed after the
// first phone test (it was too fast to enjoy).
export const warchest = {
  pour: {
    maxPieces: 20,
    stagger: 0.1,
    popSeconds: 0.44,
    flightSeconds: 1.2,
    arcHeight: 0.35,
    closeDelay: 0.6,
  },
  haptics: { openMs: 12, slamMs: 8 },
} satisfies GameDataInput['warchest'];
