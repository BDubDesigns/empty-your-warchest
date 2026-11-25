import * as THREE from 'three';

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
