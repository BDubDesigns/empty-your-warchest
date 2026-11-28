import { Rng, type EventLogger } from '../../../core';
import {
  layoutCastle,
  middleOf,
  pointAlong,
  type Castle,
  type CastleLayout,
  type CastleVantage,
  type GameData,
  type PostSlot,
  type Siege,
  type SiegeFeel,
  type SiegeMaterial,
  type SiegeObjective,
  type SiegePartKind,
  type SiegeWeapon,
} from '../../../data';
import { castleBodies, standsOn, within, type BodyShape, type PartBody } from './castleBodies';
import { objectiveProgress, planRound, type Progress, type RoundPlan } from './objectives';
import type { Physics } from './physics';
import { siegeRewards, type SiegeRewards } from './score';
import {
  clampAim,
  shotSpears,
  siegeWeapon,
  type Aim,
  type Launch,
  type Spot,
  type ThrowMode,
  type Vec3,
} from './throw';

type World = InstanceType<Physics['World']>;
type Body = ReturnType<World['createRigidBody']>;
type Collider = ReturnType<World['createCollider']>;
type EventQueue = InstanceType<Physics['EventQueue']>;
type ColliderDesc = InstanceType<Physics['ColliderDesc']>;

/** A rotation, as Rapier gives it. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Where a body is and how it's turned. */
export interface Pose {
  position: Vec3;
  rotation: Quat;
}

export type MaterialKind = SiegeMaterial['kind'];

/** What was hit: a castle part or a guard (the captain among them), by its index. */
export type Target = { kind: 'part' | 'guard'; index: number };

/** What happened in a step, for the view's juice (and the tests). */
export type SiegeEvent =
  /** The ballista shoots `spears` spears from vantage `vantage`. */
  | { type: 'throw'; mode: ThrowMode; spears: number; vantage: number }
  /** A spear left the ballista: its index in `spears`. */
  | { type: 'launch'; spear: number }
  /** A spear hit a part or a guard at `speed` m/s, dealing `damage`. */
  | {
      type: 'hit';
      spear: number;
      target: Target;
      kind: MaterialKind | 'guard';
      speed: number;
      damage: number;
      at: Vec3;
    }
  /** A spear came down on the ground, or on stone that never breaks. */
  | { type: 'land'; spear: number; speed: number; at: Vec3 }
  /** A loose part slammed into something: its speed changed by `speed` m/s in a step. */
  | { type: 'thud'; part: number; kind: MaterialKind; speed: number; at: Vec3 }
  /** A part came loose: it's a body the physics moves now. */
  | { type: 'loose'; part: number }
  /** A part ran out of hit points and broke: it's gone from the world. */
  | { type: 'break'; part: number; kind: MaterialKind; at: Vec3 }
  /** A part counted as knocked down. */
  | { type: 'down'; part: number }
  /** A guard is down: hit, fallen with what he stood on, or crushed. */
  | { type: 'guardDown'; guard: number; at: Vec3; by: GuardDownBy }
  /** An objective moved on: `done` of `needed`, `complete` once it's all done. */
  | { type: 'objective'; objective: number; done: number; needed: number; complete: boolean }
  /** The camera (and the ballista) moved to another vantage point. */
  | { type: 'vantage'; vantage: number }
  /** Every objective is done. The round ends once it all settles. */
  | { type: 'won' }
  | { type: 'end'; result: SiegeResult };

export type GuardDownBy = 'spear' | 'fall' | 'crush';

/** How the round ended: every objective done, out of spears, or withdrawn. */
export type SiegeEnding = 'all' | 'spears' | 'withdrew';

export interface SiegeResult extends SiegeRewards {
  ending: SiegeEnding;
  /** Each objective's kind and how far it got. */
  objectives: (Progress & { kind: SiegeObjective['kind'] })[];
  /** Objectives done, of `total`. */
  done: number;
  total: number;
  /** Spears shot. */
  used: number;
  /** Throws: shots of the ballista, aimed or barrage alike (what stars count). */
  throws: number;
  par: number;
  /** Parts knocked down or broken (each counted once), and broken. */
  partsDown: number;
  partsBroken: number;
  guardsDown: number;
  /** Damage dealt to parts and guards, by spears and crashes. */
  damage: number;
  /** Round time (physics seconds). */
  seconds: number;
}

/** Aiming (and shooting); every objective done and settling; or the round is over. */
export type SiegePhase = 'aim' | 'won' | 'done';

export interface SiegeHooks {
  logger: EventLogger;
  feel: () => SiegeFeel;
  /** Spears left in the warchest. */
  spears: () => number;
  /** Takes shot spears out of the warchest. */
  spend: (count: number) => void;
  /** Pays what the round earned (XP, recovered spears). */
  finish: (result: SiegeResult) => void;
  onEvent: (event: SiegeEvent) => void;
}

export interface SiegeOptions {
  /** Spears in an aimed volley (from the Command level). */
  aimed: number;
  /** Where the objectives go, and the shots' random stray: the same seed and shots replay. */
  seed: number;
  /** The vantage point to start at (index in the castle's); the first by default. */
  vantage?: number;
  /** The round's objectives and where they are (for tests), instead of the seed's. */
  plan?: RoundPlan;
}

/** Fixed where it was built; loose (the physics moves it); fixed again where it settled; gone. */
export type PartMode = 'fixed' | 'loose' | 'frozen' | 'broken';

/** One of the castle's parts that can come apart (or the spear rack), as the round sees it. */
export interface PartState {
  body: PartBody;
  kind: SiegePartKind;
  material: MaterialKind;
  /** Hit points: full at `maxHp`, broken at 0. */
  hp: number;
  maxHp: number;
  mode: PartMode;
  /** Knocked down: dropped or tipped far enough (counted once). */
  fallen: boolean;
  /** Where it was built (its frame: its foot, turned). */
  start: Pose;
}

/** One of the guards (the battlement's, or the captain). */
export interface GuardState {
  role: 'guard' | 'captain';
  /** The objective (by index) he's part of. */
  objective: number;
  /** His box (what's hit: for the captain, only what shows above the sill), and how far his feet are below its middle. */
  size: [number, number, number];
  feet: number;
  /** How tall he's drawn. */
  height: number;
  hp: number;
  maxHp: number;
  down: boolean;
  by: GuardDownBy | undefined;
  /** Walking his stretch (or standing), and the way he faces (radians about y, 0 toward +z). */
  walking: boolean;
  facing: number;
  /** His stretch of a guard path (or lookout), how far along the path he is, and which way he's going. */
  slot: PostSlot | undefined;
  along: number;
  heading: 1 | -1;
  /** Seconds left of his pause at the end of his stretch. */
  pause: number;
}

/** A shot spear. */
export interface SpearState {
  /** Still in its first flight: nothing touched yet, so it flies nose first. */
  flying: boolean;
  /** The throw it was part of. */
  throwIndex: number;
  /** No longer a body: lying where it settled, or stuck in a part (and moving with it). */
  frozen: boolean;
  /** Gone: off the field, or the part it was stuck in broke. */
  gone: boolean;
}

/** A spear of a shot still on the ballista: it leaves on step `at`. */
interface Pending {
  at: number;
  launch: Launch;
  throwIndex: number;
}

interface Tracked {
  body: Body | undefined;
  colliders: Collider[];
  /** Its pose before the last step, so the view can draw between steps. */
  before: Pose;
  /** Its pose now (kept once it's no body: fixed, frozen or gone). */
  now: Pose;
  /** Its velocity before the last step, to tell a sudden change (a thud). */
  velocity: Vec3;
  /** Seconds it's been still for. */
  still: number;
}

/** What a collider belongs to. */
type Owner = { kind: 'part' | 'guard' | 'spear'; index: number } | { kind: 'ground' | 'solid' };

