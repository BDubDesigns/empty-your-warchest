import * as THREE from 'three';

/** A soft round shadow: black in the middle, fading out to nothing at the edge. */
export function blobTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const fade = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.6, 'rgba(0,0,0,0.6)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = fade;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Blob shadows, the cheapest kind: a soft dark patch on the ground under each thing, instead of
 * the sun's real-time shadows (which draw everything a second time, into the shadow map). All of
 * them are one instanced mesh, so one draw. Place each blob every frame its thing moves, then
 * `commit`.
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  readonly #matrix = new THREE.Matrix4();
  readonly #at = new THREE.Vector3();
  readonly #turn = new THREE.Quaternion();
  readonly #size = new THREE.Vector3();
  readonly #up = new THREE.Vector3(0, 1, 0);

  /** Room for `count` blobs, `opacity` dark; the texture is `blobTexture()`'s unless given. */
  constructor(count: number, opacity: number, texture: THREE.Texture = blobTexture()) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: 0x000000,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
      count,
    );
    // Its blobs are all over the ground: bounds would have to be worked out afresh each frame.
    this.mesh.frustumCulled = false;
  }

  /**
   * Blob `index` at (`x`, `z`), `lift` off the ground: `width` by `depth` across, turned `turn`
   * radians about the up axis. A size of 0 hides it.
   */
  place(index: number, x: number, z: number, width: number, depth = width, turn = 0, lift = 0.02) {
    this.#at.set(x, lift, z);
    this.#turn.setFromAxisAngle(this.#up, turn);
    this.#size.set(width, 1, depth);
    this.mesh.setMatrixAt(index, this.#matrix.compose(this.#at, this.#turn, this.#size));
  }

  /** After placing: send the new places to the graphics card. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees the mesh (and its texture, unless `keepTexture`, when it's shared). */
  dispose(keepTexture = false): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    if (!keepTexture) material.map?.dispose();
    material.dispose();
    this.mesh.dispose();
  }
}
