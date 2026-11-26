import { Rng, type EventLogger } from '../../../core';
import type {
  GameData,
  Siege,
  SiegeBlock,
  SiegeFeel,
  SiegeFort,
  SiegeMaterial,
} from '../../../data';
import { objectiveMet } from './objective';
import type { Physics } from './physics';
import { siegeRewards, type SiegeRewards } from './score';
import {
  flightPath,
  previewLaunches,
  throwSpears,
  type Aim,
  type Launch,
  type ThrowMode,
  type Vec3,
} from './throw';

type World = InstanceType<Physics['World']>;
type Body = ReturnType<World['createRigidBody']>;
type EventQueue = InstanceType<Physics['EventQueue']>;

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

/** What happened in a step, for the view's juice (and the tests). */
export type SiegeEvent =
  /** The line throws `spears` spears; each leaves on its own `launch` (now or a moment later). */
  | { type: 'throw'; mode: ThrowMode; spears: number }
  /** A spear left a thrower's hand: its index in `spears`. */
  | { type: 'launch'; spear: number; thrower: number }
  /** A spear hit a block at `speed` m/s, dealing `damage` (it may have broken it). */
  | {
      type: 'hit';
      spear: number;
      block: number;
      kind: MaterialKind;
      speed: number;
      damage: number;
      at: Vec3;
    }
  /**
   * Every impact on a block, for rules to hook into (damage now; noise, say, later): a spear's
   * first touch on it, or a sudden change of its speed over `crashMinSpeed` (a crash).
   */
  | {
      type: 'impact';
      block: number;
      material: string;
      kind: MaterialKind;
      by: 'spear' | 'crash';
      speed: number;
      damage: number;
    }
  /** A spear came down on the ground. */
  | { type: 'land'; spear: number; speed: number; at: Vec3 }
  /** A block slammed into something: its speed changed by `speed` m/s in a step. */
  | { type: 'thud'; block: number; kind: MaterialKind; speed: number; at: Vec3 }
  /** A block ran out of hit points and broke: it's gone from the world. */
  | { type: 'break'; block: number; kind: MaterialKind; at: Vec3 }
  /** A block counted as knocked down. */
  | { type: 'down'; block: number }
  /** The banner has tipped far enough to be falling. */
  | { type: 'bannerFalling' }
  /** The banner is down: the fort has fallen. The round ends once it settles. */
  | { type: 'won' }
  | { type: 'end'; result: SiegeResult };

export interface SiegeResult extends SiegeRewards {
  fort: string;
  won: boolean;
  /** Spears thrown. */
  used: number;
  /** Throws: releases of the line, aimed or barrage alike (what stars count). */
  throws: number;
  par: number;
  /** Blocks knocked down or broken (each counted once). */
  blocksDown: number;
  blocksBroken: number;
  /** Damage dealt to blocks, by spears and crashes. */
  damage: number;
  /** Round time (physics seconds). */
  seconds: number;
}

/** Aiming (and throwing); the fort has fallen and is settling; or the round is over. */
export type SiegePhase = 'aim' | 'won' | 'done';

export interface SiegeHooks {
  logger: EventLogger;
  feel: () => SiegeFeel;
  /** Spears left in the warchest. */
  spears: () => number;
  /** Takes thrown spears out of the warchest. */
  spend: (count: number) => void;
  /** Pays what the round earned (XP, recovered spears). */
  finish: (result: SiegeResult) => void;
  onEvent: (event: SiegeEvent) => void;
}

export interface SiegeOptions {
  /** Throwers in the line (from the Command level). */
  throwers: number;
  /** For the throws' random stray: the same seed and throws replay the same round. */
  seed: number;
}

/** One of the fort's blocks, as the round sees it. */
export interface BlockState {
  block: SiegeBlock;
  kind: MaterialKind;
  start: Vec3;
  /** Hit points: full at `maxHp`, broken at 0. */
  hp: number;
  maxHp: number;
  down: boolean;
  broken: boolean;
}

/** A thrown spear. */
export interface SpearState {
  /** Still in its first flight: nothing touched yet, so it flies nose first. */
  flying: boolean;
  /** The throw it was part of, and who threw it. */
  throwIndex: number;
  thrower: number;
}

/** A spear of a throw still in its thrower's hand: it leaves on step `at`. */
interface Pending {
  at: number;
  launch: Launch;
  throwIndex: number;
  thrower: number;
}

