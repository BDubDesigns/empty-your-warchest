import * as THREE from 'three';
import { Rng } from '../core';

/**
 * Realistic ground for any 3D scene: photo-scanned CC0 textures (credits in
 * public/textures/CREDITS.md), each a colour map and a normal map (which makes light catch the
 * dirt, twigs and grass as if they were real bumps). One texture per kind, loaded once and shared;
 * each ground mesh maps it in world units, so the ground is the same size everywhere.
 */
export type GroundKind = 'forestGrass' | 'meadowGrass' | 'troddenDirt';

const GROUNDS: Record<GroundKind, { map: string; normalMap: string; tile: number; tint: number }> =
  {
    /** Forest floor: grass, twigs and leaf litter. */
    forestGrass: {
      map: 'textures/ground/forest_grass.jpg',
      normalMap: 'textures/ground/forest_grass_normal.jpg',
      tile: 3.5,
      tint: 0xffffff,
    },
    /** Thick, green grass. */
    meadowGrass: {
      map: 'textures/ground/meadow_grass.jpg',
      normalMap: 'textures/ground/meadow_grass_normal.jpg',
      tile: 2.5,
      tint: 0xffffff,
    },
    /** Bare, trodden earth with moss and leaves, for places people work. */
    troddenDirt: {
      map: 'textures/ground/trodden_dirt.jpg',
      normalMap: 'textures/ground/trodden_dirt_normal.jpg',
      tile: 3,
      tint: 0xffffff,
    },
  };

const loaded = new Map<GroundKind, { map: THREE.Texture; normalMap: THREE.Texture }>();

function texturesFor(kind: GroundKind) {
  const existing = loaded.get(kind);
  if (existing) return existing;
  const loader = new THREE.TextureLoader();
  const load = (path: string, color: boolean) => {
    const texture = loader.load(path);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const ground = GROUNDS[kind];
  const textures = { map: load(ground.map, true), normalMap: load(ground.normalMap, false) };
  loaded.set(kind, textures);
  return textures;
}

/**
 * A flat `width` × `depth` patch of ground lying on the scene's floor (y = 0, facing up),
 * receiving shadows.
 */
export function groundMesh(kind: GroundKind, width: number, depth: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth);
  const { tile, tint } = GROUNDS[kind];
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index++) {
    uv.setXY(index, (uv.getX(index) * width) / tile, (uv.getY(index) * depth) / tile);
  }
  uv.needsUpdate = true;
  const { map, normalMap } = texturesFor(kind);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: tint, map, normalMap }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** How a worn patch wears: how much of it is bare, its shape, and its seed. */
export interface Wear {
  /** Share of the patch worn bare (0 none, 1 all), in soft, irregular blotches. */
  cover: number;
  /** Bare mostly in the middle, fading out toward the edges (an oval). */
  round: boolean;
  seed: number;
}

/** Pixels across the wear mask, and how many blotches cross it. */
const WEAR_SIZE = 256;
const WEAR_SCALE = 5;

/**
 * A `width` × `depth` patch of `kind` worn through in blotches, to lay over another ground (say,
 * trodden earth showing through grass where people work): only the `wear.cover` share shows,
 * with soft edges. It sits a hair above the floor.
 */
export function wornGround(kind: GroundKind, width: number, depth: number, wear: Wear): THREE.Mesh {
  const mesh = groundMesh(kind, width, depth);
  const material = mesh.material as THREE.MeshLambertMaterial;
  const mask = new THREE.CanvasTexture(wearMask(wear));
  // The patch's UVs count ground tiles; the mask spans the patch once.
  const { tile } = GROUNDS[kind];
  mask.repeat.set(tile / width, tile / depth);
  material.alphaMap = mask;
  material.transparent = true;
  material.depthWrite = false;
  mesh.position.y = 0.004;
  mesh.renderOrder = 1;
  return mesh;
}

/** The wear as a grey mask (white = bare): smooth random blotches, thresholded softly. */
function wearMask(wear: Wear): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WEAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const rng = new Rng(wear.seed);
  // Value noise in two octaves: a lattice of random heights, smoothly blended.
  const octaves = [WEAR_SCALE, WEAR_SCALE * 3].map((cells) => ({
    cells,
    grid: Array.from({ length: (cells + 1) ** 2 }, () => rng.next()),
  }));
  const noise = (u: number, v: number) =>
    octaves.reduce((sum, { cells, grid }, index) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) =>
        grid[Math.min(j, cells) * (cells + 1) + Math.min(i, cells)] ?? 0;
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return sum + (top + (bottom - top) * sy) * (index === 0 ? 0.7 : 0.3);
    }, 0);
  const image = context.createImageData(WEAR_SIZE, WEAR_SIZE);
  for (let py = 0; py < WEAR_SIZE; py++) {
    for (let px = 0; px < WEAR_SIZE; px++) {
      const u = (px + 0.5) / WEAR_SIZE;
      const v = (py + 0.5) / WEAR_SIZE;
      let value = noise(u, v);
      if (wear.round) {
        // Most worn in the middle; none at the oval's edge.
        const out = Math.hypot(u - 0.5, v - 0.5) * 2;
        value = value * 0.6 + (1 - out) * 0.6 - 0.1;
      }
      // Bare where the noise is above the line that leaves `cover` worn; soft at the edge.
      const line = 1 - wear.cover;
      const bare = Math.min(Math.max((value - line + 0.06) / 0.12, 0), 1);
      const at = (py * WEAR_SIZE + px) * 4;
      image.data[at] = image.data[at + 1] = image.data[at + 2] = bare * 255;
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