const DEG = Math.PI / 180;
/** Collision groups (membership << 16 | what it collides with): spears never hit each other. */
const GROUND = 0x0001;
const PART = 0x0002;
const SPEAR = 0x0004;
const GUARD = 0x0008;
const groups = (member: number, filter: number) => (member << 16) | filter;
/** How far round a broken part loose bodies are woken (m): anything resting on it. */
const WAKE_REACH = 4;
/** How near the top of a part a guard's feet must be, and how far past its edges, to stand on it (m). */
const FOOTING = 0.2;
/** A spear this far below the field, or past its edge, is gone (m). */
const OFF_FIELD = 3;

/** The castle laid out once per castle: it's the same every round. */
const layouts = new WeakMap<Castle, CastleLayout>();
function layoutOf(castle: Castle): CastleLayout {
  let layout = layouts.get(castle);
  if (!layout) {
    layout = layoutCastle(castle);
    layouts.set(castle, layout);
  }
  return layout;
}

/**
 * One siege at the castle: its parts (fixed until something they rest on goes or a falling part
 * knocks them, loose bodies after, fixed again once they settle), the guards and the captain,
 * the ballista at a vantage point and the spears it shoots, in a Rapier physics world, and the
 * rules round them: the round's objectives, placed from its seed. The world is stepped at a fixed
 * rate (`advance` turns real time into whole steps), so the same shots on the same steps, with the
 * same seed, always go the same way. It ends once every objective is done (and it's settled), once
 * the spears run out (and it's settled), or when you withdraw.
 */
export class SiegeRound {
  readonly rules: Siege;
  readonly castle: Castle;
  readonly layout: CastleLayout;
  readonly plan: RoundPlan;
  readonly parts: PartState[] = [];
  readonly guards: GuardState[] = [];
  readonly spears: SpearState[] = [];
  /** How far along each objective is. */
  readonly progress: Progress[];
  /** Spears in an aimed volley. */
  readonly aimed: number;
  readonly weapon: SiegeWeapon;
  readonly vantages: readonly CastleVantage[];
  phase: SiegePhase = 'aim';
  result: SiegeResult | undefined;
  /** How far between the last step and the next the view should draw (0 to 1). */
  alpha = 0;
  readonly #physics: Physics;
  readonly #world: World;
  readonly #queue: EventQueue;
  readonly #hooks: SiegeHooks;
  readonly #recovery: number;
  readonly #rng: Rng;
  readonly #seed: number;
  readonly #partBodies: Tracked[] = [];
  readonly #guardBodies: Tracked[] = [];
  readonly #spearBodies: Tracked[] = [];
  /** A spear stuck in a part: which, and where in its frame. */
  readonly #stuck = new Map<number, { part: number; local: Pose }>();
  /** The parts each part rests on now (as built; as it settled, once it's moved). */
  readonly #supports: number[][];
  /** Each guard's parts he may stand on, along his stretch. */
  readonly #footing: number[][] = [];
  readonly #owners = new Map<number, Owner>();
  /** Spear and target pairs already reported as hits. */
  readonly #hits = new Set<string>();
  readonly #lastThud: number[];
  readonly #middle: [number, number];
  #vantage: number;
  #pending: Pending[] = [];
  #steps = 0;
  #carry = 0;
  #used = 0;
  #damage = 0;
  #throws = 0;
  #lastThrow: { at: number; index: number } | undefined;
  /** What the last throw has done so far, for the logs (told when the next goes, or at the end). */
  #tally: { mode: ThrowMode; broken: number; loosened: number; guards: number } | undefined;
  /** A part broke or came loose this step: what it held up is checked. */
  #shifted = false;
  #calmFor = 0;
  #wonAt = 0;

