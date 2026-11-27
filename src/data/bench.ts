import { z } from 'zod';

// The graphics stress test ("bench", Debug → Stress test): the same siege-like scene built from
// each candidate art pack, flown through on a fixed camera path while it measures what each costs.
// Not part of the game: its data is validated when the bench opens (and by the unit tests), so a
// mistake here can never stop the game from starting. Metres and seconds; the fort's front faces +z,
// toward the ballista's sights, as in the siege.

const name = z.string().min(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();
const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** The parts of a scene every pack draws its own way. */
export const benchRoles = [
  'wall',
  'wallWindow',
  'gate',
  'corner',
  'towerBase',
  'towerWall',
  'towerRoof',
  'houseWall',
  'houseWindow',
  'houseDoor',
  'houseRoof',
  'chimney',
  'crate',
] as const;
export type BenchRole = (typeof benchRoles)[number];

/** How a building is put together: walls round its edge each storey, or one block per storey. */
const buildingShape = z.enum(['ring', 'stack']);

const pieceSchema = z.object({
  /** Nodes in the pack's pieces file, placed together (a wall and the window frame in its hole). */
  nodes: z.array(name).min(1),
  /** Turn (radians) that lays the piece along x with its outside facing +z. */
  turn: z.number().default(0),
  /** How far it sinks into what it stands on, as a share of its own height (a roof's eaves). */
  sink: z.number().min(0).max(1).default(0),
});

const propSchema = z.object({
  nodes: z.array(name).min(1),
  turn: z.number().default(0),
  /** How wide (m) each copy is drawn, across its longer side. */
  width: positive,
  count: positiveInt,
});

const modelSchema = z.object({
  /** A glTF/GLB file under public/. */
  url: name,
  /** One node of it, or (left out) all of it. */
  node: name.optional(),
});

const characterSchema = z.object({
  url: name,
  /** The idle and walk clips' names, in this file or the pack's animations file. */
  idle: name,
  walk: name,
});

const packSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name,
    /** One line on what it is, shown with the results. */
    about: name,
    /** Boxes are built in code (what the siege ships today); models come from `pieces`. */
    kind: z.enum(['boxes', 'models']),
    /** The pack's static pieces, merged into one GLB (one node per piece). */
    pieces: name.optional(),
    /** Image paths rewritten as the pack loads: the heavy variant's full-size textures. */
    textures: z.object({ from: name, to: name }).optional(),
    /**
     * Drawn for speed: the pieces that stand merged into one mesh per material per building, and
     * the ones that come down drawn as instances (one draw call for every copy of a piece).
     */
    batched: z.boolean().default(false),
    /** Matte (Lambert) materials with only their colour maps, always. */
    matte: z.boolean().default(false),
    /** A GLB holding the characters' clips, when they're not in each character's own file. */
    animations: name.optional(),
    roles: z.partialRecord(z.enum(benchRoles), pieceSchema).default({}),
    fort: z.object({ shape: z.literal('ring'), storeys: positiveInt }),
    tower: z.object({ shape: buildingShape, storeys: positiveInt }),
    house: z.object({ shape: buildingShape, storeys: positiveInt }),
    props: z.array(propSchema).default([]),
    trees: z.array(modelSchema).min(1),
    characters: z.array(characterSchema).default([]),
  })
  .superRefine((pack, ctx) => {
    if (pack.kind !== 'models') return;
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    if (!pack.pieces) issue(['pieces'], 'A models pack needs its pieces file');
    if (pack.characters.length === 0) issue(['characters'], 'A models pack needs characters');
    const needed: BenchRole[] = ['wall', 'wallWindow', 'gate', 'corner', 'crate'];
    needed.push(pack.tower.shape === 'stack' ? 'towerBase' : 'towerWall', 'towerRoof');
    needed.push('houseWall', 'houseRoof');
    if (pack.house.shape === 'ring') needed.push('houseWindow', 'houseDoor');
    for (const role of needed) {
      if (!pack.roles[role]) issue(['roles', role], `Missing the "${role}" piece`);
    }
  });

