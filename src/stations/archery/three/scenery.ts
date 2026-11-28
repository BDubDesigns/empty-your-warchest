import * as THREE from 'three';
import { Rng } from '../../../core';

/**
 * What's around the hunting stand, only looks: a sky that fades from deep blue overhead to a pale
 * haze at the horizon, soft clouds drifting across it, and the forest edge, a band of trees along
 * the horizon beyond the field (so it never hides a bird or an arrow). Every repeat is instanced:
 * the clouds are one draw, each tree model's parts one draw each.
 */

export const SKY = { top: 0x4f8fd6, horizon: 0xcfe3ee, ground: 0x6f8d4a };

/** The sky as a tall gradient, drawn behind everything. */
export function skyTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const fade = context.createLinearGradient(0, 0, 0, 256);
  const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
  fade.addColorStop(0, hex(SKY.top));
  fade.addColorStop(0.7, '#9cc6e8');
  fade.addColorStop(1, hex(SKY.horizon));
  context.fillStyle = fade;
  context.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft white puff for a cloud: a few overlapping blurred circles. */
function cloudTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const puffs: [number, number, number][] = [
    [40, 38, 22],
    [64, 30, 26],
    [88, 38, 20],
    [56, 44, 18],
    [76, 44, 18],
  ];
  for (const [x, y, r] of puffs) {
    const puff = context.createRadialGradient(x, y, 0, x, y, r);
    puff.addColorStop(0, 'rgba(255,255,255,0.95)');
    puff.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    puff.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = puff;
    context.fillRect(0, 0, 128, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Cloud {
  at: THREE.Vector3;
  scale: number;
  speed: number;
}

/**
 * Clouds high over the field, square on to the camera (which never moves), drifting slowly to one
 * side and wrapping round. `count` of the `most` made are shown (the graphics tier's share).
 */
export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  readonly #clouds: Cloud[];
  readonly #turn: THREE.Quaternion;
  readonly #matrix = new THREE.Matrix4();
  readonly #reach: number;

  constructor(most: number, seed: number, camera: THREE.Camera, distance: number) {
    const rng = new Rng(`${String(seed)}:clouds`);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2, 1),
      new THREE.MeshBasicMaterial({
        map: cloudTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
      Math.max(most, 1),
    );
    this.mesh.frustumCulled = false;
    this.#turn = camera.quaternion.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.#turn);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.#turn);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.#turn);
    this.#reach = distance * 1.4;
    this.#clouds = Array.from({ length: most }, () => {
      const away = distance * rng.range(1.6, 2.4);
      const at = camera.position
        .clone()
        .addScaledVector(forward, away)
        .addScaledVector(right, rng.range(-1, 1) * this.#reach)
        .addScaledVector(up, rng.range(-0.05, 0.75) * away);
      return { at, scale: rng.range(9, 20), speed: rng.range(0.4, 1.1) };
    });
    this.show(most);
    this.update(0);
  }

  show(count: number): void {
    this.mesh.count = Math.min(count, this.#clouds.length);
  }

  update(dt: number): void {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.#turn);
    this.#clouds.forEach((cloud, index) => {
      cloud.at.addScaledVector(right, cloud.speed * dt);
      // Wrapped round once it drifts off the far side.
      const across = cloud.at.dot(right);
      if (across > this.#reach * 1.2) cloud.at.addScaledVector(right, -this.#reach * 2.4);
      this.#matrix.compose(cloud.at, this.#turn, new THREE.Vector3(cloud.scale, cloud.scale, 1));
      this.mesh.setMatrixAt(index, this.#matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * The forest edge: `most` trees in a band from `near` to `far` away, across the view and round to
 * the sides, picked from `models`, each `height` tall. `count` of them show (the tier's share),
 * spread evenly along the band.
 */
export class TreeLine {
  readonly group = new THREE.Group();
  readonly #meshes: { mesh: THREE.InstancedMesh; slots: number[]; matrices: THREE.Matrix4[] }[] =
    [];
  readonly #order: number[];

  constructor(
    models: THREE.Object3D[],
    most: number,
    seed: number,
    band: { near: number; far: number; height: { min: number; max: number } },
  ) {
    const rng = new Rng(`${String(seed)}:trees`);
    const trees = Array.from({ length: most }, (_, index) => {
      // Across the view (about 140° of it), in a ragged band.
      const across = ((index + rng.range(0.1, 0.9)) / most) * 2 - 1;
      const angle = across * 1.25;
      const away = rng.range(band.near, band.far);
      return {
        model: index % models.length,
        x: Math.sin(angle) * away,
        z: -Math.cos(angle) * away,
        height: rng.range(band.height.min, band.height.max),
        turn: rng.range(0, Math.PI * 2),
      };
    });
    // Every other tree first, so a lower tier still covers the whole band.
    this.#order = [
      ...trees.map((_, index) => index).filter((index) => index % 2 === 0),
      ...trees.map((_, index) => index).filter((index) => index % 2 === 1),
    ];
    models.forEach((model, modelIndex) => {
      const box = new THREE.Box3().setFromObject(model);
      const tall = Math.max(box.max.y - box.min.y, 0.001);
      const mine = trees
        .map((tree, index) => ({ tree, index }))
        .filter(({ tree }) => tree.model === modelIndex);
      model.updateMatrixWorld(true);
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = new THREE.InstancedMesh(
          child.geometry as THREE.BufferGeometry,
          child.material as THREE.Material,
          Math.max(mine.length, 1),
        );
        const matrices = mine.map(({ tree }) => {
          const scale = tree.height / tall;
          const place = new THREE.Matrix4().compose(
            new THREE.Vector3(tree.x, -box.min.y * scale, tree.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.turn),
            new THREE.Vector3(scale, scale, scale),
          );
          return new THREE.Matrix4().multiplyMatrices(place, child.matrixWorld);
        });
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.#meshes.push({ mesh, slots: mine.map(({ index }) => index), matrices });
      });
    });
    this.show(most);
  }

  /** Shows the first `count` trees of the band's order, the rest hidden. */
  show(count: number): void {
    const shown = new Set(this.#order.slice(0, count));
    for (const { mesh, slots, matrices } of this.#meshes) {
      // The first `count` instances draw: the shown trees go to the front.
      const keep = slots.flatMap((tree, slot) => (shown.has(tree) ? [matrices[slot]] : []));
      keep.forEach((matrix, index) => {
        if (matrix) mesh.setMatrixAt(index, matrix);
      });
      mesh.count = keep.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