  constructor(
    physics: Physics,
    data: Pick<GameData, 'siege' | 'castle' | 'tuning'>,
    hooks: SiegeHooks,
    options: SiegeOptions,
  ) {
    this.rules = data.siege;
    this.castle = data.castle;
    this.layout = layoutOf(data.castle);
    this.aimed = options.aimed;
    this.weapon = siegeWeapon(data.siege);
    this.vantages = data.castle.vantages;
    this.#physics = physics;
    this.#hooks = hooks;
    this.#recovery = data.tuning.weaponRecoveryOnWin;
    this.#seed = options.seed;
    this.#rng = new Rng(options.seed);
    this.#vantage = Math.min(Math.max(options.vantage ?? 0, 0), this.vantages.length - 1);
    this.#middle = middleOf(data.castle);
    // Where things go is drawn apart from the shots, so the shots don't move them.
    this.plan =
      options.plan ??
      planRound(this.rules, this.layout, new Rng((options.seed ^ 0x9e3779b9) >>> 0));
    const settings = this.rules.physics;
    this.#world = new physics.World({ x: 0, y: -settings.gravity, z: 0 });
    this.#world.timestep = settings.timestep;
    this.#world.numSolverIterations = settings.solverIterations;
    this.#queue = new physics.EventQueue(true);

    // The field, and the stonework that never comes apart.
    const [cx, cz] = this.#middle;
    const field = this.#world.createRigidBody(physics.RigidBodyDesc.fixed());
    const reach = settings.groundReach;
    const ground = this.#world.createCollider(
      physics.ColliderDesc.cuboid(reach, 0.5, reach)
        .setTranslation(cx, -0.5, cz)
        .setFriction(settings.groundFriction)
        .setCollisionGroups(groups(GROUND, PART | SPEAR | GUARD)),
      field,
    );
    this.#owners.set(ground.handle, { kind: 'ground' });
    const bodies = castleBodies(this.castle, this.layout, this.rules.bodies, this.plan.rack);
    const solid = this.#material(this.rules.bodies.solid);
    const stone = this.#world.createRigidBody(physics.RigidBodyDesc.fixed());
    for (const shape of bodies.solids) {
      const collider = this.#world.createCollider(
        this.#shapeDesc(shape)
          .setFriction(solid.friction)
          .setRestitution(solid.restitution)
          .setCollisionGroups(groups(PART, GROUND | PART | SPEAR | GUARD)),
        stone,
      );
      this.#owners.set(collider.handle, { kind: 'solid' });
    }

    // The parts that can come apart: fixed where they're built until they come loose.
    bodies.parts.forEach((part, index) => {
      const setting = this.rules.parts[part.kind];
      const material = this.#material(setting.material);
      const rotation = turnQuat(part.turn);
      const body = this.#world.createRigidBody(
        physics.RigidBodyDesc.fixed()
          .setTranslation(part.foot[0], part.foot[1], part.foot[2])
          .setRotation(rotation),
      );
      const colliders = part.shapes.map((shape) => {
        const collider = this.#world.createCollider(
          this.#shapeDesc(shape)
            .setDensity(material.density)
            .setFriction(material.friction)
            .setRestitution(material.restitution)
            .setCollisionGroups(groups(PART, GROUND | PART | SPEAR | GUARD))
            .setActiveEvents(physics.ActiveEvents.COLLISION_EVENTS),
          body,
        );
        this.#owners.set(collider.handle, { kind: 'part', index });
        return collider;
      });
      this.#partBodies.push(track(body, colliders));
      const start: Pose = {
        position: { x: part.foot[0], y: part.foot[1], z: part.foot[2] },
        rotation: rotation,
      };
      this.parts.push({
        body: part,
        kind: part.kind,
        material: material.kind,
        hp: setting.hp,
        maxHp: setting.hp,
        mode: 'fixed',
        fallen: false,
        start,
      });
    });
    this.#supports = bodies.parts.map((part) => [...part.supports]);
    this.#lastThud = this.parts.map(() => -Infinity);

    // The battlement's guards, each on his stretch, and the captain at his window.
    const guard = this.rules.guard;
    for (const planned of this.plan.guards) {
      const index = this.guards.length;
      const state: GuardState = {
        role: 'guard',
        objective: planned.objective,
        size: [...guard.size],
        feet: guard.size[1] / 2,
        height: guard.size[1],
        hp: guard.hp,
        maxHp: guard.hp,
        down: false,
        by: undefined,
        walking: false,
        facing: 0,
        slot: planned.slot,
        along: 0,
        heading: planned.heading,
        pause: 0,
      };
      if (planned.slot.kind === 'path') {
        state.along = planned.slot.from + (planned.slot.to - planned.slot.from) * planned.start;
      }
      const feet = this.#feetOf(state);
      state.facing = this.#outward(feet);
      this.guards.push(state);
      this.#guardBodies.push(this.#addGuard(index, feet, state));
      this.#footing.push(this.#footingFor(state));
    }
    const captain = this.plan.objectives.findIndex((objective) => objective.kind === 'captain');
    const window =
      this.plan.captainWindow === undefined
        ? undefined
        : this.layout.anchors.captainWindows[this.plan.captainWindow];
    if (captain >= 0 && window) {
      const rules = this.rules.captain;
      const height = guard.size[1] * rules.scale;
      const floor = window.at[1] - this.castle.windowMiddle;
      const shows = Math.max(height - rules.sill, 0.1);
      const index = this.guards.length;
      const state: GuardState = {
        role: 'captain',
        objective: captain,
        size: [guard.size[0] * rules.scale, shows, guard.size[2] * rules.scale],
        feet: rules.sill + shows / 2,
        height,
        hp: rules.hp,
        maxHp: rules.hp,
        down: false,
        by: undefined,
        walking: false,
        facing: Math.atan2(window.out[0], window.out[1]),
        slot: undefined,
        along: 0,
        heading: 1,
        pause: 0,
      };
      const feet: Vec3 = {
        x: window.at[0] - window.out[0] * rules.inset,
        y: floor,
        z: window.at[2] - window.out[1] * rules.inset,
      };
      this.guards.push(state);
      this.#guardBodies.push(this.#addGuard(index, feet, state));
      // In a storey that comes apart, he stands in one of its blocks, and goes down with it.
      this.#footing.push(
        this.parts.flatMap((part, at) =>
          part.kind === 'storeyChunk' && within(part.body, [feet.x, feet.y + rules.sill, feet.z])
            ? [at]
            : [],
        ),
      );
    }
    this.progress = this.plan.objectives.map((objective, index) =>
      objectiveProgress(objective, this.#objectiveView(index)),
    );
    // One step of the world with nothing moving yet, so its rays (Fire's aim) find what's built.
    this.#world.step(this.#queue);
    this.#queue.clear();

    const feel = hooks.feel();
    hooks.logger.log('siege.roundStart', {
      seed: options.seed,
      spears: hooks.spears(),
      aimed: options.aimed,
      par: this.rules.par,
      vantage: this.vantages[this.#vantage]?.id,
      parts: this.parts.length,
      objectives: this.plan.objectives.map((objective, index) => ({
        kind: objective.kind,
        needed: this.progress[index]?.needed,
      })),
      captainWindow: this.plan.captainWindow,
      rack: this.plan.rack,
      guards: this.plan.guards.map((planned) => ({
        post: planned.slot.post,
        ...(planned.slot.kind === 'path' && {
          from: round2(planned.slot.from),
          to: round2(planned.slot.to),
        }),
      })),
      feel,
    });
  }

  /** Round time, in physics seconds. */
  get seconds(): number {
    return this.#steps * this.rules.physics.timestep;
  }

  get steps(): number {
    return this.#steps;
  }

  /** Spears shot so far. */
  get used(): number {
    return this.#used;
  }

  /** Throws so far: shots of the ballista. */
  get throws(): number {
    return this.#throws;
  }

  /** Damage dealt so far, by spears and crashes. */
  get damage(): number {
    return this.#damage;
  }

  /** The vantage point the ballista (and the camera) is at. */
  get vantage(): number {
    return this.#vantage;
  }

  /** Parts knocked down or broken, each counted once. */
  get partsDown(): number {
    return this.parts.filter((part) => part.fallen || part.mode === 'broken').length;
  }

  get partsBroken(): number {
    return this.parts.filter((part) => part.mode === 'broken').length;
  }

  /** Parts the physics is moving now (loose ones). */
  get partsLoose(): number {
    return this.parts.filter((part) => part.mode === 'loose').length;
  }

  /** Spears that are still bodies (flying, or not yet settled). */
  get spearBodies(): number {
    return this.#spearBodies.filter((tracked) => tracked.body !== undefined).length;
  }

  get guardsDown(): number {
    return this.guards.filter((guard) => guard.down).length;
  }

  /** Objectives done. */
  get done(): number {
    return this.progress.filter((progress) => progress.done >= progress.needed).length;
  }

  /** The last shot is still leaving the ballista, or its spears are in the air and it's too soon. */
  get reloading(): boolean {
    if (this.#pending.length > 0) return true;
    const last = this.#lastThrow;
    if (!last) return false;
    if (this.seconds - last.at >= this.#hooks.feel().reloadSeconds) return false;
    return this.spears.some((spear) => spear.throwIndex === last.index && spear.flying);
  }

  /** Whether the ballista can shoot now: aiming, loaded, and at least a spear left. */
  get canThrow(): boolean {
    return this.phase === 'aim' && !this.reloading && this.#hooks.spears() >= 1;
  }

  /**
   * Where the ballista stands at vantage `index` (the one it's at by default): `mount.ahead` in
   * front of the camera along the ground, its pivot `mount.below` under it.
   */
  mount(index = this.#vantage): Spot {
    const vantage = this.vantages[index] ?? this.vantages[0];
    if (!vantage) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = vantage.at;
    const dx = vantage.look[0] - x;
    const dz = vantage.look[2] - z;
    const flat = Math.hypot(dx, dz) || 1;
    const { ahead, below } = this.rules.mount;
    return {
      x: x + (dx / flat) * ahead,
      y: y - below - this.weapon.pivotHeight,
      z: z + (dz / flat) * ahead,
    };
  }

  /** Moves the ballista (and the camera) to vantage point `index`. Returns false if it can't. */
  setVantage(index: number): boolean {
    if (this.phase === 'done' || index === this.#vantage || !this.vantages[index]) return false;
    const from = this.#vantage;
    this.#vantage = index;
    this.#hooks.logger.log('siege.vantage', {
      from: this.vantages[from]?.id,
      to: this.vantages[index].id,
      throws: this.#throws,
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'vantage', vantage: index });
    return true;
  }

  /**
   * The ballista shoots (taking the spears from the warchest), if it can. `at` is the point it was
   * aimed at, for the logs. Spears that leave straight away go on the next step; the rest of a
   * volley a moment after.
   */
  throw(mode: ThrowMode, aim: Aim, at?: Vec3): boolean {
    if (!this.canThrow) return false;
    const feel = this.#hooks.feel();
    const kept = clampAim(aim, this.weapon);
    const spot = this.mount();
    const spears = shotSpears(
      mode,
      kept,
      spot,
      this.aimed,
      this.#hooks.spears(),
      this.weapon,
      feel,
      this.#rng,
    );
    this.#hooks.spend(spears.length);
    this.#used += spears.length;
    this.#logTally();
    this.#tally = { mode, broken: 0, loosened: 0, guards: 0 };
    const index = this.#throws++;
    const { timestep } = this.rules.physics;
    for (const spear of spears) {
      this.#pending.push({
        at: this.#steps + Math.round(spear.delay / timestep),
        launch: spear,
        throwIndex: index,
      });
    }
    this.#lastThrow = { at: this.seconds, index };
    this.#calmFor = 0;
    this.#hooks.logger.log('siege.throw', {
      mode,
      vantage: this.vantages[this.#vantage]?.id,
      aim: {
        yaw: round2(kept.yaw / DEG),
        tilt: round2(kept.tilt / DEG),
        ...(at && { at: { x: round2(at.x), y: round2(at.y), z: round2(at.z) } }),
      },
      // The ballista has one speed: no power to set.
      power: this.weapon.speed,
      spears: spears.length,
      throw: this.#throws,
      left: this.#hooks.spears(),
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'throw', mode, spears: spears.length, vantage: this.#vantage });
    this.#launchDue();
    return true;
  }

  /**
   * The first thing a ray from `from` along `way` meets within `far` m (a part, a guard, the
   * stonework or the field): where Fire aims, so a shot hits what the rules have there.
   */
  rayHit(from: Vec3, way: Vec3, far: number): Vec3 | undefined {
    const length = Math.hypot(way.x, way.y, way.z) || 1;
    const dir = { x: way.x / length, y: way.y / length, z: way.z / length };
    const ray = new this.#physics.Ray(from, dir);
    const hit = this.#world.castRay(
      ray,
      far,
      true,
      undefined,
      groups(0xffff, GROUND | PART | GUARD),
    );
    if (!hit) return undefined;
    return {
      x: from.x + dir.x * hit.timeOfImpact,
      y: from.y + dir.y * hit.timeOfImpact,
      z: from.z + dir.z * hit.timeOfImpact,
    };
  }

  /**
   * Whether `to` can be seen from `from`: nothing the rules have stands in the way short of it
   * (`slack` m short counts as there, so a target itself doesn't hide its own middle).
   */
  sees(from: Vec3, to: Vec3, slack: number): boolean {
    const way = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const far = Math.hypot(way.x, way.y, way.z);
    const hit = this.rayHit(from, way, far);
    if (!hit) return true;
    return Math.hypot(hit.x - from.x, hit.y - from.y, hit.z - from.z) >= far - slack;
  }

  /**
   * Runs as many whole steps as `seconds` of round time make (carrying the rest over), at most
   * `maxStepsPerFrame`. Returns the steps run.
   */
  advance(seconds: number): number {
    const { timestep, maxStepsPerFrame } = this.rules.physics;
    this.#carry += Math.max(seconds, 0);
    let steps = 0;
    while (this.#carry >= timestep && steps < maxStepsPerFrame && this.phase !== 'done') {
      this.step();
      this.#carry -= timestep;
      steps++;
    }
    // Too far behind (a slow frame): let it go rather than catch up in a burst.
    if (steps === maxStepsPerFrame) this.#carry = Math.min(this.#carry, timestep);
    this.alpha = this.phase === 'done' ? 1 : this.#carry / timestep;
    return steps;
  }

  /** One fixed physics step, and the rules after it. */
  step(): void {
    if (this.phase === 'done') return;
    const { timestep } = this.rules.physics;
    this.#launchDue();
    // A spear in flight flies nose first (its weight is up front), until it first touches.
    this.spears.forEach((spear, index) => {
      const body = this.#spearBodies[index]?.body;
      if (!spear.flying || !body) return;
      body.setRotation(alongY(body.linvel()), false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    });
    for (const tracked of this.#moving()) remember(tracked);
    this.#walkGuards();
    this.#world.step(this.#queue);
    this.#steps++;
    const now = this.seconds;
    const feel = this.#hooks.feel();

    // Parts hit or knocked this step, dealt with once everything's been counted (in order).
    const breaking = new Set<number>();
    const knocks = new Map<number, number>();
    const crushes = new Map<number, number>();
    this.#queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const a = this.#owners.get(first);
      const b = this.#owners.get(second);
      if (!a || !b) return;
      const spear = a.kind === 'spear' ? a : b.kind === 'spear' ? b : undefined;
      if (spear && 'index' in spear) {
        const other = spear === a ? b : a;
        this.#spearTouched(spear.index, other, feel, breaking);
        return;
      }
      for (const [mover, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (mover.kind !== 'part' || this.parts[mover.index]?.mode !== 'loose') continue;
        const speed = length(this.#partBodies[mover.index]?.velocity);
        if (other.kind === 'part') {
          const mode = this.parts[other.index]?.mode;
          if (mode === 'fixed' || mode === 'frozen') {
            knocks.set(other.index, Math.max(knocks.get(other.index) ?? 0, speed));
          }
        } else if (other.kind === 'guard') {
          crushes.set(other.index, Math.max(crushes.get(other.index) ?? 0, speed));
        }
      }
    });

    const { damage } = this.rules;
    this.parts.forEach((state, index) => {
      if (state.mode !== 'loose') return;
      const tracked = this.#partBodies[index];
      const body = tracked?.body;
      if (!tracked || !body) return;
      readPose(body, tracked.now);
      if (body.isSleeping()) return;
      const change = suddenChange(tracked);
      if (change > damage.crashMinSpeed) {
        const amount = (change - damage.crashMinSpeed) * damage.crashPerSpeed;
        if (this.#hurt({ kind: 'part', index }, amount)) breaking.add(index);
      }
      if (change >= feel.thudSpeed && now - (this.#lastThud[index] ?? 0) >= feel.thudGapSeconds) {
        this.#lastThud[index] = now;
        this.#hooks.onEvent({
          type: 'thud',
          part: index,
          kind: state.material,
          speed: change,
          at: copy(body.translation()),
        });
      }
      this.#checkFallen(index);
    });
    // A loose part slamming into a fixed one knocks it loose (and hurts it).
    for (const [index, speed] of [...knocks].sort((x, y) => x[0] - y[0])) {
      if (speed < damage.knockSpeed || breaking.has(index)) continue;
      const amount = Math.max(speed - damage.crashMinSpeed, 0) * damage.crashPerSpeed;
      if (this.#hurt({ kind: 'part', index }, amount)) breaking.add(index);
      else this.#loosen(index);
    }
    for (const index of [...breaking].sort((x, y) => x - y)) this.#break(index);
    if (this.#shifted) this.#checkHolds();
    for (const [index, speed] of [...crushes].sort((x, y) => x[0] - y[0])) {
      if (speed >= damage.knockSpeed) this.#guardDown(index, 'crush');
    }

    // Guards: hit hard enough, knocked over, or what they stand on gone from under them.
    this.guards.forEach((state, index) => {
      if (state.down) return;
      if (state.hp <= 0) {
        this.#guardDown(index, 'spear');
        return;
      }
      if (this.#footingGone(index)) this.#guardDown(index, 'fall');
    });
    this.#guardBodies.forEach((tracked, index) => {
      const body = tracked.body;
      if (body && this.guards[index]?.down) readPose(body, tracked.now);
    });

    this.#settle(timestep);
    this.#checkObjectives(now);

    this.#calmFor = this.#calm() ? this.#calmFor + timestep : 0;
    const settled = this.#calmFor >= this.rules.settle.seconds;
    if (this.phase === 'won' && (settled || now - this.#wonAt >= this.rules.settle.winSeconds)) {
      this.#finish('all');
    } else if (
      this.phase === 'aim' &&
      settled &&
      this.#used > 0 &&
      this.#hooks.spears() < 1 &&
      this.#pending.length === 0 &&
      !this.spears.some((spear) => spear.flying)
    ) {
      this.#finish('spears');
    }
  }

  /** Ends the round now, with what's done (Withdraw). */
  withdraw(): void {
    if (this.phase === 'done') return;
    this.#finish(this.done >= this.progress.length ? 'all' : 'withdrew');
  }

  /** Part `index`'s frame (its foot, turned), drawn `alpha` of the way from its last step. */
  partPose(index: number, out: Pose): Pose {
    const tracked = this.#partBodies[index];
    return tracked ? between(tracked, this.alpha, out) : out;
  }

  /** Guard `index`'s box middle and turn. */
  guardPose(index: number, out: Pose): Pose {
    const tracked = this.#guardBodies[index];
    return tracked ? between(tracked, this.alpha, out) : out;
  }

  /** Spear `index`'s middle and turn (its length along its y): flying, lying, or stuck in a part. */
  spearPose(index: number, out: Pose): Pose {
    const stuck = this.#stuck.get(index);
    if (stuck) {
      const part = this.partPose(stuck.part, scratchPose);
      return compose(part, stuck.local, out);
    }
    const tracked = this.#spearBodies[index];
    return tracked ? between(tracked, this.alpha, out) : out;
  }

  /** Leaving mid-round: the shot spears are spent. */
  quit(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.#logTally();
    this.#hooks.logger.log('siege.quit', {
      used: this.#used,
      throws: this.#throws,
      done: this.done,
      partsDown: this.partsDown,
      guardsDown: this.guardsDown,
      seconds: round2(this.seconds),
    });
  }

  /** Frees the physics world. The round can't be used after. */
  dispose(): void {
    this.#queue.free();
    this.#world.free();
  }

  // Bodies

  #material(id: string): SiegeMaterial {
    const material = this.rules.materials.find((entry) => entry.id === id);
    if (!material) throw new Error(`Unknown material "${id}"`);
    return material;
  }

  /** A collider for a shape, in its body's frame. */
  #shapeDesc(shape: BodyShape): ColliderDesc {
    const { ColliderDesc } = this.#physics;
    if (shape.kind === 'box') {
      const [hx, hy, hz] = shape.half;
      return ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(shape.at[0], shape.at[1], shape.at[2])
        .setRotation(turnQuat(shape.turn));
    }
    if (shape.kind === 'cone') {
      return ColliderDesc.cone(shape.height / 2, shape.radius).setTranslation(
        shape.at[0],
        shape.at[1] + shape.height / 2,
        shape.at[2],
      );
    }
    const desc = ColliderDesc.convexHull(new Float32Array(shape.points.flat()));
    if (!desc) throw new Error('A castle shape has no hull');
    return desc;
  }

  /**
   * A guard's body: kinematic while he stands (the rules move him), hit by spears and told of
   * falling parts, but pushing nothing about.
   */
  #addGuard(index: number, feet: Vec3, state: GuardState): Tracked {
    const physics = this.#physics;
    const middle = { x: feet.x, y: feet.y + state.feet, z: feet.z };
    const rotation = turnQuat(state.facing);
    const body = this.#world.createRigidBody(
      physics.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(middle.x, middle.y, middle.z)
        .setRotation(rotation),
    );
    const { density, friction } = this.rules.guard;
    const collider = this.#world.createCollider(
      physics.ColliderDesc.cuboid(state.size[0] / 2, state.size[1] / 2, state.size[2] / 2)
        .setDensity(density)
        .setFriction(friction)
        .setCollisionGroups(groups(GUARD, SPEAR | PART))
        .setSolverGroups(groups(GUARD, SPEAR))
        .setActiveEvents(physics.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.#owners.set(collider.handle, { kind: 'guard', index });
    return track(body, [collider]);
  }

  /** Where a guard's feet are now: along his stretch, or at his lookout. */
  #feetOf(state: GuardState): Vec3 {
    const slot = state.slot;
    if (!slot) return { x: 0, y: 0, z: 0 };
    if (slot.kind === 'lookout') {
      const lookout = this.layout.anchors.lookouts.find((entry) => entry.id === slot.post);
      const [x, y, z] = lookout?.at ?? [0, 0, 0];
      return { x, y, z };
    }
    const path = this.layout.anchors.guardPaths.find((entry) => entry.id === slot.post);
    if (!path) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = pointAlong(path, state.along);
    return { x, y, z };
  }

  /** The way from the courtyard's middle out past `at`: where a standing guard looks. */
  #outward(at: Vec3): number {
    return Math.atan2(at.x - this.#middle[0], at.z - this.#middle[1]);
  }

  /** The parts under a guard's stretch (or lookout): what he may stand on. */
  #footingFor(state: GuardState): number[] {
    const slot = state.slot;
    if (!slot) return [];
    const points: Vec3[] = [];
    if (slot.kind === 'lookout') points.push(this.#feetOf(state));
    else {
      const path = this.layout.anchors.guardPaths.find((entry) => entry.id === slot.post);
      const steps = Math.max(1, Math.ceil((slot.to - slot.from) / 0.25));
      for (let i = 0; i <= steps; i++) {
        const [x, y, z] = path
          ? pointAlong(path, slot.from + ((slot.to - slot.from) * i) / steps)
          : [0, 0, 0];
        points.push({ x, y, z });
      }
    }
    const found = new Set<number>();
    this.parts.forEach((part, index) => {
      if (points.some((point) => standsOn(part.body, [point.x, point.y, point.z], FOOTING))) {
        found.add(index);
      }
    });
    return [...found].sort((a, b) => a - b);
  }

  /** Whether what guard `index` stands on has gone from under him (broken, or fallen). */
  #footingGone(index: number): boolean {
    const state = this.guards[index];
    const footing = this.#footing[index];
    if (!state || !footing || footing.length === 0) return false;
    const gone = (part: number) => {
      const under = this.parts[part];
      return under !== undefined && (under.mode === 'broken' || under.fallen);
    };
    // The captain stands in his window's block: he goes down once it does.
    if (state.role === 'captain') return footing.every(gone);
    const feet = this.#feetOf(state);
    const under = footing.filter((part) => {
      const body = this.parts[part]?.body;
      return body !== undefined && standsOn(body, [feet.x, feet.y, feet.z], FOOTING);
    });
    if (under.length === 0) return false;
    return under.every(gone);
  }

  /** One step of every standing guard: walking his stretch, pausing at its ends. */
  #walkGuards(): void {
    const { timestep } = this.rules.physics;
    const { patrolSpeed, patrolPause } = this.rules.guardMoves;
    this.guards.forEach((state, index) => {
      const slot = state.slot;
      if (state.down || slot?.kind !== 'path') return;
      if (state.pause > 0) {
        state.pause -= timestep;
        state.walking = false;
      } else {
        state.along += state.heading * patrolSpeed * timestep;
        if (state.along <= slot.from || state.along >= slot.to) {
          state.along = Math.min(Math.max(state.along, slot.from), slot.to);
          state.heading = state.heading === 1 ? -1 : 1;
          state.pause = patrolPause;
        }
        state.walking = true;
      }
      const feet = this.#feetOf(state);
      if (state.walking) {
        const path = this.layout.anchors.guardPaths.find((entry) => entry.id === slot.post);
        if (path) {
          const [ax, , az] = pointAlong(path, state.along - 0.05 * state.heading);
          const [bx, , bz] = pointAlong(path, state.along + 0.05 * state.heading);
          if (Math.hypot(bx - ax, bz - az) > 1e-6) state.facing = Math.atan2(bx - ax, bz - az);
        }
      } else state.facing = this.#outward(feet);
      const body = this.#guardBodies[index]?.body;
      if (!body) return;
      body.setNextKinematicTranslation({ x: feet.x, y: feet.y + state.feet, z: feet.z });
      body.setNextKinematicRotation(turnQuat(state.facing));
    });
  }

  /** The bodies that move: loose parts, spears that are still bodies, guards. */
  *#moving(): Generator<Tracked> {
    for (let index = 0; index < this.parts.length; index++) {
      const tracked = this.#partBodies[index];
      if (tracked && this.parts[index]?.mode === 'loose') yield tracked;
    }
    for (const tracked of this.#spearBodies) if (tracked.body) yield tracked;
    for (const tracked of this.#guardBodies) yield tracked;
  }

  /** Sends off every spear of the last shot whose moment has come. */
  #launchDue(): void {
    if (this.#pending.length === 0) return;
    const due = this.#pending.filter((pending) => pending.at <= this.#steps);
    this.#pending = this.#pending.filter((pending) => pending.at > this.#steps);
    for (const pending of due) {
      const spear = this.#addSpear(pending);
      this.#hooks.onEvent({ type: 'launch', spear });
    }
  }

  #addSpear(pending: Pending): number {
    const physics = this.#physics;
    const spear = this.rules.projectile;
    const { position, velocity } = pending.launch;
    const body = this.#world.createRigidBody(
      physics.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(alongY(velocity))
        .setLinvel(velocity.x, velocity.y, velocity.z)
        // So a fast spear can't pass through a part between two steps.
        .setCcdEnabled(true),
    );
    const collider = this.#world.createCollider(
      physics.ColliderDesc.capsule(Math.max(spear.length / 2 - spear.radius, 0.01), spear.radius)
        .setMass(this.#hooks.feel().spearMass)
        .setFriction(spear.friction)
        .setRestitution(spear.restitution)
        .setCollisionGroups(groups(SPEAR, GROUND | PART | GUARD))
        .setActiveEvents(physics.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const index = this.spears.length;
    this.#owners.set(collider.handle, { kind: 'spear', index });
    this.#spearBodies.push(track(body, [collider]));
    this.spears.push({ flying: true, throwIndex: pending.throwIndex, frozen: false, gone: false });
    return index;
  }

  /** A spear touched a part, a guard, the stonework or the field. */
  #spearTouched(index: number, other: Owner, feel: SiegeFeel, breaking: Set<number>): void {
    const spear = this.spears[index];
    const tracked = this.#spearBodies[index];
    const body = tracked?.body;
    if (!spear || !tracked || !body) return;
    const before = tracked.velocity;
    const speed = length(before);
    if (spear.flying) {
      spear.flying = false;
      // A spear that's hit something is spent: it glances off slowly (never on across the castle).
      const now = body.linvel();
      const kept = this.rules.projectile.afterHit;
      body.setLinvel({ x: now.x * kept, y: now.y * kept, z: now.z * kept }, true);
      body.setLinearDamping(this.rules.projectile.landedDamping);
      body.setAngularDamping(this.rules.projectile.landedSpinDamping);
    }
    const at = tip(body, this.rules.projectile.length / 2);
    if (other.kind !== 'part' && other.kind !== 'guard') {
      if (speed >= feel.thudSpeed) this.#hooks.onEvent({ type: 'land', spear: index, speed, at });
      return;
    }
    const target: Target = { kind: other.kind, index: 'index' in other ? other.index : 0 };
    // A standing guard can't be knocked back (the rules move him), so a spear that hits him would
    // bounce off as off a wall, and fly on anywhere: it stops in him instead.
    if (target.kind === 'guard' && !this.guards[target.index]?.down) {
      const share = this.rules.projectile.inGuard;
      body.setLinvel({ x: before.x * share, y: before.y * share, z: before.z * share }, true);
    }
    const key = `${String(index)}:${target.kind}:${String(target.index)}`;
    if (this.#hits.has(key) || this.#gone(target)) return;
    this.#hits.add(key);
    const { spearMinSpeed, spearPerSpeed } = this.rules.damage;
    const damage = Math.max(speed - spearMinSpeed, 0) * spearPerSpeed;
    const kind =
      target.kind === 'guard' ? 'guard' : (this.parts[target.index]?.material ?? 'stone');
    if (target.kind === 'guard') {
      const guard = this.guards[target.index];
      this.#hooks.logger.log('siege.guardHit', {
        guard: target.index,
        role: guard?.role,
        walking: guard?.walking,
        damage: round2(damage),
        vantage: this.vantages[this.#vantage]?.id,
        step: this.#steps,
      });
    }
    if (this.#hurt(target, damage) && target.kind === 'part') breaking.add(target.index);
    if (speed < feel.thudSpeed && damage <= 0) return;
    this.#hooks.onEvent({
      type: 'hit',
      spear: index,
      target,
      kind,
      speed,
      damage: round2(damage),
      at,
    });
  }

  /** Broken (a part) or down (a guard): spears and crashes do it no more harm. */
  #gone(target: Target): boolean {
    return target.kind === 'part'
      ? this.parts[target.index]?.mode === 'broken'
      : this.guards[target.index]?.down !== false;
  }

  /** Deals `amount` damage to a part or a guard. Returns true if that leaves it with none. */
  #hurt(target: Target, amount: number): boolean {
    const state = target.kind === 'part' ? this.parts[target.index] : this.guards[target.index];
    if (!state || this.#gone(target) || amount <= 0) return false;
    const dealt = Math.min(amount, state.hp);
    state.hp -= dealt;
    this.#damage += dealt;
    return state.hp <= 0;
  }

  /**
   * Part `index` comes loose (it's a body the physics moves now), and so does everything resting
   * on it.
   */
  #loosen(index: number): void {
    const stack = [index];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) continue;
      const state = this.parts[next];
      const body = this.#partBodies[next]?.body;
      if (!state || !body || (state.mode !== 'fixed' && state.mode !== 'frozen')) continue;
      state.mode = 'loose';
      this.#shifted = true;
      if (this.#tally) this.#tally.loosened++;
      const tracked = this.#partBodies[next];
      if (tracked) tracked.still = 0;
      body.setBodyType(this.#physics.RigidBodyType.Dynamic, true);
      // It's moving now: what it rests on is up to the physics, until it settles again.
      this.#supports[next] = [];
      this.#hooks.onEvent({ type: 'loose', part: next });
      stack.push(...this.#restingOn(next));
    }
  }

  /**
   * What's held up by more than the part under it (a round tower's rows, by the row beneath): any
   * that has too few of those left standing where they were built comes loose, and all that rests
   * on it; and so on up, until nothing more gives.
   */
  #checkHolds(): void {
    this.#shifted = false;
    for (let again = true; again;) {
      again = false;
      this.parts.forEach((state, index) => {
        const holds = state.body.holds;
        if (!holds || state.mode !== 'fixed') return;
        const standing = holds.parts.filter((part) => this.parts[part]?.mode === 'fixed').length;
        if (standing >= holds.atLeast) return;
        this.#hooks.logger.log('siege.collapse', {
          part: state.body.id,
          owner: state.body.owner,
          standing,
          needed: holds.atLeast,
          throw: this.#throws,
          step: this.#steps,
        });
        this.#loosen(index);
        again = true;
      });
    }
    this.#shifted = false;
  }

  /** The parts resting on part `index` (as built, or as they settled). */
  #restingOn(index: number): number[] {
    const found: number[] = [];
    this.#supports.forEach((supports, other) => {
      if (supports.includes(index)) found.push(other);
    });
    return found;
  }

  /** Part `index` at 0 hit points breaks: out of the world, so what rested on it comes loose. */
  #break(index: number): void {
    const state = this.parts[index];
    const tracked = this.#partBodies[index];
    const body = tracked?.body;
    if (!state || !tracked || !body || state.mode === 'broken') return;
    readPose(body, tracked.now);
    state.mode = 'broken';
    state.hp = 0;
    this.#shifted = true;
    if (this.#tally) this.#tally.broken++;
    const centre = this.#partMiddle(index);
    // What rested on it comes loose; loose bodies near it are woken (asleep, one resting on it
    // would stay up in the air).
    const resting = this.#restingOn(index);
    for (const collider of tracked.colliders) this.#owners.delete(collider.handle);
    this.#world.removeRigidBody(body);
    tracked.body = undefined;
    copyPose(tracked.now, tracked.before);
    for (const other of resting) this.#loosen(other);
    this.parts.forEach((part, other) => {
      const there = this.#partBodies[other]?.body;
      if (part.mode !== 'loose' || !there) return;
      const at = there.translation();
      if (Math.hypot(at.x - centre.x, at.y - centre.y, at.z - centre.z) <= WAKE_REACH + 3) {
        there.wakeUp();
      }
    });
    // Spears stuck in it are gone with it.
    for (const [spear, stuck] of this.#stuck) {
      if (stuck.part !== index) continue;
      this.#stuck.delete(spear);
      const entry = this.spears[spear];
      if (entry) entry.gone = true;
    }
    this.#hooks.onEvent({ type: 'break', part: index, kind: state.material, at: centre });
  }

  /** Where a part's middle is now (roughly: its frame lifted half its height). */
  #partMiddle(index: number): Vec3 {
    const tracked = this.#partBodies[index];
    const part = this.parts[index];
    const pose = tracked?.now;
    if (!pose || !part) return { x: 0, y: 0, z: 0 };
    const shape = part.body.shapes[0];
    const up = shape?.kind === 'box' ? shape.at[1] : shape?.kind === 'cone' ? shape.height / 2 : 1;
    const lift = rotate(pose.rotation, { x: 0, y: up, z: 0 });
    return {
      x: pose.position.x + lift.x,
      y: pose.position.y + lift.y,
      z: pose.position.z + lift.z,
    };
  }

  /** Whether a loose part has dropped or tipped far enough to count as knocked down. */
  #checkFallen(index: number): void {
    const state = this.parts[index];
    const pose = this.#partBodies[index]?.now;
    if (!state || !pose || state.fallen) return;
    const drop = state.start.position.y - pose.position.y;
    if (
      drop >= this.rules.down.drop ||
      tiltBetween(state.start.rotation, pose.rotation) >= this.rules.down.tilt
    ) {
      state.fallen = true;
      this.#hooks.onEvent({ type: 'down', part: index });
    }
  }

  /**
   * A guard is down: one on the walk falls with the physics, and so does the captain if his block
   * of the keep went from under him; hit, the captain sinks where he stands.
   */
  #guardDown(index: number, by: GuardDownBy): void {
    const state = this.guards[index];
    const tracked = this.#guardBodies[index];
    const body = tracked?.body;
    if (!state || !tracked || !body || state.down) return;
    state.down = true;
    state.by = by;
    state.hp = 0;
    state.walking = false;
    if (this.#tally) this.#tally.guards++;
    const at = copy(body.translation());
    if (state.role === 'guard' || by === 'fall') {
      body.setBodyType(this.#physics.RigidBodyType.Dynamic, true);
      const collider = tracked.colliders[0];
      collider?.setCollisionGroups(groups(GUARD, GROUND | PART | SPEAR));
      collider?.setSolverGroups(groups(GUARD, GROUND | PART | SPEAR));
      // His head goes back, away from the ballista, and he topples.
      const from = this.mount();
      const away = { x: at.x - from.x, z: at.z - from.z };
      const flat = Math.hypot(away.x, away.z) || 1;
      const push = this.rules.guard.topple * body.mass();
      body.applyImpulseAtPoint(
        { x: (away.x / flat) * push, y: 0, z: (away.z / flat) * push },
        { x: at.x, y: at.y + state.size[1] / 2, z: at.z },
        true,
      );
    }
    this.#hooks.logger.log('siege.guardDown', {
      guard: index,
      role: state.role,
      by,
      vantage: this.vantages[this.#vantage]?.id,
      throws: this.#throws,
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'guardDown', guard: index, at, by });
  }

  /**
   * Spears and loose parts that have been still long enough stop costing the physics: a spear
   * stops being a body (stuck in the part it lies in, or lying where it is), a part is fixed where
   * it lies (resting on what it touches). Spears off the field are gone.
   */
  #settle(dt: number): void {
    const { speed, spin, spearSeconds, partSeconds } = this.rules.settle;
    const reach = this.rules.physics.groundReach;
    this.spears.forEach((spear, index) => {
      const tracked = this.#spearBodies[index];
      const body = tracked?.body;
      if (!tracked || !body) return;
      readPose(body, tracked.now);
      const at = tracked.now.position;
      if (
        at.y < -OFF_FIELD ||
        Math.abs(at.x - this.#middle[0]) > reach ||
        Math.abs(at.z - this.#middle[1]) > reach
      ) {
        spear.flying = false;
        spear.gone = true;
        this.#dropBody(tracked);
        return;
      }
      if (spear.flying) return;
      tracked.still = length(body.linvel()) < speed ? tracked.still + dt : 0;
      if (tracked.still < spearSeconds) return;
      // In a part: it goes where the part goes.
      const part = this.#touching(tracked.colliders).find(
        (other) => this.parts[other]?.mode !== 'broken',
      );
      const partPose = part === undefined ? undefined : this.#partBodies[part]?.now;
      if (part !== undefined && partPose) {
        this.#stuck.set(index, { part, local: relative(partPose, tracked.now) });
      }
      spear.frozen = true;
      this.#dropBody(tracked);
    });
    this.parts.forEach((state, index) => {
      const tracked = this.#partBodies[index];
      const body = tracked?.body;
      if (state.mode !== 'loose' || !tracked || !body) return;
      const still =
        body.isSleeping() || (length(body.linvel()) < speed && length(body.angvel()) < spin);
      tracked.still = still ? tracked.still + dt : 0;
      if (tracked.still < partSeconds) return;
      this.#supports[index] = this.#touching(tracked.colliders).filter(
        (other) => other !== index && this.parts[other]?.mode !== 'broken',
      );
      body.setBodyType(this.#physics.RigidBodyType.Fixed, false);
      state.mode = 'frozen';
      readPose(body, tracked.now);
      copyPose(tracked.now, tracked.before);
    });
  }

  /** The parts (by index) these colliders touch or nearly touch, in order. */
  #touching(colliders: Collider[]): number[] {
    const found = new Set<number>();
    for (const collider of colliders) {
      this.#world.contactPairsWith(collider, (other) => {
        const owner = this.#owners.get(other.handle);
        if (owner?.kind === 'part') found.add(owner.index);
      });
    }
    return [...found].sort((a, b) => a - b);
  }

  /** Takes a spear's body out of the world: it's no longer the physics' to move. */
  #dropBody(tracked: Tracked): void {
    const body = tracked.body;
    if (!body) return;
    readPose(body, tracked.now);
    copyPose(tracked.now, tracked.before);
    for (const collider of tracked.colliders) this.#owners.delete(collider.handle);
    this.#world.removeRigidBody(body);
    tracked.body = undefined;
  }

  /** What an objective's check sees. */
  #objectiveView(objective: number) {
    const captain = this.guards.find((guard) => guard.role === 'captain');
    const rack = this.parts.find((part) => part.kind === 'rack');
    return {
      captainDown: captain?.down === true,
      rackBroken: rack?.mode === 'broken',
      guardsDown: this.guards.filter(
        (guard) => guard.role === 'guard' && guard.objective === objective && guard.down,
      ).length,
    };
  }

  /** Each objective's progress: told and logged as it moves on; all done, the round's won. */
  #checkObjectives(now: number): void {
    this.plan.objectives.forEach((objective, index) => {
      const before = this.progress[index];
      const after = objectiveProgress(objective, this.#objectiveView(index));
      if (!before || after.done === before.done) return;
      this.progress[index] = after;
      const complete = after.done >= after.needed;
      this.#hooks.logger.log('siege.objective', {
        objective: index,
        kind: objective.kind,
        done: after.done,
        needed: after.needed,
        complete,
        throws: this.#throws,
        vantage: this.vantages[this.#vantage]?.id,
        step: this.#steps,
      });
      this.#hooks.onEvent({
        type: 'objective',
        objective: index,
        done: after.done,
        needed: after.needed,
        complete,
      });
    });
    if (this.phase === 'aim' && this.done >= this.progress.length) {
      this.phase = 'won';
      this.#wonAt = now;
      this.#hooks.onEvent({ type: 'won' });
    }
  }

  /** Nothing is moving faster than the settle speeds. */
  #calm(): boolean {
    const { speed, spin } = this.rules.settle;
    const still = (body: Body | undefined, turning: boolean) => {
      if (!body || body.isSleeping() || !body.isDynamic()) return true;
      return length(body.linvel()) < speed && (!turning || length(body.angvel()) < spin);
    };
    // A spear lying on the ground jiggles round its length, quickly for something so thin, while
    // going nowhere: only how fast it moves counts.
    return (
      this.#partBodies.every((tracked) => still(tracked.body, true)) &&
      this.#guardBodies.every((tracked) => still(tracked.body, true)) &&
      this.#spearBodies.every((tracked) => still(tracked.body, false))
    );
  }

  /** Parts broken, by kind (wall chunk, battlement …). */
  #partsBroken(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const part of this.parts) {
      if (part.mode === 'broken') counts[part.kind] = (counts[part.kind] ?? 0) + 1;
    }
    return counts;
  }

  /** Logs what the last throw did: parts broken and come loose, guards down. */
  #logTally(): void {
    const tally = this.#tally;
    if (!tally) return;
    this.#tally = undefined;
    this.#hooks.logger.log('siege.throwDone', {
      throw: this.#throws,
      mode: tally.mode,
      partsBroken: tally.broken,
      partsLoosened: tally.loosened,
      guardsDown: tally.guards,
      step: this.#steps,
    });
  }

  #finish(ending: SiegeEnding): void {
    this.#logTally();
    const partsDown = this.partsDown;
    const guardsDown = this.guardsDown;
    const done = this.done;
    const rewards = siegeRewards(
      {
        done,
        objectives: this.progress.length,
        throws: this.#throws,
        used: this.#used,
        partsDown,
        guardsDown,
      },
      this.rules,
      this.#recovery,
    );
    const result: SiegeResult = {
      ...rewards,
      ending,
      objectives: this.plan.objectives.map((objective, index) => ({
        kind: objective.kind,
        done: this.progress[index]?.done ?? 0,
        needed: this.progress[index]?.needed ?? 1,
      })),
      done,
      total: this.progress.length,
      used: this.#used,
      throws: this.#throws,
      par: this.rules.par,
      partsDown,
      partsBroken: this.partsBroken,
      guardsDown,
      damage: Math.round(this.#damage),
      seconds: round2(this.seconds),
    };
    this.phase = 'done';
    this.result = result;
    this.alpha = 1;
    this.#hooks.logger.log('siege.end', {
      ending,
      won: result.won,
      stars: result.stars,
      done,
      total: result.total,
      objectives: result.objectives,
      throws: result.throws,
      par: result.par,
      spearsUsed: result.used,
      xp: result.xp,
      recovered: result.recovered,
      partsDown,
      partsBroken: result.partsBroken,
      piecesBroken: this.#partsBroken(),
      guardsDown,
      damage: result.damage,
      vantage: this.vantages[this.#vantage]?.id,
      aimed: this.aimed,
      seed: this.#seed,
      seconds: result.seconds,
    });
    this.#hooks.finish(result);
    this.#hooks.onEvent({ type: 'end', result });
  }
}

