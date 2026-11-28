import * as THREE from 'three';
import { arrowModel, dusterModel } from '../../../app/warchestHud';

/**
 * The wooden starter bow, built in code, as you hold it at the bottom of the screen: lying in the
 * screen's plane with the arrow pointing up its local +y (the shot), its limbs out to the sides
 * and the string below the grip. Drawing pulls the string (and the nocked arrow) back and bends
 * the limbs further. `size` is the bow's span tip to tip. Turn its group to aim.
 */

/** In shares of the bow's size. */
const LIMB_BEND = 0.16;
const DRAW_BEND = 0.16;
/** How far the string sits behind the grip at rest, and how far a full draw pulls it. */
const BRACE = 0.12;
const DRAW_LENGTH = 0.42;
const LIMB_RADIUS = 0.017;
const STRING_RADIUS = 0.0035;
const ARROW_LENGTH = 0.9;

/** The kinds of arrow the bow can have on its string. */
export type NockedArrow = 'fletched' | 'bare' | 'duster';

export class Bow {
  readonly group = new THREE.Group();
  readonly #size: number;
  readonly #limbs: THREE.Mesh;
  readonly #wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2e, flatShading: true });
  readonly #strings: [THREE.Mesh, THREE.Mesh];
  readonly #arrows: Record<NockedArrow, THREE.Object3D>;
  #draw = -1;
  #nocked: NockedArrow | undefined;

  constructor(size: number) {
    this.#size = size;
    this.#limbs = new THREE.Mesh(new THREE.BufferGeometry(), this.#wood);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(
        LIMB_RADIUS * 1.9 * size,
        LIMB_RADIUS * 1.9 * size,
        0.15 * size,
        8,
      ),
      new THREE.MeshLambertMaterial({ color: 0x3b2416 }),
    );
    grip.rotation.z = Math.PI / 2;
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
    const nocked = (kind: NockedArrow) => {
      const arrow = new THREE.Group();
      const model = kind === 'duster' ? dusterModel(14) : arrowModel(kind === 'fletched');
      // Pointing up the bow (+y), its back end at the group's origin (the nock).
      model.rotation.x = -Math.PI / 2;
      model.position.y = 0.44;
      arrow.add(model);
      arrow.scale.setScalar(ARROW_LENGTH * size);
      arrow.visible = false;
      return arrow;
    };
    this.#arrows = { fletched: nocked('fletched'), bare: nocked('bare'), duster: nocked('duster') };
    this.group.add(this.#limbs, grip, ...this.#strings, ...Object.values(this.#arrows));
    this.setDraw(0);
  }

  /** Which arrow is on the string, if any. */
  setArrow(kind: NockedArrow | undefined): void {
    this.#nocked = kind;
    for (const [name, arrow] of Object.entries(this.#arrows)) arrow.visible = name === kind;
  }

  get nocked(): NockedArrow | undefined {
    return this.#nocked;
  }

  /** Draws the bow to `draw` (0 at rest, 1 full): the limbs bend, the string comes back. */
  setDraw(draw: number): void {
    const d = Math.min(Math.max(draw, 0), 1);
    if (Math.abs(d - this.#draw) < 0.002) return;
    this.#draw = d;
    const size = this.#size;
    const half = 0.5 * size * (1 - 0.1 * d);
    const bend = (LIMB_BEND + DRAW_BEND * d) * size;
    // One curve, tip to tip through the grip: the limbs sweep back toward the string.
    const points = Array.from({ length: 13 }, (_, index) => {
      const t = index / 6 - 1;
      return new THREE.Vector3(t * half, -bend * t * t, 0);
    });
    const curve = new THREE.CatmullRomCurve3(points);
    this.#limbs.geometry.dispose();
    this.#limbs.geometry = new THREE.TubeGeometry(curve, 24, LIMB_RADIUS * size, 6, false);
    const tipY = -bend;
    const nock = new THREE.Vector3(0, tipY - BRACE * size - DRAW_LENGTH * size * d, 0);
    [-1, 1].forEach((side, index) => {
      const string = this.#strings[index];
      if (!string) return;
      const tip = new THREE.Vector3(side * half, tipY, 0);
      const length = tip.distanceTo(nock);
      string.position.copy(tip).add(nock).multiplyScalar(0.5);
      string.scale.set(1, length, 1);
      string.rotation.z = Math.atan2(nock.y - tip.y, nock.x - tip.x) - Math.PI / 2;
    });
    for (const arrow of Object.values(this.#arrows)) arrow.position.copy(nock);
  }

  /** Where the nocked arrow's point is, in the bow's group (the shot leaves from here). */
  get point(): THREE.Vector3 {
    return this.#arrows.fletched.position
      .clone()
      .add(new THREE.Vector3(0, ARROW_LENGTH * this.#size, 0));
  }
}