interface Tracked {
  body: Body;
  collider: number;
  /** Its pose before the last step, so the view can draw between steps. */
  before: Pose;
  /** Its velocity before the last step, to tell a sudden change (a thud). */
  velocity: Vec3;
  /** Taken out of the world (a broken block): never touch `body` again. */
  gone: boolean;
}

const DEG = Math.PI / 180;
/** Collision groups (membership << 16 | what it collides with): spears never hit each other. */
const GROUND = 0x0001;
const BLOCK = 0x0002;
const SPEAR = 0x0004;
const groups = (member: number, filter: number) => (member << 16) | filter;

/**
 * One siege: a fort of blocks in a Rapier physics world, the line of throwers and the spears they
 * throw at it, and the rules round them. The world is stepped at a fixed rate (`advance` turns
 * real time into whole steps), so the same throws on the same steps, with the same seed, always
 * knock the fort down the same way. You win when the banner comes down; with no spears left, you
 * lose once everything has settled.
 */
export class SiegeRound {
  readonly fort: SiegeFort;
  readonly rules: Siege;
  readonly blocks: BlockState[];
  readonly spears: SpearState[] = [];
  readonly bannerIndex: number;
  /** Throwers in the line. */
  readonly throwers: number;
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
  readonly #blockBodies: Tracked[] = [];
  readonly #spearBodies: Tracked[] = [];
  /** Which block or spear each collider belongs to. */
  readonly #colliders = new Map<number, { kind: 'block' | 'spear'; index: number }>();
  /** Spear and block pairs already reported as hits. */
  readonly #hits = new Set<string>();
  readonly #lastThud: number[];
  #pending: Pending[] = [];
  #steps = 0;
  #carry = 0;
  #used = 0;
  #damage = 0;
  #throws = 0;
  #lastThrow: { at: number; index: number } | undefined;
  #calmFor = 0;
  #wonAt = 0;
  #bannerFalling = false;

  constructor(
    physics: Physics,
    data: Pick<GameData, 'siege' | 'tuning'>,
    fortId: string,
    hooks: SiegeHooks,
    options: SiegeOptions,
  ) {
    const fort = data.siege.forts.find((entry) => entry.id === fortId);
    if (!fort) throw new Error(`Unknown fort "${fortId}"`);
    this.fort = fort;
    this.rules = data.siege;
    this.throwers = options.throwers;
    this.#physics = physics;
    this.#hooks = hooks;
    this.#recovery = data.tuning.weaponRecoveryOnWin;
    this.#rng = new Rng(options.seed);
    const settings = this.rules.physics;
    this.#world = new physics.World({ x: 0, y: -settings.gravity, z: 0 });
    this.#world.timestep = settings.timestep;
    this.#world.numSolverIterations = settings.solverIterations;
    this.#queue = new physics.EventQueue(true);

    const ground = this.#world.createRigidBody(physics.RigidBodyDesc.fixed());
    const reach = settings.groundReach;
    this.#world.createCollider(
      physics.ColliderDesc.cuboid(reach, 0.5, reach)
        .setTranslation(0, -0.5, 0)
        .setFriction(settings.groundFriction)
        .setCollisionGroups(groups(GROUND, BLOCK | SPEAR)),
      ground,
    );