const scratchPose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };

function track(body: Body, colliders: Collider[]): Tracked {
  const tracked: Tracked = {
    body,
    colliders,
    before: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    now: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    velocity: { x: 0, y: 0, z: 0 },
    still: 0,
  };
  readPose(body, tracked.now);
  copyPose(tracked.now, tracked.before);
  return tracked;
}

/** Notes a body's pose and velocity before a step. */
function remember(tracked: Tracked): void {
  const body = tracked.body;
  if (!body) return;
  readPose(body, tracked.before);
  const velocity = body.linvel();
  tracked.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
}

function readPose(body: Body, out: Pose): void {
  const at = body.translation();
  const turn = body.rotation();
  out.position.x = at.x;
  out.position.y = at.y;
  out.position.z = at.z;
  out.rotation.x = turn.x;
  out.rotation.y = turn.y;
  out.rotation.z = turn.z;
  out.rotation.w = turn.w;
}

function copyPose(from: Pose, to: Pose): void {
  to.position.x = from.position.x;
  to.position.y = from.position.y;
  to.position.z = from.position.z;
  to.rotation.x = from.rotation.x;
  to.rotation.y = from.rotation.y;
  to.rotation.z = from.rotation.z;
  to.rotation.w = from.rotation.w;
}

/** How much a body's velocity changed in the last step (m/s): a crash, if it's big. */
function suddenChange(tracked: Tracked): number {
  const velocity = tracked.body?.linvel();
  if (!velocity) return 0;
  return Math.hypot(
    velocity.x - tracked.velocity.x,
    velocity.y - tracked.velocity.y,
    velocity.z - tracked.velocity.z,
  );
}

