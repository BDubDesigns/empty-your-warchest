import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { textureBytes } from '../../bench/logic/stats';
import type { GraphicsTier } from '../../core';
import type { CharacterClip, Characters } from '../../data';

// The characters' models and clips on one graphics tier, loaded once and shared: each placed
// character is a clone (`place`) with its own mixer, playing the shared clips by bone name.

/** A character placed in a scene: its model, and the mixer that plays its clips. */
export interface PlacedCharacter {
  /** Turned to face +z, its feet at the origin. */
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  /** Plays a clip, blending from what it was playing (from `offset` s into it). */
  play(clip: string, offset?: number): void;
  /** What it's playing. */
  readonly clip: string;
}

export interface CharacterKit {
  tier: GraphicsTier;
  /** A copy of a character, playing the idle clip. */
  place(model: string): PlacedCharacter;
  /** Each character's triangles (its GLB on this tier), by model id. */
  triangles: Map<string, number>;
  /** The skeleton's bone count. */
  bones: number;
  /** A clip's length (s). */
  clipSeconds(clip: string): number;
  /** GPU memory (MB) of the colour maps, with their mipmaps. */
  textureMB(): number;
  dispose(): void;
}

/**
 * A matte copy of `source` (its colour map only), one per colour map: several characters share a
 * map (the guards' looks), and each GLB loads its own copy of the image, so the first is kept for
 * all of them and the others freed (one texture on the graphics card per map, not one per GLB).
 */
function lambert(
  source: THREE.MeshStandardMaterial,
  anisotropy: number,
  shared: Map<string, THREE.MeshLambertMaterial>,
): THREE.MeshLambertMaterial {
  const known = shared.get(source.name);
  if (known) {
    if (source.map !== known.map) source.map?.dispose();
    source.dispose();
    return known;
  }
  if (source.map) source.map.anisotropy = anisotropy;
  const material = new THREE.MeshLambertMaterial({ name: source.name, map: source.map });
  source.dispose();
  shared.set(source.name, material);
  return material;
}

/** The files `loadCharacterKit` fetches on `tier` (to warm the browser's cache ahead of it). */
export function characterFiles(characters: Characters, tier: GraphicsTier): string[] {
  const sizes = characters.tiers[tier].textureSizes;
  const maps = new Set(characters.models.flatMap((model) => model.maps));
  return [
    characters.clipFile,
    ...characters.models.map((model) => model.files[tier]),
    ...[...maps].map((map) => `models/characters/tex-${String(sizes[map] ?? 1024)}/${map}.jpg`),
  ];
}

/**
 * Loads the characters for `tier`: each one's GLB (its colour maps from the size folder the tier
 * gives them) and the clips. Throws if a clip the data names isn't in the clips GLB.
 */
export async function loadCharacterKit(
  characters: Characters,
  tier: GraphicsTier,
  anisotropy: number,
): Promise<CharacterKit> {
  const look = characters.tiers[tier];
  const manager = new THREE.LoadingManager();
  // The GLBs name their images tex/<map>.jpg: each from the folder of the size this tier gives it.
  manager.setURLModifier((url) => {
    const match = /\/tex\/([\w-]+)\.jpg$/.exec(url);
    const map = match?.[1];
    const size = map === undefined ? undefined : look.textureSizes[map];
    if (map === undefined || size === undefined) return url;
    return url.replace(/\/tex\/[^/?#]+$/, `/tex-${String(size)}/${map}.jpg`);
  });
  const loader = new GLTFLoader(manager);
  const [clipFile, ...files] = await Promise.all([
    loader.loadAsync(characters.clipFile),
    ...characters.models.map((model) => loader.loadAsync(model.files[tier])),
  ]);
  const clips = new Map(clipFile.animations.map((clip) => [clip.name, clip]));
  for (const clip of characters.clips) {
    if (!clips.has(clip.id)) throw new Error(`${characters.clipFile} has no clip "${clip.id}"`);
  }
  const plays = new Map<string, CharacterClip>(characters.clips.map((clip) => [clip.id, clip]));

  const models = new Map<string, THREE.Object3D>();
  const triangles = new Map<string, number>();
  const materials = new Set<THREE.MeshLambertMaterial>();
  // One material (and colour map) per map, whichever GLBs use it.
  const shared = new Map<string, THREE.MeshLambertMaterial>();
  const geometries = new Set<THREE.BufferGeometry>();
  let bones = 0;
  characters.models.forEach((model, index) => {
    const scene = files[index]?.scene;
    if (!scene) throw new Error(`No scene in ${model.files[tier]}`);
    let count = 0;
    scene.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh)) return;
      const material = child.material as THREE.Material;
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        throw new Error(`${model.files[tier]}: expected its materials to be glTF's standard ones`);
      }
      const matte = lambert(material, anisotropy, shared);
      child.material = matte;
      materials.add(matte);
      const geometry = child.geometry as THREE.BufferGeometry;
      geometries.add(geometry);
      count += (geometry.index?.count ?? 0) / 3;
      bones = Math.max(bones, child.skeleton.bones.length);
    });
    triangles.set(model.id, count);
    models.set(model.id, scene);
  });

  function place(id: string): PlacedCharacter {
    const source = models.get(id);
    const model = characters.models.find((entry) => entry.id === id);
    if (!source || !model) throw new Error(`Unknown character "${id}"`);
    const copy = SkeletonUtils.clone(source);
    copy.rotation.y = THREE.MathUtils.degToRad(model.turn);
    copy.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh)) return;
      child.castShadow = true;
      // A clip carries him past his bind pose's bounds (he falls a body length): always drawn.
      child.frustumCulled = false;
    });
    const root = new THREE.Group();
    root.name = id;
    root.add(copy);
    const mixer = new THREE.AnimationMixer(copy);
    const actions = new Map<string, THREE.AnimationAction>();
    const action = (name: string): THREE.AnimationAction => {
      let made = actions.get(name);
      if (!made) {
        const clip = clips.get(name);
        if (!clip) throw new Error(`Unknown clip "${name}"`);
        made = mixer.clipAction(clip);
        const play = plays.get(name)?.play ?? 'loop';
        if (play !== 'loop') {
          made.setLoop(THREE.LoopOnce, 1);
          made.clampWhenFinished = true;
        }
        actions.set(name, made);
      }
      return made;
    };
    let current = '';
    const placed: PlacedCharacter = {
      root,
      mixer,
      get clip() {
        return current;
      },
      play(name, offset = 0) {
        const next = action(name);
        const previous = actions.get(current);
        next.reset();
        next.time = offset;
        next.play();
        if (previous && previous !== next)
          next.crossFadeFrom(previous, characters.fadeSeconds, false);
        current = name;
      },
    };
    // A clip played once goes back to idle; one held stays on its last frame.
    mixer.addEventListener('finished', (event) => {
      const done = (event as unknown as { action: THREE.AnimationAction }).action.getClip().name;
      if (done === current && plays.get(done)?.play === 'once') placed.play(characters.idleClip);
    });
    placed.play(characters.idleClip);
    return placed;
  }

  return {
    tier,
    place,
    triangles,
    bones,
    clipSeconds: (clip) => clips.get(clip)?.duration ?? 0,
    textureMB() {
      const textures = new Set<THREE.Texture>();
      for (const material of materials) {
        const map = material.map;
        if (map) textures.add(map);
      }
      let bytes = 0;
      for (const texture of textures) {
        const image = texture.image as { width?: number; height?: number } | null;
        bytes += textureBytes(image?.width ?? 0, image?.height ?? 0);
      }
      return Math.round((bytes / (1024 * 1024)) * 10) / 10;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}
