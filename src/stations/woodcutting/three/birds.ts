import * as THREE from 'three';
import type { Rng } from '../../../core';

/**
 * Birds startled out of the forest by a crash: a small flock bursts from a treetop, flapping up
 * and away, and is gone. Only looks. Each bird is two dark wings, built in code.
 */

interface Bird {
  body: THREE.Group;
  wings: [THREE.Mesh, THREE.Mesh];
  velocity: THREE.Vector3;
  flap: number;
  age: number;
}

const WING_SPAN = 0.2;
const COLOR = 0x2d2824;

export class Birds {
  readonly group = new THREE.Group();
  #birds: Bird[] = [];
  #seconds: number;
  readonly #wing: THREE.BufferGeometry;
  readonly #material = new THREE.MeshBasicMaterial({ color: COLOR, side: THREE.DoubleSide });

  constructor(seconds: number) {
    this.#seconds = seconds;
    // One wing: a swept triangle from the body out to its tip.
    this.#wing = new THREE.BufferGeometry();
    this.#wing.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0.05, 0, 0, -0.04, WING_SPAN / 2, 0, -0.06], 3),
    );
    this.#wing.computeVertexNormals();
  }

  /**
   * A flock of `count` from `from` (a treetop), flying away from `away` (the crash) at `speed`
   * world units a second, and up.
   */
  burst(rng: Rng, from: THREE.Vector3, away: THREE.Vector3, count: number, speed: number): void {
    const out = from.clone().sub(away).setY(0);
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    out.normalize();
    for (let index = 0; index < count; index++) {
      const body = new THREE.Group();
      const left = new THREE.Mesh(this.#wing, this.#material);
      const right = new THREE.Mesh(this.#wing, this.#material);
      right.scale.x = -1;
      body.add(left, right);
      body.position
        .copy(from)
        .add(new THREE.Vector3(rng.range(-0.5, 0.5), rng.range(-0.3, 0.3), rng.range(-0.5, 0.5)));
      body.scale.setScalar(rng.range(0.8, 1.2));
      const heading = out
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(-0.6, 0.6))
        .multiplyScalar(speed * rng.range(0.8, 1.2))
        .setY(speed * rng.range(0.35, 0.6));
      this.group.add(body);
      this.#birds.push({
        body,
        wings: [left, right],
        velocity: heading,
        flap: rng.range(9, 13),
        age: -rng.range(0, 0.25),
      });
    }
  }

  update(dt: number): void {
    this.#birds = this.#birds.filter((bird) => {
      bird.age += dt;
      if (bird.age < 0) {
        bird.body.visible = false;
        return true;
      }
      bird.body.visible = true;
      if (bird.age >= this.#seconds) {
        this.group.remove(bird.body);
        return false;
      }
      // Climbing hard at first, then levelling off.
      bird.velocity.y *= Math.exp(-dt * 0.8);
      bird.body.position.addScaledVector(bird.velocity, dt);
      bird.body.lookAt(bird.body.position.clone().add(bird.velocity));
      const beat = Math.sin(bird.age * bird.flap * Math.PI * 2) * 0.9;
      bird.wings[0].rotation.z = beat;
      bird.wings[1].rotation.z = -beat;
      return true;
    });
  }

  clear(): void {
    for (const bird of this.#birds) this.group.remove(bird.body);
    this.#birds = [];
  }

  set seconds(seconds: number) {
    this.#seconds = seconds;
  }
}