/** A body's pose `alpha` of the way from before the last step to now (as it lies, if no body). */
function between(tracked: Tracked, alpha: number, out: Pose): Pose {
  const { position, rotation } = tracked.before;
  if (tracked.body) readPose(tracked.body, tracked.now);
  const at = tracked.now.position;
  const turn = tracked.now.rotation;
  out.position.x = position.x + (at.x - position.x) * alpha;
  out.position.y = position.y + (at.y - position.y) * alpha;
  out.position.z = position.z + (at.z - position.z) * alpha;
  // Normalised lerp, the short way round: plenty for one step's turn.
  const dot = rotation.x * turn.x + rotation.y * turn.y + rotation.z * turn.z + rotation.w * turn.w;
  const s = dot < 0 ? -1 : 1;
  const x = rotation.x + (turn.x * s - rotation.x) * alpha;
  const y = rotation.y + (turn.y * s - rotation.y) * alpha;
  const z = rotation.z + (turn.z * s - rotation.z) * alpha;
  const w = rotation.w + (turn.w * s - rotation.w) * alpha;
  const size = Math.hypot(x, y, z, w) || 1;
  out.rotation.x = x / size;
  out.rotation.y = y / size;
  out.rotation.z = z / size;
  out.rotation.w = w / size;
  return out;
}

