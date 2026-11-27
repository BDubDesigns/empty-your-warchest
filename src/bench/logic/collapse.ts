import { Rng } from '../../core/rng';
import type { BenchData } from '../../data/bench';
import type { Physics } from '../../stations/siege/logic/physics';
import type { Placed } from './layout';

// The stress test's collapse: every piece marked to come down is a box in a Rapier world (the
// siege's engine and settings), held still until the collapse, then let go with a push away from
// a blast by the gate, so the fort falls the same way every run.

type Collapse = BenchData['collapse'];

/** Where a body is: its middle, and its turn as a quaternion (x, y, z, w). */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export class CollapseSim {
  readonly #physics: Physics;
  readonly #world: InstanceType<Physics['World']>;
  readonly #bodies: ReturnType<InstanceType<Physics['World']>['createRigidBody']>[] = [];
  readonly #settings: Collapse;
  readonly #blasts: readonly (readonly [number, number, number])[];
  readonly #copies: number[] = [];
  #carry = 0;
  #fallen = false;
  /** Steps taken so far. */
  steps = 0;

  /**
   * One body for each piece in `pieces` (its box `settings.fit` of the piece's size, about its
   * middle); `blasts` is where each copy's blast is.
   */
  constructor(
    physics: Physics,
    pieces: readonly Placed[],
    settings: Collapse,
    blasts: readonly (readonly [number, number, number])[],
  ) {
    this.#physics = physics;
    this.#settings = settings;
    this.#blasts = blasts;
    this.#world = new physics.World({ x: 0, y: -settings.gravity, z: 0 });
    this.#world.timestep = settings.timestep;
    this.#world.numSolverIterations = settings.solverIterations;
    const ground = this.#world.createRigidBody(physics.RigidBodyDesc.fixed());
    this.#world.createCollider(
      physics.ColliderDesc.cuboid(400, 0.5, 400)
        .setTranslation(0, -0.5, 0)
        .setFriction(settings.friction),
      ground,
    );
    for (const piece of pieces) {
      const [w, h, d] = piece.size;
      const half = Math.sin(piece.turn / 2);
      const body = this.#world.createRigidBody(
        physics.RigidBodyDesc.fixed()
          .setTranslation(piece.x, piece.y + h / 2, piece.z)
          .setRotation({ x: 0, y: half, z: 0, w: Math.cos(piece.turn / 2) }),
      );
      const fit = settings.fit / 2;
      this.#world.createCollider(
        physics.ColliderDesc.cuboid(w * fit, h * fit, d * fit)
          .setDensity(settings.density)
          .setFriction(settings.friction)
          .setRestitution(settings.restitution),
        body,
      );
      this.#bodies.push(body);
      this.#copies.push(piece.copy);
    }
  }

  get count(): number {
    return this.#bodies.length;
  }

  get fallen(): boolean {
    return this.#fallen;
  }

  /** Lets every body go, pushed away from its copy's blast (harder the nearer it is). */
  collapse(seed: number): void {
    if (this.#fallen) return;
    this.#fallen = true;
    const rng = new Rng(seed);
    const { push, lift } = this.#settings;
    this.#bodies.forEach((body, index) => {
      body.setBodyType(this.#physics.RigidBodyType.Dynamic, true);
      const blast = this.#blasts[this.#copies[index] ?? 0] ?? [0, 0, 0];
      const at = body.translation();
      const dx = at.x - blast[0];
      const dz = at.z - blast[2];
      const far = Math.hypot(dx, dz);
      const near = 1 / (1 + far / 8);
      const mass = body.mass();
      const kick = push * near * rng.range(0.5, 1) * mass;
      body.applyImpulse(
        {
          x: far > 0 ? (dx / far) * kick : 0,
          y: lift * near * rng.range(0.3, 1) * mass,
          z: far > 0 ? (dz / far) * kick : 0,
        },
        true,
      );
    });
  }

  /** Runs the world on by `seconds` in fixed steps (at most a few, so a slow frame can't snowball). */
  step(seconds: number): number {
    const { timestep, maxStepsPerFrame } = this.#settings;
    this.#carry += seconds;
    let steps = 0;
    while (this.#carry >= timestep && steps < maxStepsPerFrame) {
      this.#world.step();
      this.#carry -= timestep;
      steps++;
    }
    if (steps === maxStepsPerFrame) this.#carry = Math.min(this.#carry, timestep);
    this.steps += steps;
    return steps;
  }

  /** Body `index`'s pose, written into `out`. */
  pose(index: number, out: BodyPose): BodyPose {
    const body = this.#bodies[index];
    if (!body) throw new Error(`No body ${String(index)}`);
    const at = body.translation();
    const turn = body.rotation();
    out.x = at.x;
    out.y = at.y;
    out.z = at.z;
    out.qx = turn.x;
    out.qy = turn.y;
    out.qz = turn.z;
    out.qw = turn.w;
    return out;
  }

  /** How many bodies are still moving. */
  moving(): number {
    return this.#bodies.filter((body) => !body.isSleeping() && !body.isFixed()).length;
  }

  /** Frees the physics world; the sim can't be used after. */
  free(): void {
    this.#world.free();
  }
}
