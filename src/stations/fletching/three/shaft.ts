import * as THREE from 'three';
import { dusterModel } from '../../../app/warchestHud';
import { Rng } from '../../../core';
import { COLORS, FEATHER_COLORS, vaneGeometry } from './bench';

const DEG = Math.PI / 180;

/** Where the vanes start along the shaft from its back end, as a share of the tar length. */
const VANE_START = 0.12;

/** How the shaft draws: sizes from the data's looks. */
export interface ShaftLook {
  length: number;
  radius: number;
  tarLength: number;
  featherLength: number;
}

interface SlidingVane {
  mesh: THREE.Mesh;
  vy: number;
  spin: number;
}

/**
 * The shaft on the bench, built in code: pale wood with a fire-hardened point, its marks painted
 * round its back end, the tar coat (as long as the rules' tar level says), the green band while
 * it's being dipped, globs once there's too much, and the feathers as they're slapped on where the
 * taps put them. Its group's origin is the shaft's back end, the shaft running up its +y; the
 * spinner turns it about that, by the rules' turn (0° of the shaft's own is its group's +z).
 */
export class ShaftRig {
  readonly group = new THREE.Group();
  readonly #spinner = new THREE.Group();
  readonly #look: ShaftLook;
  readonly #tar: THREE.Mesh;
  readonly #band: THREE.Group;
  readonly #globs: THREE.Group;
  readonly #vaneGeometry: THREE.BufferGeometry;
  readonly #vaneMaterials: THREE.Material[];
  readonly #vanes: THREE.Mesh[] = [];
  #sliding: SlidingVane[] = [];
  /** The feather in the fletcher's fingers, waiting over the top. */
  readonly hand: THREE.Mesh;
  #duster: THREE.Object3D | undefined;
  #dusterFeathers = -1;
  readonly #wood: THREE.Group;
  readonly #collar: THREE.Group;