/**
 * The sun's real-time shadows, none, or none but a cheap round blob under each person (the
 * lowest tier a phone might get).
 */
export const benchShadows = ['on', 'off', 'blob'] as const;
export type BenchShadows = (typeof benchShadows)[number];

/** One run in Run all or the quick run. */
const runSchema = z.object({
  pack: name,
  scale: positiveInt,
  shadows: z.enum(benchShadows).default('on'),
  physics: z.boolean().default(true),
  /** Swap every material for a matte (Lambert) one with only its colour map, as the siege uses. */
  matte: z.boolean().default(false),
  /** Shown in the results: why this run is in the set. */
  note: z.string().default(''),
});

/** A ring of walls `wide` × `deep` modules about `at` (x, z). */
const ringSchema = z.object({ at: vec2, wide: positiveInt, deep: positiveInt });

export const benchDataShape = z
  .object({
    /** Seconds each run lasts: the camera path's length. */
    seconds: positive,
    /** Frames drawn (and not counted) before a run starts, once everything is loaded. */
    warmupFrames: positiveInt,
    /** The renderer, as the siege sets it up, so results mean something for the game. */
    renderer: z.object({
      antialias: z.boolean(),
      /** The game's pixel ratio: the device's, capped here. */
      maxPixelRatio: positive,
      shadowMapSize: positiveInt,
      /** The sun's shadow box (m): half its width, half its height, and its depth. */
      shadowHalfWidth: positive,
      shadowHalfHeight: positive,
      shadowFar: positive,
      shadowBias: z.number(),
      /** The sun, from the fort's middle (m). */
      sunFrom: vec3,
      sunIntensity: positive,
      hemisphereIntensity: positive,
      sky: z.number().int().nonnegative(),
      fogNear: positive,
      fogFar: positive,
      fov: positive,
      near: positive,
      far: positive,
    }),
    /** The pixel ratios to pick from: the game's (capped), set ones, and the device's own. */
    pixelRatios: z.array(z.union([z.literal('game'), z.literal('device'), positive])).min(1),
    scales: z.array(positiveInt).min(1),
    layout: z.object({
      /** Every wall piece is drawn this wide (m), whatever the pack's own units. */
      module: positive,
      fort: ringSchema,
      /** The tower stands in the fort's courtyard, `modules` across. */
      tower: z.object({ at: vec2, modules: positiveInt }),
      houses: z.array(ringSchema.extend({ turn: z.number() })).min(1),
      /** Every `windowEvery`th module of an upper storey (and the houses') is a window. */
      windowEvery: positiveInt,
      /** Crates stacked in the courtyard, as many as it takes to reach the collapse's count. */
      crates: z.object({ at: vec2, size: positive, columns: positiveInt, rows: positiveInt }),
      /**
       * Where the props go: an area (x, z min and max), clear of the buildings and of the lane the
       * sights look down (|x| under `lane`).
       */
      props: z.object({ from: vec2, to: vec2, lane: nonNegative }),
      trees: z.object({
        count: positiveInt,
        from: vec2,
        to: vec2,
        /** No trees in here (x, z min and max): the fort, the houses and the field in front. */
        clearFrom: vec2,
        clearTo: vec2,
        minHeight: positive,
        maxHeight: positive,
      }),
      characters: z.object({
        height: positive,
        /** Walking speed (m/s). */
        speed: positive,
        /** Walkers' beats: back and forth between two points (x1, z1, x2, z2). */
        walks: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
        /** Where the idle ones stand (x, z, turn). */
        idles: vec3.array(),
      }),
      ground: z.object({ at: vec2, size: positive }),
      /** Where each copy of the scene goes (x, z), in order: 2× uses the first two, and so on. */
      copies: z.array(vec2).min(1),
      seed: z.number().int(),
    }),
    collapse: z.object({
      /** Seconds into the run that the fort comes down. */
      at: nonNegative,
      /** Pieces that turn into physics bodies (per copy): the fort's, then crates to make it up. */
      bodies: positiveInt,
      /** Where the blast is (x, y, z), and how hard it pushes (an impulse per kg, m/s). */
      blastAt: vec3,
      push: positive,
      lift: nonNegative,
      friction: nonNegative,
      restitution: nonNegative,
      density: positive,
      /** Each body's box, as a share of the piece's size (pieces overlap a little where they meet). */
      fit: z.number().positive().max(1),
      /** As the siege's physics: a step's length (s), the most a slow frame may catch up. */
      timestep: positive,
      maxStepsPerFrame: positiveInt,
      gravity: positive,
      solverIterations: positiveInt,
    }),
    /** The camera's way: through these (seconds; position; what it looks at), as the siege flies. */
    camera: z
      .array(z.object({ at: nonNegative, from: vec3, look: vec3 }))
      .min(2)
      .superRefine((keys, ctx) => {
        keys.forEach((key, index) => {
          const before = keys[index - 1];
          if (before && key.at <= before.at) {
            ctx.addIssue({ code: 'custom', path: [index, 'at'], message: 'Keys must be in order' });
          }
        });
      }),
    /** The blob under each person when there are no real shadows: its width (m) and darkness. */
    blob: z.object({ width: positive, opacity: z.number().min(0).max(1) }),
    /** The boxes pack's looks: the siege's block colours, and sizes (m) before fitting. */
    boxes: z.object({
      stone: z.number().int().nonnegative(),
      wood: z.number().int().nonnegative(),
      roof: z.number().int().nonnegative(),
      wallDepth: positive,
      guard: vec3,
    }),
    /**
     * The results: on a screen up to `summaryUpToPx` CSS px wide they open as the phone summary
     * (one small card a run, readable in a screenshot), on a wider one as the full table.
     */
    results: z.object({ summaryUpToPx: positive }),
    packs: z.array(packSchema).min(1),
    runAll: z.array(runSchema).min(1),
    /**
     * Quick run (and `?bench=quick`, which starts it as the page loads): a few short runs, the log
     * sent after each, for a device there's only a minute on (a free BrowserStack trial).
     */
    quick: z.object({
      /** Seconds flown along the camera path up to `from`, not counted, once it's all loaded. */
      warmupSeconds: positive,
      /** Seconds measured, from `from` on the camera path. */
      seconds: positive,
      /** Where on the camera path (s) the measuring starts. */
      from: nonNegative,
      /** A run still loading after this long (s) is given up, and logged and sent as such. */
      loadTimeoutS: positive,
      /** How long (s) the next run waits for the last one's upload before starting anyway. */
      uploadWaitS: positive,
      runs: z.array(runSchema).min(1),
    }),
  })
  .superRefine((bench, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const packs = new Set<string>();
    bench.packs.forEach((pack, index) => {
      if (packs.has(pack.id)) issue(['packs', index, 'id'], `Duplicate pack "${pack.id}"`);
      packs.add(pack.id);
    });
    const most = Math.max(...bench.scales);
    if (bench.layout.copies.length < most) {
      issue(['layout', 'copies'], `${String(most)}× needs ${String(most)} copies' places`);
    }
    const checkRuns = (runs: readonly z.output<typeof runSchema>[], path: (string | number)[]) => {
      runs.forEach((run, index) => {
        if (!packs.has(run.pack)) issue([...path, index, 'pack'], `Unknown pack "${run.pack}"`);
        if (!bench.scales.includes(run.scale)) {
          issue([...path, index, 'scale'], `Scale ${String(run.scale)} isn't one of the scales`);
        }
      });
    };
    checkRuns(bench.runAll, ['runAll']);
    checkRuns(bench.quick.runs, ['quick', 'runs']);
    const last = bench.camera[bench.camera.length - 1];
    if (last && last.at < bench.seconds) {
      issue(['camera'], 'The camera path must last the whole run');
    }
    if (bench.collapse.at >= bench.seconds)
      issue(['collapse', 'at'], 'The collapse must be in the run');
    const { quick } = bench;
    if (quick.warmupSeconds > quick.from) {
      issue(['quick', 'warmupSeconds'], 'The warm-up flies the path before `from`: it must fit');
    }
    if (quick.from + quick.seconds > bench.seconds) {
      issue(['quick', 'seconds'], 'The quick run must end within the camera path');
    }
    if (bench.collapse.at < quick.from || bench.collapse.at >= quick.from + quick.seconds) {
      issue(['quick', 'from'], 'The quick run must see the fort come down');
    }
  });

