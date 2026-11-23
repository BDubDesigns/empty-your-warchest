import type { GameDataInput } from './schema';

// How deposits pour into the warchest in the HUD. Feel numbers, first guesses.
export const warchest = {
  pour: {
    maxPieces: 20,
    stagger: 0.05,
    popSeconds: 0.22,
    flightSeconds: 0.6,
    arcHeight: 0.35,
    closeDelay: 0.3,
  },
} satisfies GameDataInput['warchest'];
