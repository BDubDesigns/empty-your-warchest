import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

/** Loads a glTF/GLB model's scene, made matte (see `matte`). */
export async function loadModel(url: string): Promise<THREE.Object3D> {
  return matte((await loader.loadAsync(url)).scene);
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