    this.blocks = fort.blocks.map((block, index) => {
      const material = this.rules.materials.find((entry) => entry.id === block.material);
      if (!material) throw new Error(`Unknown material "${block.material}"`);
      const [x, y, z] = block.at;
      const body = this.#world.createRigidBody(
        physics.RigidBodyDesc.dynamic().setTranslation(x, y, z),
      );
      const collider = this.#world.createCollider(
        physics.ColliderDesc.cuboid(block.size[0] / 2, block.size[1] / 2, block.size[2] / 2)
          .setDensity(material.density)
          .setFriction(material.friction)
          .setRestitution(material.restitution)
          .setCollisionGroups(groups(BLOCK, GROUND | BLOCK | SPEAR)),
        body,
      );
      this.#colliders.set(collider.handle, { kind: 'block', index });
      this.#blockBodies.push(track(body, collider.handle));
      const hp = block.hp ?? material.hp;
      return {
        block,
        kind: material.kind,
        start: { x, y, z },
        hp,
        maxHp: hp,
        down: false,
        broken: false,
      };
    });
    // The fort starts awake, every block resting exactly on the ones below (checked at startup),
    // so it stands still on its own; the engine puts it to sleep once it's still. (Starting it
    // asleep was worse: blocks put to sleep before their contacts are known drift once woken.)
    this.#lastThud = this.blocks.map(() => -Infinity);
    this.bannerIndex = fort.blocks.findIndex((block) => block.banner);

    hooks.logger.log('siege.start', {
      fort: fort.id,
      blocks: fort.blocks.length,
      par: fort.par,
      spears: hooks.spears(),
      throwers: options.throwers,
      seed: options.seed,
      feel: hooks.feel(),
    });
  }

  /** Round time, in physics seconds. */
  get seconds(): number {
    return this.#steps * this.rules.physics.timestep;
  }

  get steps(): number {
    return this.#steps;
  }

  /** Spears thrown so far. */
  get used(): number {
    return this.#used;
  }

  /** Throws so far: releases of the line. */
  get throws(): number {
    return this.#throws;
  }

  /** Blocks knocked down or broken, each counted once. */
  get blocksDown(): number {
    return this.blocks.filter((block) => block.down || block.broken).length;
  }

  get blocksBroken(): number {
    return this.blocks.filter((block) => block.broken).length;
  }

  /** Damage dealt so far, by spears and crashes. */
  get damage(): number {
    return this.#damage;
  }

  /** The last throw is still leaving the line, or its spears are in the air and it's too soon. */
  get reloading(): boolean {
    if (this.#pending.length > 0) return true;
    const last = this.#lastThrow;
    if (!last) return false;
    if (this.seconds - last.at >= this.#hooks.feel().reloadSeconds) return false;
    return this.spears.some((spear) => spear.throwIndex === last.index && spear.flying);
  }

  /** Whether the line can throw now: aiming, not reloading, and at least a spear left. */
  get canThrow(): boolean {
    return this.phase === 'aim' && !this.reloading && this.#hooks.spears() >= 1;
  }

  /** The dotted arcs while aiming: the first part of the flight, longer for an aimed throw. */
  preview(mode: ThrowMode, aim: Aim, points: number): Vec3[][] {
    const feel = this.#hooks.feel();
    const seconds = mode === 'aimed' ? feel.aimedPreviewSeconds : feel.barragePreviewSeconds;
    return previewLaunches(mode, aim, this.throwers, this.rules, feel).map((launch) =>
      flightPath(launch, this.rules.physics.gravity, seconds, points),
    );
  }

  /**
   * The whole line throws (taking the spears from the warchest), if it can. Spears that leave
   * straight away go on the next step; a barrage's later ones a moment after.
   */
  throw(mode: ThrowMode, aim: Aim): boolean {
    if (!this.canThrow) return false;
    const feel = this.#hooks.feel();
    const spears = throwSpears(
      mode,
      aim,
      this.throwers,
      this.#hooks.spears(),
      this.rules,
      feel,
      this.#rng,
    );
    this.#hooks.spend(spears.length);
    this.#used += spears.length;
    const index = this.#throws++;
    const { timestep } = this.rules.physics;
    for (const spear of spears) {
      this.#pending.push({
        at: this.#steps + Math.round(spear.delay / timestep),
        launch: spear,
        throwIndex: index,
        thrower: spear.thrower,
      });
    }
    this.#lastThrow = { at: this.seconds, index };
    this.#calmFor = 0;
    this.#hooks.logger.log('siege.throw', {
      fort: this.fort.id,
      mode,
      power: round2(aim.power),
      angle: Math.round((aim.yaw / DEG) * 10) / 10,
      spears: spears.length,
      throwers: this.throwers,
      left: this.#hooks.spears(),
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'throw', mode, spears: spears.length });
    this.#launchDue(feel);
    return true;
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
    const feel = this.#hooks.feel();
    this.#launchDue(feel);
    // A spear in flight flies nose first (its weight is up front), until it first touches.
    this.spears.forEach((spear, index) => {
      const tracked = this.#spearBodies[index];
      if (!spear.flying || !tracked) return;
      tracked.body.setRotation(alongY(tracked.body.linvel()), false);
      tracked.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    });
    for (const tracked of [...this.#blockBodies, ...this.#spearBodies]) {
      if (!tracked.gone) remember(tracked);
    }
    this.#world.step(this.#queue);
    this.#steps++;

    // Blocks hit this step, broken once everything's been counted (in order, so it replays).
    const breaking = new Set<number>();
    this.#queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const a = this.#colliders.get(first);
      const b = this.#colliders.get(second);
      const spear = a?.kind === 'spear' ? a : b?.kind === 'spear' ? b : undefined;
      if (!spear) return;
      const other = spear === a ? b : a;
      const block = other?.kind === 'block' ? other.index : undefined;
      this.#spearTouched(spear.index, block, feel, breaking);
    });

    const now = this.seconds;
    const { damage } = this.rules;
    this.#blockBodies.forEach((tracked, index) => {
      const state = this.blocks[index];
      if (!state || tracked.gone || tracked.body.isSleeping()) return;
      const velocity = tracked.body.linvel();
      const change = Math.hypot(
        velocity.x - tracked.velocity.x,
        velocity.y - tracked.velocity.y,
        velocity.z - tracked.velocity.z,
      );
      if (change > damage.crashMinSpeed) {
        const amount = (change - damage.crashMinSpeed) * damage.crashPerSpeed;
        this.#impact(index, 'crash', change, amount);
        if (this.#hurt(index, amount)) breaking.add(index);
      }
      if (change >= feel.thudSpeed && now - (this.#lastThud[index] ?? 0) >= feel.thudGapSeconds) {
        this.#lastThud[index] = now;
        this.#hooks.onEvent({
          type: 'thud',
          block: index,
          kind: state.kind,
          speed: change,
          at: copy(tracked.body.translation()),
        });
      }
      if (!state.down) {
        const at = tracked.body.translation();
        const tilt = tiltOf(tracked.body.rotation());
        if (state.start.y - at.y >= this.rules.down.drop || tilt >= this.rules.down.tilt) {
          state.down = true;
          this.#hooks.onEvent({ type: 'down', block: index });
        }
      }
    });
    for (const index of [...breaking].sort((a, b) => a - b)) this.#break(index);

    const banner = this.#blockBodies[this.bannerIndex];
    const standing = banner && !banner.gone ? banner.body : undefined;
    if (standing && !this.#bannerFalling) {
      if (tiltOf(standing.rotation()) >= this.rules.banner.fallTilt) {
        this.#bannerFalling = true;
        this.#hooks.onEvent({ type: 'bannerFalling' });
      }
    }
    const view = { rules: this.rules, bannerHeight: standing?.translation().y };
    if (this.phase === 'aim' && objectiveMet(this.fort.objective, view)) {
      this.phase = 'won';
      this.#wonAt = now;
      this.#hooks.onEvent({ type: 'won' });
    }

    this.#calmFor = this.#calm() ? this.#calmFor + this.rules.physics.timestep : 0;
    const settled = this.#calmFor >= this.rules.settle.seconds;
    if (this.phase === 'won' && (settled || now - this.#wonAt >= this.rules.settle.winSeconds)) {
      this.#finish(true);
    } else if (
      this.phase === 'aim' &&
      settled &&
      this.#used > 0 &&
      this.#hooks.spears() < 1 &&
      this.#pending.length === 0 &&
      !this.spears.some((spear) => spear.flying)
    ) {
      this.#finish(false);
    }
  }

  /** Block `index`'s pose, drawn `alpha` of the way from its last step to its current one. */
  blockPose(index: number, out: Pose): Pose {
    const tracked = this.#blockBodies[index];
    return tracked ? between(tracked, this.alpha, out) : out;
  }

  spearPose(index: number, out: Pose): Pose {
    const tracked = this.#spearBodies[index];
    return tracked ? between(tracked, this.alpha, out) : out;
  }

  /** How fast spear `index` is going (m/s). */
  spearSpeed(index: number): number {
    const velocity = this.#spearBodies[index]?.body.linvel();
    return velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0;
  }

  /** Leaving mid-round: the thrown spears are spent. */
  quit(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.#hooks.logger.log('siege.quit', {
      fort: this.fort.id,
      used: this.#used,
      blocksDown: this.blocksDown,
      seconds: round2(this.seconds),
    });
  }

  /** Frees the physics world. The round can't be used after. */
  dispose(): void {
    this.#queue.free();
    this.#world.free();
  }

  /** Sends off every spear of the last throw whose moment has come. */
  #launchDue(feel: SiegeFeel): void {
    if (this.#pending.length === 0) return;
    const due = this.#pending.filter((pending) => pending.at <= this.#steps);
    this.#pending = this.#pending.filter((pending) => pending.at > this.#steps);
    for (const pending of due) {
      const spear = this.#addSpear(pending, feel);
      this.#hooks.onEvent({ type: 'launch', spear, thrower: pending.thrower });
    }
  }

  #addSpear(pending: Pending, feel: SiegeFeel): number {
    const physics = this.#physics;
    const spear = this.rules.projectile;
    const { position, velocity } = pending.launch;
    const body = this.#world.createRigidBody(
      physics.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(alongY(velocity))
        .setLinvel(velocity.x, velocity.y, velocity.z)
        // So a fast spear can't pass through a block between two steps.
        .setCcdEnabled(true),
    );
    const collider = this.#world.createCollider(
      physics.ColliderDesc.capsule(Math.max(spear.length / 2 - spear.radius, 0.01), spear.radius)
        .setMass(feel.spearMass)
        .setFriction(spear.friction)
        .setRestitution(spear.restitution)
        .setCollisionGroups(groups(SPEAR, GROUND | BLOCK))
        .setActiveEvents(physics.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const index = this.spears.length;
    this.#colliders.set(collider.handle, { kind: 'spear', index });
    this.#spearBodies.push(track(body, collider.handle));
    this.spears.push({ flying: true, throwIndex: pending.throwIndex, thrower: pending.thrower });
    return index;
  }

  /** A spear touched a block (or the ground, `block` undefined). */
  #spearTouched(
    index: number,
    block: number | undefined,
    feel: SiegeFeel,
    breaking: Set<number>,
  ): void {
    const spear = this.spears[index];
    const tracked = this.#spearBodies[index];
    if (!spear || !tracked) return;
    const before = tracked.velocity;
    const speed = Math.hypot(before.x, before.y, before.z);
    if (spear.flying) {
      spear.flying = false;
      tracked.body.setLinearDamping(this.rules.projectile.landedDamping);
      tracked.body.setAngularDamping(this.rules.projectile.landedSpinDamping);
    }
    const at = tip(tracked.body, this.rules.projectile.length / 2);
    if (block === undefined) {
      if (speed >= feel.thudSpeed) this.#hooks.onEvent({ type: 'land', spear: index, speed, at });
      return;
    }
    const key = `${String(index)}:${String(block)}`;
    const state = this.blocks[block];
    if (this.#hits.has(key) || !state || state.broken) return;
    this.#hits.add(key);
    const { spearMinSpeed, spearPerSpeed } = this.rules.damage;
    const damage = Math.max(speed - spearMinSpeed, 0) * spearPerSpeed;
    this.#impact(block, 'spear', speed, damage);
    if (this.#hurt(block, damage)) breaking.add(block);
    if (speed < feel.thudSpeed && damage <= 0) return;
    this.#hooks.onEvent({
      type: 'hit',
      spear: index,
      block,
      kind: state.kind,
      speed,
      damage: round2(damage),
      at,
    });
  }

  #impact(index: number, by: 'spear' | 'crash', speed: number, damage: number): void {
    const state = this.blocks[index];
    if (!state || state.broken) return;
    this.#hooks.onEvent({
      type: 'impact',
      block: index,
      material: state.block.material,
      kind: state.kind,
      by,
      speed: round2(speed),
      damage: round2(damage),
    });
  }

  /** Deals `amount` damage to a block. Returns true if that leaves it with none. */
  #hurt(index: number, amount: number): boolean {
    const state = this.blocks[index];
    if (!state || state.broken || amount <= 0) return false;
    const dealt = Math.min(amount, state.hp);
    state.hp -= dealt;
    this.#damage += dealt;
    return state.hp <= 0;
  }

  /** A block at 0 hit points breaks: out of the world, so what it held up falls. */
  #break(index: number): void {
    const state = this.blocks[index];
    const tracked = this.#blockBodies[index];
    if (!state || !tracked || tracked.gone) return;
    state.broken = true;
    state.hp = 0;
    const at = copy(tracked.body.translation());
    remember(tracked);
    // Whatever rested on it falls: wake the blocks it touched before taking it away.
    this.#world.contactPairsWith(tracked.body.collider(0), (other) => {
      other.parent()?.wakeUp();
    });
    this.#colliders.delete(tracked.collider);
    this.#world.removeRigidBody(tracked.body);
    tracked.gone = true;
    this.#hooks.onEvent({ type: 'break', block: index, kind: state.kind, at });
  }

  /** Nothing is moving faster than the settle speeds (resting bodies are asleep or nearly). */
  #calm(): boolean {
    const { speed, spin } = this.rules.settle;
    const still = ({ body, gone }: Tracked, turning: boolean) => {
      if (gone || body.isSleeping()) return true;
      const v = body.linvel();
      const w = body.angvel();
      return Math.hypot(v.x, v.y, v.z) < speed && (!turning || Math.hypot(w.x, w.y, w.z) < spin);
    };
    // A spear lying on the ground jiggles round its length, quickly for something so thin, while
    // going nowhere: only how fast it moves counts.
    return (
      this.#blockBodies.every((tracked) => still(tracked, true)) &&
      this.#spearBodies.every((tracked) => still(tracked, false))
    );
  }

  #finish(won: boolean): void {
    const blocksDown = this.blocksDown;
    const rewards = siegeRewards(
      { won, used: this.#used, throws: this.#throws, blocksDown },
      this.fort,
      this.rules,
      this.#recovery,
    );
    const result: SiegeResult = {
      ...rewards,
      fort: this.fort.id,
      won,
      used: this.#used,
      throws: this.#throws,
      par: this.fort.par,
      blocksDown,
      blocksBroken: this.blocksBroken,
      damage: Math.round(this.#damage),
      seconds: round2(this.seconds),
    };
    this.phase = 'done';
    this.result = result;
    this.alpha = 1;
    this.#hooks.logger.log('siege.end', {
      fort: result.fort,
      won,
      throws: result.throws,
      spearsUsed: result.used,
      par: result.par,
      stars: result.stars,
      xp: result.xp,
      recovered: result.recovered,
      blocksDown,
      blocksBroken: result.blocksBroken,
      damage: result.damage,
      throwers: this.throwers,
      seconds: result.seconds,
    });
    this.#hooks.finish(result);
    this.#hooks.onEvent({ type: 'end', result });
  }
}

