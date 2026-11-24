import type { GameDataInput } from './schema';

// Riving's feel prototype (M4a): three hand-made logs, each teaching one idea. All numbers are
// first guesses, meant to be tuned on a phone.
export const riving = {
  recipe: 'rive_stave',
  // Log → 2 → 4 → 8 staves.
  halvings: 3,
  minStaveDegrees: 25,
  checkTolerance: 8,
  logs: [
    // Nothing in the way: learn aim, strike and lever.
    {
      id: 'straight_log',
      name: 'Straight log',
      radius: 1,
      height: 1.7,
      rings: 14,
      checks: [],
      knots: [],
    },
    // A check across the log: split along it and the crack runs easier.
    {
      id: 'checked_log',
      name: 'Checked log',
      radius: 1.05,
      height: 1.6,
      rings: 17,
      checks: [100, 280, 190],
      knots: [],
    },
    // Two knots close together: only lines at about 29° + 45° steps keep both in one stave
    // (aim straight across at 0° and the 45° line runs through the first knot).
    {
      id: 'knotty_log',
      name: 'Knotty log',
      radius: 0.95,
      height: 1.7,
      rings: 15,
      checks: [],
      knots: [
        { angle: 40, width: 18 },
        { angle: 66, width: 12 },
      ],
    },
  ],
  feel: {
    fineAimStep: 1,
    strikeSeconds: 0.18,
    hitStopMs: 60,
    shakeStrength: 1,
    leverTravel: 220,
    bandLow: 0.5,
    bandHigh: 1.4,
    bindSeconds: 0.7,
    speedWindow: 0.15,
    strainRise: 3,
    strainRecover: 1.2,
    checkEase: 0.4,
    pieceSeconds: 0.35,
    buzzStrikeMs: 18,
    buzzCrackMs: 6,
    buzzCleanMs: 14,
    buzzRunoutMs: 40,
  },
} satisfies GameDataInput['riving'];