export type BenchDataInput = z.input<typeof benchDataShape>;
export type BenchData = z.output<typeof benchDataShape>;
export type BenchPack = BenchData['packs'][number];
export type BenchPiece = z.output<typeof pieceSchema>;
export type BenchRun = BenchData['runAll'][number];
export type BenchQuick = BenchData['quick'];
export type BenchLayout = BenchData['layout'];
export type BenchCameraKey = BenchData['camera'][number];
export type BenchPixelRatio = BenchData['pixelRatios'][number];

const QUARTER = Math.PI / 2;

/** The Medieval Village pieces, shared by the village and its heavy variant. */
const villageRoles = {
  wall: { nodes: ['Wall_UnevenBrick_Straight'] },
  wallWindow: { nodes: ['Wall_UnevenBrick_Window_Wide_Round'] },
  gate: { nodes: ['Wall_UnevenBrick_Door_Round', 'Door_1_Round'] },
  corner: { nodes: ['Corner_Exterior_Brick'] },
  towerWall: { nodes: ['Wall_UnevenBrick_Straight'] },
  towerRoof: { nodes: ['Roof_Tower_RoundTiles'], sink: 0.1 },
  houseWall: { nodes: ['Wall_Plaster_WoodGrid'], turn: Math.PI },
  houseWindow: { nodes: ['Wall_Plaster_Window_Wide_Flat', 'Window_Wide_Flat1'], turn: Math.PI },
  houseDoor: { nodes: ['Wall_Plaster_Door_Round', 'Door_1_Round'], turn: Math.PI },
  houseRoof: { nodes: ['Roof_RoundTiles_6x6'], sink: 0.15 },
  chimney: { nodes: ['Prop_Chimney'] },
  crate: { nodes: ['Prop_Crate'] },
};
const villageProps = [
  { nodes: ['Prop_Wagon'], width: 3, count: 2 },
  { nodes: ['Prop_WoodenFence_Single'], width: 2, count: 8 },
  { nodes: ['Prop_WoodenFence_Extension1'], width: 2, count: 4 },
];
const villageCharacters = ['Male_Peasant', 'Female_Peasant', 'Male_Ranger', 'Female_Ranger'].map(
  (outfit) => ({ url: `bench/village/${outfit}.glb`, idle: 'idle', walk: 'walk' }),
);
const villageLiteCharacters = [
  'Male_Peasant',
  'Female_Peasant',
  'Male_Ranger',
  'Female_Ranger',
].map((outfit) => ({ url: `bench/village-lite/${outfit}.glb`, idle: 'idle', walk: 'walk' }));
const villageTrees = [
  { url: 'models/quaternius/CommonTree_1.gltf' },
  { url: 'models/quaternius/CommonTree_3.gltf' },
  { url: 'models/quaternius/Pine_1.gltf' },
];

