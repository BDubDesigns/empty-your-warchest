import type { GameDataInput } from './schema';

// The siege's guards and captain, from the Quaternius Source kits (tools/characters/build.py). Shown
// in Debug → Character preview until the siege moves onto them. Each model is only a look: the
// siege sizes it to its rules' box. Looks here are first guesses, tuned by eye from the preview.

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
    // The knight's tabard over his arm and leg armour, a closed armet, spiked pauldrons.
    {
      id: 'guard',
      name: 'Guard',
      files: { high: 'models/characters/guard-high.glb', low: 'models/characters/guard-low.glb' },
      maps: ['guard'],
      triangles: { high: 5000, low: 2500 },
      turn: 0,
    },
    // The knight's full plate in gold, bare headed: grey hair and a beard.
    {
      id: 'captain',
      name: 'Captain',
      files: {
        high: 'models/characters/captain-high.glb',
        low: 'models/characters/captain-low.glb',
      },
      maps: ['captain', 'captain_head'],
      triangles: { high: 8000, low: 5000 },
      turn: 0,
    },
  ],
  tiers: {
    // About 12 MB of colour maps for both.
    high: {
      textureSizes: { guard: 1024, captain: 1024, captain_head: 512 },
      shadows: true,
      maxTextureMB: 13,
    },
    // About 3 MB, and no shadow map (as the siege's and the castle's Low).
    low: {
      textureSizes: { guard: 512, captain: 512, captain_head: 256 },
      shadows: false,
      maxTextureMB: 4,
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
    crowd: {
      model: 'guard',
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
