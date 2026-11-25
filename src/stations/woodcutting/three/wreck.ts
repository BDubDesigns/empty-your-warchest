import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { Rng } from '../../../core';
import type { CabinPart, CabinPartKind } from './cabin';

/**
 * The cabin coming down when it's hit: every part becomes a physics body that falls, tumbles and
 * piles up on the others. Only looks: the rules have already called the crash and its cost.
 *
 * Physics engine: cannon-es (pure JavaScript, ~40 KB gzipped), plenty for a few dozen boxes for a
 * few seconds. It's no longer updated, but stable. If other mini games come to need physics (the
 * runner, say), Rapier is the stronger engine (maintained, better stacking) at the cost of a
 * ~0.5 MB+ WebAssembly download; that option is noted in Notion (Tech & Platform).
 */

/** The wreck's tuning (from the woodcutting feel). */
export interface WreckFeel {
  crashPush: number;
  crashShove: number;
  crashGravity: number;
  crashFriction: number;
  crashBounce: number;
}

/** Collision groups: the chimney's stones start through the roof, so those two never collide. */
const GROUP = { wood: 1, roof: 2, stone: 4, ground: 8, pusher: 16 } as const;
const KIND_GROUP: Record<CabinPartKind, number> = {
  log: GROUP.wood,
  door: GROUP.wood,
  roof: GROUP.roof,
  stone: GROUP.stone,
};
const MASK: Record<CabinPartKind, number> = {
  log: GROUP.wood | GROUP.roof | GROUP.stone | GROUP.ground | GROUP.pusher,
  door: GROUP.wood | GROUP.roof | GROUP.stone | GROUP.ground | GROUP.pusher,
  roof: GROUP.wood | GROUP.roof | GROUP.ground | GROUP.pusher,
  stone: GROUP.wood | GROUP.stone | GROUP.ground | GROUP.pusher,
};
/** Parts within this distance (world units) of the hit are pushed by it, falling off with it. */
const PUSH_REACH = 2.5;
/** Physics steps this long (seconds), at most this many per frame. */
const STEP = 1 / 60;
const MAX_STEPS = 4;
/** The wreck stops moving after this long, settled or not. */
const MAX_SECONDS = 8;

interface CollideEvent {
  contact: CANNON.ContactEquation;
}

/** Fired when a part knocks into something: where, how hard (world units a second), and what. */
export type KnockListener = (at: THREE.Vector3, speed: number, kind: CabinPartKind) => void;

export class Wreck {
  readonly #world = new CANNON.World();
  readonly #pieces: { mesh: THREE.Object3D; body: CANNON.Body }[] = [];
  #pusher: CANNON.Body | undefined;
  #pusherAt: CANNON.Vec3 | undefined;
  #age = 0;
  /** Slowest physics step so far (ms), for the log. */
  slowestStepMs = 0;

  /**
   * Breaks `parts` loose into `root` (which must sit at the world's origin), pushed away from
   * `hit` along `direction` (world, flat), every part thrown out from `middle` (the cabin's centre
   * on the ground) as the walls splay and the roof drops in.
   */
  constructor(
    root: THREE.Object3D,
    parts: readonly CabinPart[],
    hit: THREE.Vector3,
    direction: THREE.Vector3,
    middle: THREE.Vector3,
    feel: WreckFeel,
    rng: Rng,
    onKnock: KnockListener,
  ) {
    const world = this.#world;
    world.gravity.set(0, -feel.crashGravity, 0);
    world.allowSleep = true;
    world.defaultContactMaterial.friction = feel.crashFriction;
    world.defaultContactMaterial.restitution = feel.crashBounce;
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.collisionFilterGroup = GROUP.ground;
    world.addBody(ground);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const part of parts) {
      part.mesh.updateWorldMatrix(true, false);
      part.mesh.matrixWorld.decompose(position, quaternion, scale);
      root.attach(part.mesh);
      const body = new CANNON.Body({
        mass: part.mass,
        shape: new CANNON.Box(new CANNON.Vec3(part.half.x, part.half.y, part.half.z)),
        position: new CANNON.Vec3(position.x, position.y, position.z),
        quaternion: new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
        linearDamping: 0.05,
        angularDamping: 0.1,
      });
      body.collisionFilterGroup = KIND_GROUP[part.kind];
      body.collisionFilterMask = MASK[part.kind];
      body.sleepSpeedLimit = 0.15;
      body.sleepTimeLimit = 0.6;
      // Pushed hard near the hit, along the fall and down into the cabin. Every part is thrown
      // out from the middle too, the higher the harder, so the walls splay and the whole cabin
      // comes down, not just the part that was hit (stacked logs are otherwise very stable).
      const near = Math.max(1 - position.distanceTo(hit) / PUSH_REACH, 0);
      const push = feel.crashPush * near;
      const out = new THREE.Vector3(position.x - middle.x, 0, position.z - middle.z);
      if (out.lengthSq() < 1e-6) out.set(rng.range(-1, 1), 0, rng.range(-1, 1));
      out.normalize().multiplyScalar(feel.crashShove * (0.25 + position.y) * rng.range(0.6, 1.2));
      body.velocity.set(
        direction.x * push + out.x,
        -push * 0.4 + rng.range(0, 0.4) * feel.crashShove,
        direction.z * push + out.z,
      );
      body.angularVelocity.set(
        rng.range(-1, 1) * feel.crashShove * (1 + near * 2),
        rng.range(-1, 1) * feel.crashShove,
        rng.range(-1, 1) * feel.crashShove * (1 + near * 2),
      );
      body.addEventListener('collide', (event: CollideEvent) => {
        const speed = Math.abs(event.contact.getImpactVelocityAlongNormal());
        onKnock(
          new THREE.Vector3(body.position.x, body.position.y, body.position.z),
          speed,
          part.kind,
        );
      });
      world.addBody(body);
      this.#pieces.push({ mesh: part.mesh, body });
    }
  }

  /** Whether the wreck has come to rest (or run out of time). */
  get settled(): boolean {
    return (
      this.#age >= MAX_SECONDS ||
      this.#pieces.every((piece) => piece.body.sleepState === CANNON.Body.SLEEPING)
    );
  }

  /**
   * Moves the trunk that hit the cabin (a box `half` in size, centred at `center`, turned by
   * `quaternion`) so it keeps pushing the rubble down as it sinks into it.
   */
  setPusher(center: THREE.Vector3, quaternion: THREE.Quaternion, half: THREE.Vector3, dt: number) {
    if (!this.#pusher) {
      this.#pusher = new CANNON.Body({
        type: CANNON.Body.KINEMATIC,
        shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)),
      });
      this.#pusher.collisionFilterGroup = GROUP.pusher;
      this.#world.addBody(this.#pusher);
    }
    const pusher = this.#pusher;
    const at = new CANNON.Vec3(center.x, center.y, center.z);
    // Its speed, so what it hits is shoved, not just nudged out of the way.
    if (this.#pusherAt && dt > 0) {
      pusher.velocity.copy(at.vsub(this.#pusherAt).scale(1 / dt));
    }
    this.#pusherAt = at;
    pusher.position.copy(at);
    pusher.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }

  step(dt: number): void {
    if (dt <= 0 || this.settled) return;
    this.#age += dt;
    const started = performance.now();
    this.#world.step(STEP, dt, MAX_STEPS);
    this.slowestStepMs = Math.max(this.slowestStepMs, performance.now() - started);
    for (const { mesh, body } of this.#pieces) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    }
  }

  /** Seconds since the crash (physics time). */
  get age(): number {
    return this.#age;
  }
}