export const bench = {
  seconds: 20,
  warmupFrames: 20,
  renderer: {
    antialias: true,
    maxPixelRatio: 2,
    shadowMapSize: 1024,
    shadowHalfWidth: 20,
    shadowHalfHeight: 30,
    shadowFar: 70,
    shadowBias: -0.0005,
    sunFrom: [-8, 16, 16],
    sunIntensity: 2,
    hemisphereIntensity: 1.35,
    sky: 0xa9c6dc,
    fogNear: 60,
    fogFar: 150,
    fov: 52,
    near: 0.1,
    far: 260,
  },
  pixelRatios: ['game', 1, 1.5, 2, 'device'],
  scales: [1, 2, 4],
  layout: {
    module: 2,
    fort: { at: [0, -20], wide: 8, deep: 6 },
    tower: { at: [-4.5, -23], modules: 2 },
    houses: [
      { at: [-17, -5], wide: 3, deep: 3, turn: QUARTER },
      { at: [17, -7], wide: 3, deep: 3, turn: -QUARTER },
      { at: [16, -32], wide: 3, deep: 3, turn: Math.PI },
    ],
    windowEvery: 3,
    crates: { at: [3.5, -20], size: 0.9, columns: 7, rows: 5 },
    props: { from: [-24, -12], to: [24, 2], lane: 7 },
    trees: {
      count: 44,
      from: [-50, -110],
      to: [50, 6],
      clearFrom: [-24, -40],
      clearTo: [24, 20],
      minHeight: 5,
      maxHeight: 9,
    },
    characters: {
      height: 1.8,
      speed: 1.3,
      walks: [
        [-9, -10, 9, -10],
        [8, -8.5, -8, -8.5],
        [-13, -12, -13, 2],
        [12, -2, 12, -14],
        [-5, -3, 5, -1],
        [0, -16.5, 0, -12],
      ],
      idles: [
        [-2.5, -12.5, 0],
        [2.5, -12.5, 0],
        [-6, -6, 0.6],
        [7, -4, -0.5],
        [-15, 0, 1.2],
        [14, -1, -1],
      ],
    },
    ground: { at: [0, -40], size: 300 },
    copies: [
      [0, 0],
      [-50, -38],
      [50, -38],
      [0, -80],
    ],
    seed: 7,
  },
  collapse: {
    at: 10,
    bodies: 200,
    blastAt: [0, 1.5, -12],
    push: 6,
    lift: 3,
    friction: 0.7,
    restitution: 0.05,
    density: 600,
    fit: 0.85,
    timestep: 1 / 60,
    maxStepsPerFrame: 4,
    gravity: 9.81,
    solverIterations: 8,
  },
  camera: [
    // The flyover: from high behind the sights, over the fort's front and round its back...
    { at: 0, from: [0, 24, 34], look: [0, 3, -20] },
    { at: 2.5, from: [-16, 16, 2], look: [0, 4, -20] },
    { at: 5, from: [-6, 15, -38], look: [0, 3, -20] },
    { at: 7.5, from: [16, 13, -18], look: [0, 3, -20] },
    // ...down to the sights, in time to watch the fort come down at 10 s...
    { at: 9.5, from: [0, 1.8, 16], look: [0, 3, -20] },
    { at: 12, from: [0, 1.8, 16], look: [-6, 3, -20] },
    { at: 14.5, from: [0, 1.8, 16], look: [7, 4, -22] },
    // ...a bolt cam up close, and back to the sights.
    { at: 16.5, from: [1, 3, -4], look: [0, 2, -20] },
    { at: 18, from: [0, 1.8, 16], look: [0, 3, -20] },
    { at: 20, from: [0, 1.8, 16], look: [0, 3, -20] },
  ],
  blob: { width: 1.1, opacity: 0.45 },
  // Phones are 360–450 px wide, the smallest tablets about 600: the full table fits from about 800.
  results: { summaryUpToPx: 700 },
  boxes: {
    stone: 0x9b978d,
    wood: 0xc39a66,
    roof: 0x8a4b32,
    wallDepth: 0.5,
    guard: [0.55, 1.8, 0.35],
  },
  packs: [
    {
      id: 'boxes',
      name: 'Boxes',
      about: "What main ships: the siege's boxes and box guards, Kenney trees",
      kind: 'boxes',
      fort: { shape: 'ring', storeys: 3 },
      tower: { shape: 'ring', storeys: 4 },
      house: { shape: 'ring', storeys: 2 },
      trees: [{ url: 'models/kenney/tree_default.glb' }],
    },
    {
      id: 'kenney',
      name: 'Kenney',
      about: 'Castle Kit 2.0 and Mini Characters 2.0: flat colours, one small texture each',
      kind: 'models',
      pieces: 'bench/kenney/castle.glb',
      roles: {
        wall: { nodes: ['wall'], turn: QUARTER },
        wallWindow: { nodes: ['wall'], turn: QUARTER },
        gate: { nodes: ['wall-narrow-gate'], turn: QUARTER },
        corner: { nodes: ['wall-corner'] },
        towerBase: { nodes: ['tower-square-base'] },
        towerWall: { nodes: ['tower-square-mid-windows'] },
        towerRoof: { nodes: ['tower-square-roof'] },
        houseWall: { nodes: ['tower-square-mid-windows'] },
        houseRoof: { nodes: ['tower-square-top-roof'] },
        crate: { nodes: ['tower-square-base'] },
      },
      fort: { shape: 'ring', storeys: 1 },
      tower: { shape: 'stack', storeys: 4 },
      house: { shape: 'stack', storeys: 1 },
      props: [
        { nodes: ['rocks-large'], width: 2, count: 4 },
        { nodes: ['siege-ballista'], width: 2.5, count: 1 },
        { nodes: ['tree-log'], width: 2, count: 4 },
        { nodes: ['flag'], width: 1.2, count: 4 },
      ],
      trees: [
        { url: 'bench/kenney/castle.glb', node: 'tree-large' },
        { url: 'bench/kenney/castle.glb', node: 'tree-small' },
      ],
      characters: [
        'character-soldier',
        'character-knight',
        'character-male-a',
        'character-female-a',
      ].map((character) => ({
        url: `bench/kenney/mini/${character}.glb`,
        idle: 'idle',
        walk: 'walk',
      })),
    },
    {
      id: 'village',
      name: 'Village',
      about: 'Quaternius Medieval Village MegaKit and Fantasy Outfits, textures at 1024 px',
      kind: 'models',
      pieces: 'bench/village/pieces.glb',
      animations: 'bench/village/animations.glb',
      roles: villageRoles,
      fort: { shape: 'ring', storeys: 3 },
      tower: { shape: 'ring', storeys: 4 },
      house: { shape: 'ring', storeys: 2 },
      props: villageProps,
      trees: villageTrees,
      characters: villageCharacters,
    },
    {
      id: 'village-lite',
      name: 'Village optimised',
      about:
        'The village made cheap: colour maps only at 512 px (an atlas a person), standing pieces merged, falling ones instanced, people and trees simplified',
      kind: 'models',
      pieces: 'bench/village-lite/pieces.glb',
      animations: 'bench/village/animations.glb',
      batched: true,
      matte: true,
      roles: { ...villageRoles, corner: { nodes: ['Corner_Exterior_Wood'] } },
      fort: { shape: 'ring', storeys: 3 },
      tower: { shape: 'ring', storeys: 4 },
      house: { shape: 'ring', storeys: 2 },
      props: villageProps,
      trees: [
        { url: 'bench/village-lite/CommonTree_3.glb' },
        { url: 'bench/village-lite/Pine_1.glb' },
      ],
      characters: villageLiteCharacters,
    },
    {
      id: 'village-lite-1024',
      name: 'Village optimised 1024',
      about: 'Village optimised with its colour maps at 1024 px',
      kind: 'models',
      pieces: 'bench/village-lite/pieces.glb',
      textures: { from: '/tex-512/', to: '/tex-1024/' },
      animations: 'bench/village/animations.glb',
      batched: true,
      matte: true,
      roles: { ...villageRoles, corner: { nodes: ['Corner_Exterior_Wood'] } },
      fort: { shape: 'ring', storeys: 3 },
      tower: { shape: 'ring', storeys: 4 },
      house: { shape: 'ring', storeys: 2 },
      props: villageProps,
      trees: [
        { url: 'bench/village-lite/CommonTree_3.glb' },
        { url: 'bench/village-lite/Pine_1.glb' },
      ],
      characters: villageLiteCharacters,
    },
    {
      id: 'village-heavy',
      name: 'Village heavy',
      about: 'The village with its full-size textures (2048 px; the outfits 4096 px)',
      kind: 'models',
      pieces: 'bench/village/pieces.glb',
      textures: { from: '/tex/', to: '/tex-full/' },
      animations: 'bench/village/animations.glb',
      roles: villageRoles,
      fort: { shape: 'ring', storeys: 3 },
      tower: { shape: 'ring', storeys: 4 },
      house: { shape: 'ring', storeys: 2 },
      props: villageProps,
      trees: villageTrees,
      characters: villageCharacters,
    },
  ],
  // Under 8 minutes on a phone: each pack at 1× and 4× (the village at 2× too), then the costs one
  // at a time at 1×, and the optimised village against the plain one. The boxes again near the end
  // show how much the phone has slowed as it warmed up; the heavy village goes last, as it may run
  // out of memory.
  runAll: [
    { pack: 'boxes', scale: 1 },
    { pack: 'boxes', scale: 4 },
    { pack: 'boxes', scale: 1, shadows: 'off', note: 'no shadows' },
    { pack: 'kenney', scale: 1 },
    { pack: 'kenney', scale: 4 },
    { pack: 'kenney', scale: 1, shadows: 'off', note: 'no shadows' },
    { pack: 'village', scale: 1 },
    { pack: 'village', scale: 2 },
    { pack: 'village', scale: 4 },
    { pack: 'village', scale: 1, shadows: 'off', note: 'no shadows' },
    { pack: 'village', scale: 1, matte: true, note: 'matte materials' },
    { pack: 'village-lite', scale: 1 },
    { pack: 'village-lite', scale: 1, shadows: 'off', note: 'no shadows' },
    { pack: 'village-lite', scale: 1, shadows: 'blob', note: 'blob shadows' },
    { pack: 'village-lite', scale: 2 },
    { pack: 'village-lite-1024', scale: 1, note: '1024 px colour maps' },
    { pack: 'boxes', scale: 1, note: 'again: has it slowed as it warmed?' },
    { pack: 'village-heavy', scale: 1, note: 'full-size textures' },
  ],
  // About 40 s from the page loading to the last upload on a slow phone: a free BrowserStack trial
  // gives a device about a minute. 5 to 13 s of the path takes in the flyover behind the fort, the
  // drop to the sights and the fort coming down at 10. The optimised village first, as it matters
  // most; the boxes as the baseline; then the plain village, last as it's the slowest to load
  // (about 10 MB, its textures at 1024 px), so it can't hold up the other two's uploads.
  quick: {
    warmupSeconds: 2,
    seconds: 8,
    from: 5,
    loadTimeoutS: 15,
    uploadWaitS: 5,
    runs: [
      { pack: 'village-lite', scale: 1 },
      { pack: 'boxes', scale: 1 },
      { pack: 'village', scale: 1 },
    ],
  },
} satisfies BenchDataInput;

/** The validated bench data. Throws if anything above is wrong. */
export function loadBenchData(raw: unknown = bench): BenchData {
  const result = benchDataShape.safeParse(raw);
  if (!result.success) {
    throw new Error(`Bench data is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
