import * as THREE from 'three';
import { arrowModel } from '../../../app/warchestHud';

/** The wooden bow: Quaternius's (CC0, built by tools/archery/build_bow.py). */
export const BOW_MODEL = 'models/quaternius/bow_wooden.glb';

/**
 * The wooden starter bow as you hold it at the bottom of the screen: lying in the screen's plane
 * with the arrow pointing up its local +y (the shot), the limbs out to the sides and the string
 * below the grip. The model (`BOW_MODEL`, 1 across tip to tip, its string left out) is bent as you
 * draw: its limbs flex back toward you, the tips draw in, and the string, drawn here, comes back
 * from the tips to the nocked arrow. On release the string snaps forward past rest and rings out.
 * `size` is the bow's span tip to tip. Turn its group to aim.
 */

/** In shares of the bow's span: how far the tips flex back at a full draw, and the draw length. */
const FLEX = 0.11;
const DRAW_LENGTH = 0.42;
const STRING_RADIUS = 0.0035;
const ARROW_LENGTH = 0.9;

interface Limb {
  mesh: THREE.Mesh;
  rest: Float32Array;
}

export class Bow {
  readonly group = new THREE.Group();
  readonly #size: number;
  readonly #limbs: Limb[] = [];
  /** Where the string meets each tip, at rest (in the model's units). */
  readonly #nocks: THREE.Vector3[];
  readonly #strings: [THREE.Mesh, THREE.Mesh];
  readonly #arrows: Record<'fletched' | 'bare', THREE.Object3D>;
  #key = '';
  #nocked: 'fletched' | 'bare' | undefined;

  /** `model` is the loaded `BOW_MODEL` (shared: it's cloned). */
  constructor(size: number, model: THREE.Object3D) {
    this.#size = size;
    const bow = model.clone(true);
    bow.scale.setScalar(size);
    const meshes: THREE.Mesh[] = [];
    bow.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child as THREE.Mesh);
    });
    for (const mesh of meshes) {
      // Its own copy, to bend.
      const geometry = mesh.geometry.clone();
      mesh.geometry = geometry;
      const position = geometry.getAttribute('position');
      this.#limbs.push({ mesh, rest: Float32Array.from(position.array as ArrayLike<number>) });
    }
    const nock = (name: string, fallback: THREE.Vector3) =>
      bow.getObjectByName(name)?.position.clone() ?? fallback;
    this.#nocks = [
      nock('nock_bottom', new THREE.Vector3(-0.48, -0.19, 0)),
      nock('nock_top', new THREE.Vector3(0.46, -0.18, 0)),
    ];
    const stringMaterial = new THREE.MeshBasicMaterial({ color: 0xf1e9d6 });
    const stringGeometry = new THREE.CylinderGeometry(
      STRING_RADIUS * size,
      STRING_RADIUS * size,
      1,
      4,
    );
    this.#strings = [
      new THREE.Mesh(stringGeometry, stringMaterial),
      new THREE.Mesh(stringGeometry, stringMaterial),
    ];
    const nocked = (fletched: boolean) => {
      const arrow = new THREE.Group();
      const arrowMesh = arrowModel(fletched);
      // Pointing up the bow (+y), its back end (the nock) at the group's origin.
      arrowMesh.rotation.x = -Math.PI / 2;
      arrowMesh.position.y = 0.44;
      arrow.add(arrowMesh);
      arrow.scale.setScalar(ARROW_LENGTH * size);
      arrow.visible = false;
      return arrow;
    };
    this.#arrows = { fletched: nocked(true), bare: nocked(false) };
    this.group.add(bow, ...this.#strings, this.#arrows.fletched, this.#arrows.bare);
    this.setDraw(0);
  }

  /** Which arrow is on the string, if any. */
  setArrow(kind: 'fletched' | 'bare' | undefined): void {
    this.#nocked = kind;
    this.#arrows.fletched.visible = kind === 'fletched';
    this.#arrows.bare.visible = kind === 'bare';
  }

  get nocked(): 'fletched' | 'bare' | undefined {
    return this.#nocked;
  }

  /**
   * Draws the bow to `draw` (0 at rest, 1 full): the limbs flex, the string comes back. `snap`
   * pushes the string forward past rest (a share of a full draw), as it rings after a release.
   */
  setDraw(draw: number, snap = 0): void {
    const d = Math.min(Math.max(draw, 0), 1);
    const key = `${d.toFixed(3)}:${snap.toFixed(3)}`;
    if (key === this.#key) return;
    this.#key = key;
    const flex = (x: number, y: number, out: THREE.Vector3) => {
      // Further along the limb bends more: the tips flex back toward the string and draw in.
      const t = Math.min(Math.abs(x) / 0.5, 1);
      return out.set(x * (1 - 0.06 * d * t * t), y - FLEX * d * t * t, 0);
    };
    const bent = new THREE.Vector3();
    for (const limb of this.#limbs) {
      const position = limb.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const rest = limb.rest;
      for (let index = 0; index < position.count; index++) {
        const x = rest[index * 3] ?? 0;
        flex(x, rest[index * 3 + 1] ?? 0, bent);
        position.setXYZ(index, bent.x, bent.y, rest[index * 3 + 2] ?? 0);
      }
      position.needsUpdate = true;
      limb.mesh.geometry.computeBoundingSphere();
    }
    const size = this.#size;
    const tips = this.#nocks.map((nock) =>
      flex(nock.x, nock.y, new THREE.Vector3()).multiplyScalar(size),
    );
    const restY = ((this.#nocks[0]?.y ?? 0) + (this.#nocks[1]?.y ?? 0)) / 2;
    const nock = new THREE.Vector3(0, (restY - DRAW_LENGTH * (d - snap)) * size, 0);
    tips.forEach((tip, index) => {
      const string = this.#strings[index];
      if (!string) return;
      string.position.copy(tip).add(nock).multiplyScalar(0.5);
      string.scale.set(1, tip.distanceTo(nock), 1);
      string.rotation.z = Math.atan2(nock.y - tip.y, nock.x - tip.x) - Math.PI / 2;
    });
    for (const arrow of Object.values(this.#arrows)) arrow.position.copy(nock);
  }
}
