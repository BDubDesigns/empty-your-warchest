import type { GameDataInput } from './schema';

// The castle the siege will be fought at (Siege 2.0), built from the Quaternius kits: a curtain
// wall with a walk and battlements round a courtyard, four round corner towers, a gatehouse, a
// three-storey keep whose windows the captain shows at, an alarm bell, and a spear rack. Shown on
// its own in Debug → Castle preview until the siege moves onto it. Metres; the gate faces +z, toward
// the player. Looks and sizes here are first guesses, tuned by eye from the preview.

export const castle = {
  kit: 'models/castle/kit.glb',
  grid: 2,
  wall: {
    height: 7,
    thickness: 3,
    parapet: { height: 1, thickness: 0.6 },
    merlon: { width: 1.1, height: 1, gap: 0.8 },
    plinth: { height: 0.9, out: 0.25 },
    course: { height: 0.3, out: 0.12 },
    chunks: { length: 3.8, rows: 2 },
  },
  // The ring, round the courtyard: the back corners have tile roofs (lookouts); the front ones
  // are open on top, with battlements, as is the gatehouse.
  towers: [
    { id: 'north_west', shape: 'round', at: [-18, -16], size: 3.5, height: 11, top: 'roof' },
    { id: 'north_east', shape: 'round', at: [18, -16], size: 3.5, height: 11, top: 'roof' },
    { id: 'south_east', shape: 'round', at: [18, 16], size: 3.5, height: 10, top: 'battlements' },
    {
      id: 'gatehouse',
      shape: 'square',
      at: [0, 16],
      size: 4.5,
      depth: 4,
      height: 10,
      top: 'battlements',
      gate: { width: 3.4, height: 4.6 },
      // The gatehouse's stonework stays whole: a fixed point the siege can't knock down.
      solid: true,
    },
    { id: 'south_west', shape: 'round', at: [-18, 16], size: 3.5, height: 10, top: 'battlements' },
  ],
  towerChunks: { sectors: 6, rows: 3 },
  walls: [
    { id: 'north', from: 'north_west', to: 'north_east' },
    { id: 'east', from: 'north_east', to: 'south_east' },
    { id: 'front_right', from: 'south_east', to: 'gatehouse' },
    { id: 'front_left', from: 'gatehouse', to: 'south_west' },
    { id: 'west', from: 'south_west', to: 'north_west' },
  ],
  module: 2,
  storey: 3,
  windowMiddle: 1.85,
  facadePieces: {
    '-': [{ node: 'Wall_UnevenBrick_Straight' }],
    t: [{ node: 'Wall_UnevenBrick_Window_Thin_Round' }, { node: 'Window_Thin_Round1' }],
    w: [{ node: 'Wall_UnevenBrick_Window_Wide_Round' }, { node: 'Window_Wide_Round1' }],
    d: [
      { node: 'Wall_UnevenBrick_Door_Round' },
      { node: 'Door_4_Round', offset: [-0.52, 0, -0.05] },
    ],
  },
  roof: {
    piece: { node: 'Roof_RoundTiles_8x12', turn: 90 },
    gable: { node: 'Roof_Front_Brick8' },
    overhang: 0.6,
  },
  towerRoof: { piece: { node: 'Roof_Tower_RoundTiles' }, overhang: 0.5 },
  quoin: 0.55,
  details: {
    towerSides: 20,
    corbel: { out: 0.3, height: 0.5 },
    cap: { height: 0.1, out: 0.05 },
    slit: [0.16, 1.1, 0.24],
    doorway: [1.1, 2.1],
    archTrim: { width: 0.45, proud: 0.12 },
    gateSetBack: 1.1,
    straps: [0.7, 1.9, 3.1],
  },
  buildings: [
    {
      id: 'keep',
      name: 'Keep',
      at: [0, -8],
      modules: [5, 4],
      storeys: 3,
      facades: {
        front: ['t-d-t', '-w-w-', 'tw-wt'],
        back: ['-t-t-', '-t-t-', '-t-t-'],
        left: ['-tt-', 't--t', '-ww-'],
        right: ['-tt-', 't--t', '-ww-'],
      },
    },
  ],
  pieces: {
    weapon_stand: [{ node: 'WeaponStand' }],
    barrel: [{ node: 'Barrel' }],
    crate: [{ node: 'Crate_Wooden' }],
    wagon: [{ node: 'Prop_Wagon' }],
    vine_1: [{ node: 'Prop_Vine1' }],
    vine_2: [{ node: 'Prop_Vine2' }],
    vine_3: [{ node: 'Prop_Vine3' }],
    banner: [{ node: 'Banner_1' }],
    torch: [{ node: 'Torch_Metal' }],
  },
  props: [
    { id: 'spear_rack', piece: 'weapon_stand', at: [6.5, 0.5], turn: -15 },
    { id: 'barrel_1', piece: 'barrel', at: [-7.5, 9.5] },
    { id: 'barrel_2', piece: 'barrel', at: [-8.3, 10.2] },
    { id: 'crate_1', piece: 'crate', at: [-6.6, 10.4], turn: 15 },
    { id: 'wagon', piece: 'wagon', at: [11, -3], turn: 160 },
  ],
  bell: { id: 'alarm_bell', at: [-11, -7], turn: 90, size: [2.8, 3.8], bell: 1.1 },
  stairs: [{ id: 'west_stair', wall: 'west', start: 10, run: 10, width: 1.8 }],
  stairRise: 0.35,
  anchors: {
    captainWindows: [
      { building: 'keep', side: 'front', storey: 2, module: 1 },
      { building: 'keep', side: 'front', storey: 2, module: 3 },
      { building: 'keep', side: 'front', storey: 1, module: 1 },
      { building: 'keep', side: 'front', storey: 1, module: 3 },
      { building: 'keep', side: 'left', storey: 2, module: 1 },
      { building: 'keep', side: 'right', storey: 2, module: 2 },
    ],
    spearRack: 'spear_rack',
    guardPaths: [
      {
        id: 'front_left_walk',
        loop: false,
        points: [
          { walk: 'front_left', at: 5.5 },
          { walk: 'front_left', at: 13 },
        ],
      },
      {
        id: 'front_right_walk',
        loop: false,
        points: [
          { walk: 'front_right', at: 5 },
          { walk: 'front_right', at: 12.5 },
        ],
      },
      {
        id: 'west_climb',
        loop: false,
        points: [{ ground: [-12, 9] }, { stair: 'west_stair' }, { walk: 'west', at: 27 }],
      },
      {
        id: 'round_the_keep',
        loop: true,
        points: [
          { ground: [-8, -1.5] },
          { ground: [8, -1.5] },
          { ground: [8, -13.3] },
          { ground: [-8, -13.3] },
        ],
      },
    ],
  },
  vantages: [
    { id: 'hill', name: 'Hill', at: [-28, 24, 54], look: [0, 2, -3], fov: 50 },
    { id: 'low', name: 'Low ground', at: [9, 1.7, 40], look: [-2, 5, 8], fov: 55 },
    { id: 'tower', name: 'Siege tower', at: [40, 16, 4], look: [-4, 2, -6], fov: 50 },
  ],
  skins: {
    wall: { material: 'MI_Brick', tile: 3 },
    tower: { material: 'MI_Brick', tile: 3 },
    trim: { material: 'MI_RockTrim', tile: 2, band: [0.31, 0.55] },
    cap: { material: 'MI_RockTrim', tile: 2, band: [0.31, 0.55] },
    walk: { material: 'MI_Brick', tile: 2.5 },
    courtyard: { material: 'MI_RoundRocks', tile: 3 },
    timber: { material: 'MI_WoodTrim', tile: 3, band: [0.02, 0.27] },
  },
  dressing: [],
  vines: { seed: 5, count: 14, pieces: ['vine_1', 'vine_2', 'vine_3'] },
  colors: {
    inside: '#1b1510',
    bell: '#a67c3c',
    sky: '#a9c6dc',
    skyLight: '#eef4ff',
    groundLight: '#4a5a32',
    sun: '#fff0d8',
  },
  scene: {
    fog: [90, 260],
    hemisphere: 1.35,
    sun: { intensity: 2, from: [30, 55, 40] },
    shadowMap: { size: 1024, halfWidth: 30, far: 160, bias: -0.0005 },
    ground: 320,
    road: { width: 7, length: 70 },
    yard: 'troddenDirt',
    trees: { seed: 7, near: 42, far: 120, height: [6, 10] },
  },
  tiers: {
    // About 29 MB of colour maps: the big stone and roof surfaces sharp, small things smaller.
    high: {
      shadows: true,
      textureSize: 512,
      textureSizes: {
        'T_Brick_BaseColor.jpg': 1024,
        'T_RockTrim_BaseColor.jpg': 1024,
        'T_UnevenBrick_BaseColor.jpg': 1024,
        'T_RoundTiles_BaseColor.jpg': 1024,
        'T_MetalOrnaments_BaseColor.jpg': 256,
        'T_VineLeaf.png': 256,
        'T_Trim_Cloth_BaseColor.jpg': 256,
        'T_Trim_Furniture_BaseColor.jpg': 256,
        'T_Trim_Metal_BaseColor.jpg': 256,
        'T_Trim_Props_BaseColor.jpg': 256,
      },
      trees: { model: 'models/quaternius/CommonTree_3.gltf', count: 40 },
    },
    // About 12 MB, and no shadow map (the A15 lost half its 5% low fps to real shadows).
    low: {
      shadows: false,
      textureSize: 512,
      textureSizes: {
        'T_MetalOrnaments_BaseColor.jpg': 256,
        'T_VineLeaf.png': 256,
        'T_Trim_Cloth_BaseColor.jpg': 256,
        'T_Trim_Furniture_BaseColor.jpg': 256,
        'T_Trim_Metal_BaseColor.jpg': 256,
        'T_Trim_Props_BaseColor.jpg': 256,
      },
      trees: { model: 'models/kenney/tree_default.glb', count: 60 },
    },
  },
  preview: {
    target: [0, 4, 0],
    yaw: 32,
    pitch: { start: 26, min: 4, max: 82 },
    distance: { start: 86, min: 18, max: 150 },
    fov: 50,
    dragDegrees: 240,
    zoomStep: 1.12,
    flySeconds: 0.9,
  },
} satisfies GameDataInput['castle'];
