import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flapAngle, wingGeometry, type WingShape } from '../../../app/birdWings';
import type { ArcheryBird, BirdShape } from '../../../data';

/**
 * The bird hunt's birds, built in code and told apart by colour and silhouette: a plump yellow
 * finch with a black cap, a crested blue jay with a long tail, a long black crow with broad wings.
 * Each is sized from its hit radius (what you see is what counts) and drawn in three parts: the
 * body (one merged mesh in vertex colours) and two wings that beat. It flies toward its +z, with
 * its back up (+y) and wings out along ±x.
 */

/** One part of a body: a shape, where it sits (in hit radii), and which colour of the look. */
interface Part {
  geometry: THREE.BufferGeometry;
  at: [number, number, number];
  scale?: [number, number, number];
  /** Turned about x (radians), e.g. a crest raked back. */
  tilt?: number;
  color: 'body' | 'wing' | 'belly' | 'beak';
}

const sphere = () => new THREE.SphereGeometry(1, 9, 6);
/** A cone pointing along +z. */
const cone = (radius: number, length: number) =>
  new THREE.ConeGeometry(radius, length, 6).rotateX(Math.PI / 2);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

const SHAPES: Record<BirdShape, { parts: Part[]; wing: WingShape }> = {
  finch: {
    parts: [
      { geometry: sphere(), at: [0, 0, 0], scale: [0.5, 0.46, 0.68], color: 'body' },
      { geometry: sphere(), at: [0, -0.12, 0.05], scale: [0.42, 0.34, 0.55], color: 'belly' },
      { geometry: sphere(), at: [0, 0.2, 0.56], scale: [0.32, 0.32, 0.32], color: 'body' },
      // A goldfinch's black cap.
      { geometry: sphere(), at: [0, 0.34, 0.6], scale: [0.2, 0.12, 0.22], color: 'wing' },
      { geometry: cone(0.1, 0.24), at: [0, 0.16, 0.9], color: 'beak' },
      { geometry: box(0.24, 0.05, 0.5), at: [0, 0.06, -0.78], color: 'wing' },
    ],
    wing: { span: 1.25, front: 0.32, back: 0.18, sweep: 0.38 },
  },
  jay: {
    parts: [
      { geometry: sphere(), at: [0, 0, 0], scale: [0.44, 0.42, 0.78], color: 'body' },
      { geometry: sphere(), at: [0, -0.13, 0.08], scale: [0.36, 0.3, 0.6], color: 'belly' },
      { geometry: sphere(), at: [0, 0.2, 0.64], scale: [0.3, 0.3, 0.3], color: 'body' },
      // The crest, raked back.
      { geometry: cone(0.14, 0.46), at: [0, 0.44, 0.48], tilt: -2.2, color: 'body' },
      { geometry: cone(0.08, 0.24), at: [0, 0.16, 0.96], color: 'beak' },
      { geometry: box(0.3, 0.05, 1), at: [0, 0.04, -1.05], color: 'wing' },
    ],
    wing: { span: 1.4, front: 0.32, back: 0.22, sweep: 0.46 },
  },
  crow: {
    parts: [
      { geometry: sphere(), at: [0, 0, 0], scale: [0.42, 0.4, 0.95], color: 'body' },
      { geometry: sphere(), at: [0, -0.1, 0.05], scale: [0.36, 0.3, 0.8], color: 'belly' },
      { geometry: sphere(), at: [0, 0.12, 0.86], scale: [0.3, 0.28, 0.32], color: 'body' },
      // A heavy, long beak.
      { geometry: cone(0.12, 0.44), at: [0, 0.08, 1.3], color: 'beak' },
      // The wedge tail: wide at its end.
      {
        geometry: cone(0.34, 0.7).scale(1, 0.12, 1).rotateY(Math.PI),
        at: [0, 0, -1.15],
        color: 'wing',
      },
    ],
    wing: { span: 1.75, front: 0.42, back: 0.36, sweep: 0.3, tipWidth: 0.55 },
  },
};

export interface BirdModel {
  group: THREE.Group;
  wings: [THREE.Mesh, THREE.Mesh];
  flapHz: number;
}

/** One kind of bird's geometry and materials, shared by every bird of that kind in a round. */
export class BirdKit {
  readonly #body: THREE.BufferGeometry;
  readonly #bodyMaterial: THREE.MeshLambertMaterial;
  readonly #wing: THREE.BufferGeometry;
  readonly #wingMaterial: THREE.MeshLambertMaterial;
  readonly #flapHz: number;

  /** `radius` is the bird's hit radius on the field: the model is built to it. */
  constructor(bird: ArcheryBird, radius: number) {
    const shape = SHAPES[bird.look.shape];
    const colors = {
      body: new THREE.Color(bird.look.body),
      wing: new THREE.Color(bird.look.wing),
      belly: new THREE.Color(bird.look.belly),
      beak: new THREE.Color(bird.look.beak),
    };
    const pieces = shape.parts.map((part) => {
      const geometry = part.geometry.clone().deleteAttribute('uv');
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...part.at).multiplyScalar(radius),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(part.tilt ?? 0, 0, 0)),
        new THREE.Vector3(...(part.scale ?? [1, 1, 1])).multiplyScalar(radius),
      );
      geometry.applyMatrix4(matrix);
      const color = colors[part.color];
      const count = geometry.getAttribute('position').count;
      const rgb = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) color.toArray(rgb, index * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      return geometry.index ? geometry.toNonIndexed() : geometry;
    });
    const merged = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    this.#body = merged;
    this.#bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const wing = shape.wing;
    this.#wing = wingGeometry({
      span: wing.span * radius,
      front: wing.front * radius,
      back: wing.back * radius,
      sweep: wing.sweep * radius,
      tipWidth: (wing.tipWidth ?? 0) * radius,
    });
    this.#wingMaterial = new THREE.MeshLambertMaterial({
      color: colors.wing,
      side: THREE.DoubleSide,
    });
    this.#flapHz = bird.look.flapHz;
  }

  make(): BirdModel {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.#body, this.#bodyMaterial));
    const left = new THREE.Mesh(this.#wing, this.#wingMaterial);
    const right = new THREE.Mesh(this.#wing, this.#wingMaterial);
    right.scale.x = -1;
    group.add(left, right);
    return { group, wings: [left, right], flapHz: this.#flapHz };
  }

  dispose(): void {
    this.#body.dispose();
    this.#bodyMaterial.dispose();
    this.#wing.dispose();
    this.#wingMaterial.dispose();
  }
}

/** Beats a bird's wings `age` seconds in, `beat` times as fast as it flaps (a scared one panics). */
export function flap(model: BirdModel, age: number, beat = 1): void {
  const angle = flapAngle(age, model.flapHz * beat);
  model.wings[0].rotation.z = angle;
  model.wings[1].rotation.z = -angle;
}