/** A turn of `angle` radians about y, as a rotation. */
export function turnQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** `v` turned by `q`. */
function rotate(q: Quat, v: Vec3): Vec3 {
  const turned = multiply(multiply(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conjugate(q));
  return { x: turned.x, y: turned.y, z: turned.z };
}

/** `child` (a world pose) in `parent`'s frame. */
function relative(parent: Pose, child: Pose): Pose {
  const inverse = conjugate(parent.rotation);
  const offset = rotate(inverse, {
    x: child.position.x - parent.position.x,
    y: child.position.y - parent.position.y,
    z: child.position.z - parent.position.z,
  });
  return { position: offset, rotation: multiply(inverse, child.rotation) };
}

/** `local` (in `parent`'s frame) in the world. */
function compose(parent: Pose, local: Pose, out: Pose): Pose {
  const offset = rotate(parent.rotation, local.position);
  const turn = multiply(parent.rotation, local.rotation);
  out.position.x = parent.position.x + offset.x;
  out.position.y = parent.position.y + offset.y;
  out.position.z = parent.position.z + offset.z;
  out.rotation.x = turn.x;
  out.rotation.y = turn.y;
  out.rotation.z = turn.z;
  out.rotation.w = turn.w;
  return out;
}

/** How far (degrees) a body has tipped from how it was turned at first: its up axis's tilt. */
function tiltBetween(start: Quat, now: Quat): number {
  const up = rotate(multiply(now, conjugate(start)), { x: 0, y: 1, z: 0 });
  return Math.acos(Math.min(Math.max(up.y, -1), 1)) / DEG;
}

/** The rotation that turns a spear's length (its local y) along `direction`. */
export function alongY(direction: Vec3): Quat {
  const size = Math.hypot(direction.x, direction.y, direction.z);
  if (size < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  const bx = direction.x / size;
  const by = direction.y / size;
  const bz = direction.z / size;
  // Straight down: half a turn about x.
  if (by < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  // (0, 1, 0) × b, and 1 + (0, 1, 0) · b, normalised.
  const x = bz;
  const z = -bx;
  const w = 1 + by;
  const norm = Math.hypot(x, z, w);
  return { x: x / norm, y: 0, z: z / norm, w: w / norm };
}

/** How far a body has turned from upright, in degrees. */
export function tiltOf(rotation: Quat): number {
  const up = rotate(rotation, { x: 0, y: 1, z: 0 });
  return Math.acos(Math.min(Math.max(up.y, -1), 1)) / DEG;
}

/** The front end of a spear: `reach` along its length from the middle. */
function tip(body: Body, reach: number): Vec3 {
  const at = body.translation();
  const way = rotate(body.rotation(), { x: 0, y: 1, z: 0 });
  return { x: at.x + way.x * reach, y: at.y + way.y * reach, z: at.z + way.z * reach };
}

function length(vector: Vec3 | undefined): number {
  return vector ? Math.hypot(vector.x, vector.y, vector.z) : 0;
}

function copy(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
