import type { GameDataInput } from './schema';

// The siege's guards (five looks) and its captain, from the Quaternius Source kits
// (tools/characters/build.py), shown in Debug → Character preview too. Each model is only a look:
// the siege sizes it to its rules' box. Looks here are first guesses, tuned by eye from the preview.

/** A guard's look: its GLB on each tier, its colour maps, and the guards' triangle budget. */
function guard(id: string, name: string, maps: string[]) {
  return {
    id,
    name,
    files: {
      high: `models/characters/${id}-high.glb`,
      low: `models/characters/${id}-low.glb`,
    },
    maps,
    triangles: { high: 5000, low: 2500 },
    turn: 0,
  };
}

export const characters = {
  clipFile: 'models/characters/clips.glb',
  // From the Universal Animation Library (1 and 2), without root motion: they play in place.
  clips: [
    { id: 'idle', label: 'Idle', play: 'loop' },
    { id: 'walk', label: 'Walk', play: 'loop' },
    { id: 'run', label: 'Run', play: 'loop' },
    { id: 'cower', label: 'Cower', play: 'loop' },
    // Leaning on a rail and calling out: a guard raising the alarm, the captain at his window.
    { id: 'alarm', label: 'Alarm', play: 'loop' },
    { id: 'lean', label: 'Lean', play: 'loop' },
    { id: 'hit', label: 'Hit', play: 'once' },
    { id: 'die', label: 'Die', play: 'hold' },
  ],
  idleClip: 'idle',
  fadeSeconds: 0.2,
  models: [
    // The guards' five looks, all on the knight's two guard maps (the red colourway and the dark
    // one), the bare head on the heads' map besides. The man's tabard (red, a gold cross) over his
    // arm and leg armour, a closed armet, spiked pauldrons and the red scarf.
    guard('guard', 'Guard (armet)', ['guard']),
    // The dark tabard, the horned helmet, round pauldrons, no scarf.
    guard('guard_horns', 'Guard (horns)', ['guard_dark']),
    // The red tabard, bare headed (brown buzzed hair and a beard), round pauldrons, the scarf.
    guard('guard_bare', 'Guard (bare head)', ['guard', 'heads']),
    // The woman's outfit: the dark tabard, a closed armet, spiked pauldrons, the scarf.
    guard('guard_woman', 'Guard (woman, armet)', ['guard_dark']),
    // The woman's steel plate (in the red colourway), the horned helmet, round pauldrons.
    guard('guard_woman_plate', 'Guard (woman, plate)', ['guard']),
    // The knight's full plate in gold (that colourway his alone), bare headed: grey hair, a beard.
    {
      id: 'captain',
      name: 'Captain',
      files: {
        high: 'models/characters/captain-high.glb',
        low: 'models/characters/captain-low.glb',
      },
      maps: ['captain', 'heads'],
      triangles: { high: 8000, low: 5000 },
      turn: 0,
    },
  ],
  // The siege's guards wear these (each guard's look picked from the round's seed).
  guards: ['guard', 'guard_horns', 'guard_bare', 'guard_woman', 'guard_woman_plate'],
  // The knight's body through the idle clip (the build measures it; every look the same, as the
  // woman's outfit is scaled to the man's hip height), without what only decorates it (horns,
  // pauldrons, scarf, hair): across his trunk, arms and head; his height to the armet's top; deep.
  body: [0.73, 1.81, 0.56],
  tiers: {
    // About 17 MB of colour maps: the two guard maps, the captain's and the heads'.
    high: {
      textureSizes: { guard: 1024, guard_dark: 1024, captain: 1024, heads: 512 },
      shadows: true,
      maxTextureMB: 18,
    },
    // About 4.3 MB, and no shadow map (as the siege's and the castle's Low).
    low: {
      textureSizes: { guard: 512, guard_dark: 512, captain: 512, heads: 256 },
      shadows: false,
      maxTextureMB: 4.5,
    },
  },
  // The kit's skeleton without its twelve leaf bones (finger and toe tips).
  maxBones: 53,
  preview: {
    spacing: 1.1,
    ground: 40,
    orbit: {
      target: [0, 1, 0],
      yaw: 20,
      pitch: { start: 8, min: -5, max: 80 },
      distance: { start: 6.5, min: 1.2, max: 24 },
    },
    fov: 45,
    dragDegrees: 240,
    zoomStep: 1.12,
    // About as many guards as the siege shows at once.
    // The guards' looks in turn.
    crowd: {
      count: 12,
      columns: 3,
      spacing: 1.5,
      distance: 15,
      pitch: 22,
      clips: ['idle', 'walk', 'run', 'cower', 'alarm', 'lean'],
    },
    frames: 60,
    colors: {
      sky: '#a9c6dc',
      ground: '#5f6b45',
      skyLight: '#eef4ff',
      groundLight: '#4a5a32',
      sun: '#fff0d8',
    },
    light: {
      hemisphere: 1.35,
      sun: 2,
      from: [4, 8, 6],
      shadowMap: { size: 1024, halfWidth: 6, far: 30, bias: -0.0005 },
    },
  },
} satisfies GameDataInput['characters'];
