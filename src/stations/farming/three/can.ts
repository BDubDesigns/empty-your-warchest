import * as THREE from 'three';

/**
 * The watering can, built in code (only looks): a green-grey body with a rim, a long spout with a
 * rose on its end, and a handle over the top; and the stream, drops falling from the rose to
 * where it's pouring, with a little splash. The can's rose is its origin's reference: `place`
 * puts the rose over a point and tips the can forward while it pours.
 */
export class WateringCan {
  readonly group = new THREE.Group();
  /** The can itself (tipped while pouring), inside the group that's moved about. */
  readonly #body = new THREE.Group();
  readonly #drops: THREE.InstancedMesh;
  readonly #seeds: { phase: number; x: number; z: number }[];
  readonly #matrix = new THREE.Matrix4();
  /** Where the rose is in the body's own space. */
  readonly #rose = new THREE.Vector3();
  #tip = 0;
  #shown = 0;

  constructor(most: number) {
    const metal = new THREE.MeshLambertMaterial({ color: 0x6f8f86 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4d6660 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 14), metal);
    body.position.y = 0.12;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 6, 16), dark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.24;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 6, 12, Math.PI), dark);
    handle.position.set(-0.02, 0.24, 0);
    handle.rotation.y = Math.PI / 2;
    // The spout: from low on the front (+x) out and up, the rose on its end.
    const spoutLength = 0.32;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.026, spoutLength, 8), metal);
    const angle = 0.75;
    const start = new THREE.Vector3(0.12, 0.07, 0);
    const direction = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);
    spout.position.copy(start).addScaledVector(direction, spoutLength / 2);
    spout.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const rose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.06, 10, 1, true), dark);
    this.#rose.copy(start).addScaledVector(direction, spoutLength + 0.02);
    rose.position.copy(this.#rose);
    rose.quaternion.copy(spout.quaternion);
    rose.rotateX(Math.PI);
    this.#body.add(body, rim, handle, spout, rose);
    for (const part of [body, rim, handle, spout, rose]) part.castShadow = true;
    this.group.add(this.#body);
    // Bigger than life, so it reads on a phone over a 1.5 m plot.
    this.#body.scale.setScalar(1.5);

    this.#drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.022, 6, 4),
      new THREE.MeshLambertMaterial({
        color: 0xbfe2f5,
        emissive: 0x2a5a7a,
        transparent: true,
        opacity: 0.85,
      }),
      Math.max(most, 1),
    );
    this.#drops.frustumCulled = false;
    this.#drops.count = 0;
    this.#seeds = Array.from({ length: Math.max(most, 1) }, (_, index) => ({
      phase: (index * 0.618) % 1,
      x: Math.sin(index * 2.4) * 0.05,
      z: Math.cos(index * 2.4) * 0.05,
    }));
  }

  /** The stream: its drops live in the scene, not the can (they fall straight down). */
  get drops(): THREE.Object3D {
    return this.#drops;
  }

  /**
   * Puts the can so its rose is `height` over `target`, tipped forward while `pouring` (eased),
   * and draws the stream: `drops` of them falling onto the target. `time` in seconds.
   */
  place(
    target: THREE.Vector3,
    height: number,
    pouring: boolean,
    drops: number,
    dt: number,
    time: number,
  ): void {
    this.#tip += ((pouring ? 1 : 0) - this.#tip) * (1 - Math.exp(-dt * 14));
    this.#body.rotation.z = -0.15 - this.#tip * 0.55;
    this.#body.updateMatrix();
    const rose = this.#rose.clone().applyMatrix4(this.#body.matrix);
    this.group.position.set(target.x - rose.x, target.y + height - rose.y, target.z - rose.z);
    this.group.updateMatrixWorld(true);
    // The stream thickens as the can tips.
    this.#shown = pouring ? Math.min(this.#tip * 1.4, 1) : 0;
    const shown = Math.round(Math.min(drops, this.#seeds.length) * this.#shown);
    const from = this.#rose.clone().applyMatrix4(this.#body.matrixWorld);
    const fall = from.y - target.y;
    for (let index = 0; index < shown; index++) {
      const seed = this.#seeds[index];
      if (!seed) continue;
      const t = (time * 2.2 + seed.phase) % 1;
      // Falling faster as it goes (gravity), spreading a little from the rose.
      const at = new THREE.Vector3(
        from.x + seed.x * (0.4 + t),
        from.y - fall * t * t,
        from.z + seed.z * (0.4 + t),
      );
      const stretch = 0.8 + t * 1.6;
      this.#matrix.compose(at, new THREE.Quaternion(), new THREE.Vector3(0.8, stretch, 0.8));
      this.#drops.setMatrixAt(index, this.#matrix);
    }
    this.#drops.count = shown;
    this.#drops.instanceMatrix.needsUpdate = true;
  }

  /** Hides the stream (the can's put away). */
  stopStream(): void {
    this.#tip = 0;
    this.#drops.count = 0;
  }
}
