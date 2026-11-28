import { z } from 'zod';

// The animated characters (the siege's guards and its captain), built from the Quaternius kits by
// tools/characters/build.py into public/models/characters/: one GLB per character per graphics
// tier (the same skeleton in both, only fewer triangles on Low), the clips once in their own GLB
// (played on either character by bone name), and colour maps at 1024, 512 and 256 px in tex-1024/,
// tex-512/ and tex-256/. Debug → Character preview shows them. Metres, y up.

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use a lower_snake_case id');
const name = z.string().min(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');
const glb = z.string().regex(/^models\/characters\/[\w-]+\.glb$/, 'A GLB in models/characters/');

/** The sizes the build saves every colour map at (its tex-<size>/ folders). */
export const characterTextureSizes = [1024, 512, 256] as const;
const textureSize = z.union(characterTextureSizes.map((size) => z.literal(size)));

/** How a clip plays: round and round, once (then back to idle), or once and held on its last frame. */
export const characterClipPlays = ['loop', 'once', 'hold'] as const;

const clipSchema = z.object({
  /** Its name in the clips GLB. */
  id,
  /** Its button in the preview. */
  label: name,
  play: z.enum(characterClipPlays),
});

const tierFiles = z.object({ high: glb, low: glb });
const tierTriangles = z.object({ high: positiveInt, low: positiveInt });

const characterSchema = z.object({
  id,
  name,
  /** Its GLB on each tier. */
  files: tierFiles,
  /** Its colour maps (tex-<size>/<map>.jpg), one draw each. */
  maps: z.array(id).min(1),
  /** The most triangles each tier's GLB may have (the build cuts it to about this). */
  triangles: tierTriangles,
  /** Degrees about y that turn it to face +z. */
  turn: z.number(),
});

const tierSchema = z.object({
  /** Each colour map's size on this tier (px), by map. */
  textureSizes: z.record(z.string(), textureSize),
  /** A real-time shadow map (the siege's High has one; its Low has blob shadows). */
  shadows: z.boolean(),
  /** The most GPU memory (MB) its colour maps may take, with their mipmaps. */
  maxTextureMB: positive,
});

/** An orbit camera round `target`: `yaw` and `pitch` in degrees, `distance` in metres. */
const orbitSchema = z.object({
  target: vec3,
  yaw: z.number(),
  pitch: z.object({ start: z.number(), min: z.number(), max: z.number() }),
  distance: z.object({ start: positive, min: positive, max: positive }),
});

export const charactersSchema = z
  .object({
    /** The clips' GLB: the skeleton's nodes and every clip, no mesh. */
    clipFile: glb,
    clips: z.array(clipSchema).min(1),
    /** The clip a character plays when nothing else is asked for (and after a `once` clip). */
    idleClip: id,
    /** Seconds a clip blends into the next. */
    fadeSeconds: positive,
    models: z.array(characterSchema).min(1),
    tiers: z.object({ high: tierSchema, low: tierSchema }),
    /** The most bones a character's skeleton may have (checked against the shipped GLBs). */
    maxBones: positiveInt,
    /**
     * Debug → Character preview: the characters `spacing` m apart on a ground `ground` m across,
     * an orbit camera (dragged `dragDegrees` a screen width, zoomed `zoomStep` a wheel notch or
     * pinched); and the crowd: `count` copies of `model` in rows of `columns`, `spacing` m apart,
     * playing `clips` in turn, seen from `distance` m and `pitch` degrees up. The frame time is the median of the last
     * `frames` frames.
     */
    preview: z.object({
      spacing: positive,
      ground: positive,
      orbit: orbitSchema,
      fov: z.number().min(20).max(90),
      dragDegrees: positive,
      zoomStep: positive,
      crowd: z.object({
        model: id,
        count: positiveInt,
        columns: positiveInt,
        spacing: positive,
        distance: positive,
        pitch: z.number(),
        clips: z.array(id).min(1),
      }),
      frames: positiveInt,
      colors: z.object({
        sky: color,
        ground: color,
        skyLight: color,
        groundLight: color,
        sun: color,
      }),
      light: z.object({
        hemisphere: positive,
        sun: positive,
        from: vec3,
        shadowMap: z.object({
          size: positiveInt,
          halfWidth: positive,
          far: positive,
          bias: z.number(),
        }),
      }),
    }),
  })
  .superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const clipIds = new Set<string>();
    data.clips.forEach((clip, index) => {
      if (clipIds.has(clip.id)) issue(['clips', index, 'id'], `Duplicate clip "${clip.id}"`);
      clipIds.add(clip.id);
    });
    if (!clipIds.has(data.idleClip)) issue(['idleClip'], `Unknown clip "${data.idleClip}"`);
    else if (data.clips.find((clip) => clip.id === data.idleClip)?.play !== 'loop') {
      issue(['idleClip'], 'The idle clip must loop');
    }
    const modelIds = new Set<string>();
    const maps = new Set<string>();
    data.models.forEach((model, index) => {
      if (modelIds.has(model.id)) issue(['models', index, 'id'], `Duplicate model "${model.id}"`);
      modelIds.add(model.id);
      for (const map of model.maps) maps.add(map);
      if (model.triangles.low > model.triangles.high) {
        issue(['models', index, 'triangles', 'low'], 'Low must not have more triangles than High');
      }
    });
    for (const tier of ['high', 'low'] as const) {
      const sizes = data.tiers[tier].textureSizes;
      for (const map of maps) {
        if (!(map in sizes)) issue(['tiers', tier, 'textureSizes'], `No size for map "${map}"`);
      }
      for (const map of Object.keys(sizes)) {
        if (!maps.has(map)) issue(['tiers', tier, 'textureSizes', map], `Unknown map "${map}"`);
      }
    }
    const { crowd, orbit } = data.preview;
    if (!modelIds.has(crowd.model)) {
      issue(['preview', 'crowd', 'model'], `Unknown model "${crowd.model}"`);
    }
    crowd.clips.forEach((clip, index) => {
      if (!clipIds.has(clip)) issue(['preview', 'crowd', 'clips', index], `Unknown clip "${clip}"`);
    });
    const { pitch, distance } = orbit;
    if (pitch.min > pitch.start || pitch.start > pitch.max) {
      issue(['preview', 'orbit', 'pitch'], 'Start must be between min and max');
    }
    if (distance.min > distance.start || distance.start > distance.max) {
      issue(['preview', 'orbit', 'distance'], 'Start must be between min and max');
    }
    if (crowd.distance > distance.max) {
      issue(['preview', 'crowd', 'distance'], 'Must not be past the orbit’s max distance');
    }
  });

export type Characters = z.output<typeof charactersSchema>;
export type CharacterModel = Characters['models'][number];
export type CharacterClip = Characters['clips'][number];
export type CharacterClipPlay = (typeof characterClipPlays)[number];