function track(body: Body, collider: number): Tracked {
  const tracked: Tracked = {
    body,
    collider,
    before: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    velocity: { x: 0, y: 0, z: 0 },
    gone: false,
  };
  remember(tracked);
  return tracked;
}

/** Notes a body's pose and velocity before a step. */
function remember(tracked: Tracked): void {
  const { body, before } = tracked;
  const at = body.translation();
  const turn = body.rotation();
  const velocity = body.linvel();
  before.position.x = at.x;
  before.position.y = at.y;
  before.position.z = at.z;
  before.rotation.x = turn.x;
  before.rotation.y = turn.y;
  before.rotation.z = turn.z;
  before.rotation.w = turn.w;
  tracked.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
}

/** A body's pose `alpha` of the way from before the last step to now (where it was, if gone). */
function between(tracked: Tracked, alpha: number, out: Pose): Pose {
  const { position, rotation } = tracked.before;
  const at = tracked.gone ? position : tracked.body.translation();
  const turn = tracked.gone ? rotation : tracked.body.rotation();
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
  const length = Math.hypot(x, y, z, w) || 1;
  out.rotation.x = x / length;
  out.rotation.y = y / length;
  out.rotation.z = z / length;
  out.rotation.w = w / length;
  return out;
}

/** The rotation that turns a spear's length (its local y) along `direction`. */
export function alongY(direction: Vec3): Quat {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  const bx = direction.x / length;
  const by = direction.y / length;
  const bz = direction.z / length;
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
  return (2 * Math.acos(Math.min(Math.abs(rotation.w), 1))) / DEG;
}

/** The front end of a spear: `reach` along its length from the middle. */
function tip(body: Body, reach: number): Vec3 {
  const at = body.translation();
  const q = body.rotation();
  // The local y axis, turned by q.
  const x = 2 * (q.x * q.y - q.w * q.z);
  const y = 1 - 2 * (q.x * q.x + q.z * q.z);
  const z = 2 * (q.y * q.z + q.w * q.x);
  return { x: at.x + x * reach, y: at.y + y * reach, z: at.z + z * reach };
}

function copy(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