  constructor(look: ShaftLook, marks: number) {
    this.#look = look;
    const { length, radius, tarLength } = look;
    this.group.add(this.#spinner);
    this.#wood = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length * 0.94, 10).translate(0, length * 0.47, 0),
      new THREE.MeshLambertMaterial({ color: COLORS.shaft }),
    );
    // Fire-hardened: a charred, sharpened tip.
    const point = new THREE.Mesh(
      new THREE.ConeGeometry(radius, length * 0.06, 10).translate(0, length * 0.97, 0),
      new THREE.MeshLambertMaterial({ color: COLORS.point, flatShading: true }),
    );
    // The nock, a dark slot at the back end.
    const nock = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.5, radius * 1.4, radius * 2.2).translate(0, radius * 0.4, 0),
      new THREE.MeshBasicMaterial({ color: 0x2a1c10 }),
    );
    this.#wood.add(shaft, point, nock);
    // The marks: a yellow stripe at each, along where its feather goes.
    const markGeometry = new THREE.BoxGeometry(radius * 0.55, look.featherLength, radius * 0.3);
    // Standing just proud of the tar, so they show through it.
    markGeometry.translate(0, tarLength * VANE_START + look.featherLength / 2, radius * 1.3);
    const markMaterial = new THREE.MeshBasicMaterial({ color: COLORS.mark });
    // The jig's index wheel the back end sits in, turning with it: its marks line up with the
    // shaft's, a yellow peg at each on its rim, so they go round like a clock's hands.
    this.#collar = new THREE.Group();
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.75, radius * 1.75, radius * 0.5, 24).translate(
        0,
        -radius * 0.45,
        0,
      ),
      new THREE.MeshLambertMaterial({ color: COLORS.benchDark }),
    );
    const pegGeometry = new THREE.BoxGeometry(radius * 0.6, radius * 0.2, radius * 0.9).translate(
      0,
      -radius * 0.75,
      radius * 1.35,
    );
    this.#collar.add(wheel);
    for (let mark = 0; mark < marks; mark++) {
      const stripe = new THREE.Mesh(markGeometry, markMaterial);
      stripe.rotation.y = (360 / marks) * mark * DEG;
      this.#wood.add(stripe);
      const peg = new THREE.Mesh(pegGeometry, markMaterial);
      peg.rotation.y = (360 / marks) * mark * DEG;
      this.#collar.add(peg);
    }
    this.#collar.visible = false;
    this.#spinner.add(this.#wood, this.#collar);
    // The tar: a glossy black coat from the back end, scaled to the level.
    this.#tar = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.22, radius * 1.22, 1, 10).translate(0, 0.5, 0),
      new THREE.MeshPhongMaterial({ color: COLORS.tar, shininess: 90, specular: 0x666666 }),
    );
    this.#tar.scale.y = 0.0001;
    this.#spinner.add(this.#tar);
    // The green band: a see-through sleeve, rimmed top and bottom.
    this.#band = new THREE.Group();
    this.#spinner.add(this.#band);
    // Globs of too much tar.
    this.#globs = new THREE.Group();
    const globMaterial = new THREE.MeshPhongMaterial({ color: COLORS.tar, shininess: 100 });
    const rng = new Rng(5);
    for (let index = 0; index < 6; index++) {
      const glob = new THREE.Mesh(
        new THREE.SphereGeometry(radius * rng.range(0.45, 0.7), 8, 6),
        globMaterial,
      );
      const angle = rng.range(0, Math.PI * 2);
      glob.position.set(Math.sin(angle) * radius * 1.3, 0, Math.cos(angle) * radius * 1.3);
      glob.scale.y = rng.range(1.3, 2.2);
      glob.userData.share = rng.range(0.35, 1);
      this.#globs.add(glob);
    }
    this.#globs.visible = false;
    this.#spinner.add(this.#globs);
    this.#vaneGeometry = vaneGeometry(look.featherLength, radius * 1.9);
    this.#vaneMaterials = [COLORS.cock, COLORS.vane, COLORS.vane].map(
      (color) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
    );
    this.hand = new THREE.Mesh(this.#vaneGeometry, this.#vaneMaterials[0]);
    this.hand.visible = false;
    this.group.add(this.hand);
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
  }

  /** A fresh shaft: no tar, no feathers. */
  reset(): void {
    for (const vane of this.#vanes) this.#spinner.remove(vane);
    for (const vane of this.#sliding) this.group.remove(vane.mesh);
    this.#vanes.length = 0;
    this.#sliding = [];
    this.setTar(0, false);
    this.showBand(undefined);
    this.#spinner.rotation.y = 0;
    this.#wood.visible = true;
    this.#tar.visible = true;
    if (this.#duster) this.#duster.visible = false;
    this.group.visible = true;
  }

  /** The tar coat at `level` (0 to 1 of the tar length), globbed if there's too much. */
  setTar(level: number, globs: boolean): void {
    const coat = Math.max(level, 0) * this.#look.tarLength;
    this.#tar.scale.y = Math.max(coat, 0.0001);
    this.#globs.visible = globs;
    for (const glob of this.#globs.children) {
      glob.position.y = coat * (glob.userData.share as number);
    }
  }

  /** The green band from `low` to `high` of the tar length, or none. */
  showBand(band: { low: number; high: number } | undefined): void {
    this.#band.clear();
    if (!band || band.high <= band.low) return;
    const { radius, tarLength } = this.#look;
    const from = band.low * tarLength;
    const to = band.high * tarLength;
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.9, radius * 1.9, to - from, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: COLORS.band,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    sleeve.position.y = (from + to) / 2;
    const rimMaterial = new THREE.MeshBasicMaterial({ color: COLORS.band });
    for (const y of [from, to]) {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 2.1, radius * 0.28, 4, 18),
        rimMaterial,
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      this.#band.add(rim);
    }
    this.#band.add(sleeve);
  }

  /** Shows the jig's index wheel at the back end (only while it's in the jig). */
  showCollar(shown: boolean): void {
    this.#collar.visible = shown;
  }

  /** Turns the shaft to `turn` degrees (the rules'). */
  setTurn(turn: number): void {
    this.#spinner.rotation.y = turn * DEG;
  }

  /** Slaps the `index`th feather on at `angle` (degrees, the shaft's own). */
  addVane(angle: number, index: number): void {
    const vane = new THREE.Mesh(
      this.#vaneGeometry,
      this.#vaneMaterials[index % this.#vaneMaterials.length],
    );
    vane.position.y = this.#look.tarLength * VANE_START;
    vane.position.z = 0;
    vane.rotation.y = angle * DEG;
    // Out from the shaft's surface.
    vane.translateZ(this.#look.radius * 0.9);
    vane.castShadow = true;
    this.#spinner.add(vane);
    this.#vanes.push(vane);
  }

  /** Too little tar: the feathers let go and slide off. */
  slideVanes(): void {
    for (const vane of this.#vanes) {
      vane.updateMatrixWorld();
      this.group.attach(vane);
      this.#sliding.push({ mesh: vane, vy: 0, spin: (Math.random() - 0.5) * 6 });
    }
    this.#vanes.length = 0;
  }

  /** Swaps the shaft for a feather duster (the bucket), with `feathers` of them. */
  showDuster(feathers: number): void {
    if (!this.#duster || this.#dusterFeathers !== feathers) {
      if (this.#duster) this.group.remove(this.#duster);
      const duster = dusterModel(feathers);
      // Lying along z, its point to +z, about 1 long: stood up the shaft, its back end at 0.
      duster.rotation.x = -Math.PI / 2;
      duster.scale.setScalar(this.#look.length / 0.95);
      duster.position.y = this.#look.length * 0.47;
      this.#duster = duster;
      this.#dusterFeathers = feathers;
      this.group.add(duster);
    }
    this.#duster.visible = true;
    this.#wood.visible = false;
    this.#tar.visible = false;
    this.#globs.visible = false;
    for (const vane of this.#vanes) vane.visible = false;
  }

  /** Feathers sliding off fall down the shaft and away. */
  update(dt: number): void {
    this.#sliding = this.#sliding.filter((vane) => {
      vane.vy -= 2.5 * dt;
      vane.mesh.position.y += vane.vy * dt;
      vane.mesh.rotation.z += vane.spin * dt;
      if (vane.mesh.position.y < -0.4) {
        this.group.remove(vane.mesh);
        return false;
      }
      return true;
    });
  }

  /** Where along the shaft (from its back end) the feathers go, middle of them. */
  get fletchingMiddle(): number {
    return this.#look.tarLength * VANE_START + this.#look.featherLength / 2;
  }

  /** A feather colour, for puffs. */
  static featherColor(index: number): number {
    return FEATHER_COLORS[index % FEATHER_COLORS.length] ?? 0xffffff;
  }
}
