import type { GameDataInput } from './schema';

// Feel prototype: one hand-made clearing. All numbers are first guesses,
// meant to be tuned live from the debug menu on a phone.
export const woodcutting = {
  recipe: 'fell_tree',
  chainExponent: 2,
  clearings: [
    {
      id: 'first_clearing',
      width: 360,
      height: 640,
      canopyRadius: 18,
      trees: [
        // A diagonal run that chains when aimed down-right.
        { id: 'a1', x: 70, y: 110, height: 100 },
        { id: 'a2', x: 140, y: 170, height: 100 },
        { id: 'a3', x: 210, y: 230, height: 100 },
        { id: 'a4', x: 280, y: 290, height: 90 },
        // A column along the left edge.
        { id: 'b1', x: 60, y: 300, height: 110 },
        { id: 'b2', x: 60, y: 400, height: 110 },
        { id: 'b3', x: 65, y: 505, height: 100 },
        // A loose cluster to find a line through.
        // Forked: falls as two trunks fanning out.
        { id: 'c1', x: 180, y: 380, height: 120, forks: [-25, 25] },
        { id: 'c2', x: 250, y: 430, height: 100 },
        { id: 'c3', x: 300, y: 520, height: 100 },
        { id: 'c4', x: 170, y: 560, height: 100 },
        // Loners.
        { id: 'd1', x: 290, y: 120, height: 110, forks: [-30, 30] },
        { id: 'd2', x: 170, y: 300, height: 90 },
        { id: 'd3', x: 300, y: 610, height: 90 },
      ],
    },
  ],
  feel: {
    meterSpeed: 1.1,
    timingWindow: 0.46,
    perfectWindow: 0.06,
    perfectWindowLight: 0.18,
    swingSeconds: 0.12,
    goodScatter: 8,
    glancingScatter: 20,
    chopPoints: 6,
    fullPullPoints: 3,
    perfectBonus: 1,
    fineAimStep: 1,
    fallSeconds: 0.9,
    fallEase: 2.5,
    chainDelay: 0.12,
    shakeStrength: 1,
    hitStopMs: 70,
  },
} satisfies GameDataInput['woodcutting'];
