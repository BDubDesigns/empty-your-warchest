import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
/** Each model loads once: views clone what they get, so every caller can share one copy. */
const loaded = new Map<string, Promise<THREE.Object3D>>();

/**
 * Loads a glTF/GLB model's scene, made matte (see `matte`). The result is shared by every caller
 * (and warmed by preloading at the camp), so clone it rather than changing it.
 */
export function loadModel(url: string): Promise<THREE.Object3D> {
  let model = loaded.get(url);
  if (!model) {
    model = loader.loadAsync(url).then((gltf) => matte(gltf.scene));
    // A failed load (say, a dropped connection) is tried again next time, not remembered.
    void model.catch(() => loaded.delete(url));
    loaded.set(url, model);
  }
  return model;
}

/**
 * Kenney's packs export fully metallic materials, which render black without an environment
 * map; these are meant to be flat-shaded, so make every standard material matte.
 */
export function matte(model: THREE.Object3D): THREE.Object3D {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials: unknown[] = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = 0;
        material.roughness = 1;
      }
    }
  });
  return model;
}
