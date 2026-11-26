import { Rng, type EventLogger } from '../../../core';
import type {
  GameData,
  Siege,
  SiegeBlock,
  SiegeFeel,
  SiegeFort,
  SiegeGuard,
  SiegeMaterial,
  SiegePosition,
  SiegeWeapon,
} from '../../../data';
import { objectiveMet } from './objective';
import type { Physics } from './physics';
import { siegeRewards, type SiegeRewards } from './score';
import {
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

/** What was hit: a block or a guard, by its index in `blocks` or `guards`. */
export type Target = { kind: 'block' | 'guard'; index: number };

/** What happened in a step, for the view's juice (and the tests). */
export type SiegeEvent =
  /** The ballista shoots `spears` spears; each leaves on its own `launch` (now or a moment later). */
  | { type: 'throw'; mode: ThrowMode; spears: number }
  /** A spear left the ballista: its index in `spears`. */
  | { type: 'launch'; spear: number }
  /** A spear hit a block or a guard at `speed` m/s, dealing `damage` (it may have broken it). */
  | {
      type: 'hit';
      spear: number;
      target: Target;
      kind: MaterialKind | 'guard';
      speed: number;
      damage: number;
      at: Vec3;
    }
  /**
   * Every impact on a block or a guard, for rules to hook into (damage now; noise, say, later):
   * a spear's first touch on it, or a sudden change of its speed over `crashMinSpeed` (a crash).
   */
  | {
      type: 'impact';
      target: Target;
      material: string;
      kind: MaterialKind | 'guard';
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
  /** A guard is down (no hit points left, or knocked over). */
  | { type: 'guardDown'; guard: number; at: Vec3 }
  /** The ballista set off for spot `spot` of the position it's at. */
  | { type: 'spot'; spot: number }
  /** Position `position` is won; the ballista rolls on to the next in a moment. */
  | { type: 'positionWon'; position: number }
  /** The ballista has arrived at position `position`. */
  | { type: 'arrived'; position: number }
  /** The banner has tipped far enough to be falling. */
  | { type: 'bannerFalling' }
  /** The last position is won: the fort has fallen. The round ends once it settles. */
  | { type: 'won' }
  | { type: 'end'; result: SiegeResult };

export interface SiegeResult extends SiegeRewards {
  fort: string;
  won: boolean;
  /** Spears shot. */
  used: number;
  /** Throws: shots of the ballista, aimed or barrage alike, over every position (what stars count). */
  throws: number;
  /** Throws at each position, in order. */
  throwsPerPosition: number[];
  par: number;
  /** Blocks knocked down or broken (each counted once). */
  blocksDown: number;
  blocksBroken: number;
  guardsDown: number;
  /** Damage dealt to blocks and guards, by spears and crashes. */
  damage: number;
  /** Round time (physics seconds). */
  seconds: number;
}

/**
 * Aiming (and shooting); a position won and the ballista about to roll on to the next; the fort
 * has fallen and is settling; or the round is over.
 */
export type SiegePhase = 'aim' | 'advance' | 'won' | 'done';

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
  /** For the shots' random stray: the same seed and shots replay the same round. */
  seed: number;
  /** Start at this position (for tests): the ones before it count as passed. */
  position?: number;
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

/** One of the fort's guards. */
export interface GuardState {
  guard: SiegeGuard;
  /** The position it guards. */
  position: number;
  hp: number;
  maxHp: number;
  down: boolean;
}

/** A shot spear. */
export interface SpearState {
  /** Still in its first flight: nothing touched yet, so it flies nose first. */
  flying: boolean;
  /** The throw it was part of. */
  throwIndex: number;
}

/** A spear of a shot still on the ballista: it leaves on step `at`. */
interface Pending {
  at: number;
  launch: Launch;
  throwIndex: number;
}

/** The ballista moving from one spot to another, over round time `at` to `at + seconds`. */
interface Move {
  /** Where it rolls through, from where it was to where it's going. */
  points: Spot[];
  at: number;
  seconds: number;
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
 * How far past a broken block's own size bodies are woken (metres): as far as anything resting
 * on it can reach (the widest floor in a fort).
 */
const WAKE_REACH = 3;

/**
 * One siege: a fort of blocks and guards in a Rapier physics world, the ballista and the spears
 * it shoots, and the rules round them. The fort is taken position by position: win one (its
 * guards down, or at the last the banner) and the ballista rolls on to the next. The world is
 * stepped at a fixed rate (`advance` turns real time into whole steps), so the same shots on the
 * same steps, with the same seed, always go the same way. With no spears left, you lose once
 * everything has settled.
 */
export class SiegeRound {
  readonly fort: SiegeFort;
  readonly rules: Siege;
  readonly blocks: BlockState[];
  readonly guards: GuardState[] = [];
  readonly spears: SpearState[] = [];
  readonly bannerIndex: number;
  /** Spears in an aimed volley. */
  readonly aimed: number;
  /** What shoots the spears. */
  readonly weapon: SiegeWeapon;
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
  readonly #guardBodies: Tracked[] = [];
  readonly #spearBodies: Tracked[] = [];
  /** Which block, guard or spear each collider belongs to. */
  readonly #colliders = new Map<number, { kind: 'block' | 'guard' | 'spear'; index: number }>();
  /** Spear and target pairs already reported as hits. */
  readonly #hits = new Set<string>();
  readonly #lastThud: number[];
  readonly #throwsAt: number[];
  #position: number;
  #spot = 0;
  #move: Move | undefined;
  /** Won the position at `at`; rolling on to `next`. */
  #advance: { at: number; next: number; rolling: boolean } | undefined;
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
    this.aimed = options.aimed;
    this.weapon = siegeWeapon(data.siege);
    this.#physics = physics;
    this.#hooks = hooks;
    this.#recovery = data.tuning.weaponRecoveryOnWin;
    this.#rng = new Rng(options.seed);
    this.#position = Math.min(Math.max(options.position ?? 0, 0), fort.positions.length - 1);
    this.#throwsAt = fort.positions.map(() => 0);
    this.#spot = middleSpot(fort.positions[this.#position]);
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

    // The fort starts awake, every block resting exactly on the ones below (checked at startup),
    // so it stands still on its own; the engine puts it to sleep once it's still. (Starting it
    // asleep was worse: blocks put to sleep before their contacts are known drift once woken.)
    this.blocks = fort.blocks.map((block, index) => {
      const material = this.rules.materials.find((entry) => entry.id === block.material);
      if (!material) throw new Error(`Unknown material "${block.material}"`);
      const [x, y, z] = block.at;
      const tracked = this.#addBox(
        { x, y, z },
        block.size,
        { density: material.density, friction: material.friction },
        material.restitution,
        { kind: 'block', index },
      );
      this.#blockBodies.push(tracked);
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
    const { guard: rules } = this.rules;
    fort.positions.forEach((position, positionIndex) => {
      for (const guard of position.guards) {
        const [x, y, z] = guard.at;
        const index = this.guards.length;
        this.#guardBodies.push(
          this.#addBox(
            { x, y: y + rules.size[1] / 2, z },
            rules.size,
            { density: rules.density, friction: rules.friction },
            0,
            { kind: 'guard', index },
          ),
        );
        this.guards.push({
          guard,
          position: positionIndex,
          hp: rules.hp,
          maxHp: rules.hp,
          down: false,
        });
      }
    });
    this.#lastThud = this.blocks.map(() => -Infinity);
    this.bannerIndex = fort.blocks.findIndex((block) => block.banner);

    hooks.logger.log('siege.start', {
      fort: fort.id,
      blocks: fort.blocks.length,
      par: fort.par,
      spears: hooks.spears(),
      aimed: options.aimed,
      seed: options.seed,
      positions: fort.positions.map((position) => ({
        name: position.name,
        objective: position.objective.kind,
        guards: position.guards.length,
        spots: position.spots.length,
      })),
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

  /** Spears shot so far. */
  get used(): number {
    return this.#used;
  }

  /** Throws so far: shots of the ballista. */
  get throws(): number {
    return this.#throws;
  }

  /** The position the ballista is at (or leaving). */
  get position(): number {
    return this.#position;
  }

  get currentPosition(): SiegePosition {
    const position = this.fort.positions[this.#position];
    if (!position) throw new Error('No position');
    return position;
  }

  /** The spot the ballista is at (or moving to), at its position. */
  get spot(): number {
    return this.#spot;
  }

  /** Blocks knocked down or broken, each counted once. */
  get blocksDown(): number {
    return this.blocks.filter((block) => block.down || block.broken).length;
  }

  get blocksBroken(): number {
    return this.blocks.filter((block) => block.broken).length;
  }

  get guardsDown(): number {
    return this.guards.filter((guard) => guard.down).length;
  }

  /** Guards still up at the ballista's position. */
  get guardsLeft(): number {
    return this.guards.filter((guard) => guard.position === this.#position && !guard.down).length;
  }

  /** Damage dealt so far, by spears and crashes. */
  get damage(): number {
    return this.#damage;
  }

  /** Where the ballista is now: at its spot, or on its way to the next. */
  ballista(): Spot {
    const move = this.#move;
    if (!move) return this.#spotAt(this.#position, this.#spot);
    const share = Math.min(Math.max((this.seconds - move.at) / move.seconds, 0), 1);
    // Eased: it sets off and pulls up gently, at an even pace along the way between.
    const eased = share * share * (3 - 2 * share);
    return alongPath(move.points, eased);
  }

  /** The ballista is moving (between spots, or on to the next position). */
  get moving(): boolean {
    return this.#move !== undefined || this.phase === 'advance';
  }

  /** The last shot is still leaving the ballista, or its spears are in the air and it's too soon. */
  get reloading(): boolean {
    if (this.#pending.length > 0) return true;
    const last = this.#lastThrow;
    if (!last) return false;
    if (this.seconds - last.at >= this.#hooks.feel().reloadSeconds) return false;
    return this.spears.some((spear) => spear.throwIndex === last.index && spear.flying);
  }

  /** Whether the ballista can shoot now: aiming, still, loaded, and at least a spear left. */
  get canThrow(): boolean {
    return this.phase === 'aim' && !this.moving && !this.reloading && this.#hooks.spears() >= 1;
  }

  /** Sends the ballista to another spot of its position. Returns false if it can't go now. */
  moveTo(spot: number): boolean {
    const spots = this.currentPosition.spots;
    if (this.phase !== 'aim' || this.moving || spot === this.#spot || !spots[spot]) return false;
    this.#move = {
      points: [this.ballista(), this.#spotAt(this.#position, spot)],
      at: this.seconds,
      seconds: this.#hooks.feel().spotSeconds,
    };
    this.#spot = spot;
    this.#hooks.logger.log('siege.spot', {
      fort: this.fort.id,
      position: this.#position,
      spot,
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'spot', spot });
    return true;
  }

  /**
   * The ballista shoots (taking the spears from the warchest), if it can. Spears that leave
   * straight away go on the next step; the rest of a volley a moment after.
   */
  throw(mode: ThrowMode, aim: Aim): boolean {
    if (!this.canThrow) return false;
    const feel = this.#hooks.feel();
    const spears = shotSpears(
      mode,
      aim,
      this.ballista(),
      this.aimed,
      this.#hooks.spears(),
      this.weapon,
      feel,
      this.#rng,
    );
    this.#hooks.spend(spears.length);
    this.#used += spears.length;
    const index = this.#throws++;
    this.#throwsAt[this.#position] = (this.#throwsAt[this.#position] ?? 0) + 1;
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
      fort: this.fort.id,
      mode,
      yaw: Math.round((aim.yaw / DEG) * 10) / 10,
      tilt: Math.round((aim.tilt / DEG) * 10) / 10,
      spears: spears.length,
      position: this.#position,
      spot: this.#spot,
      sightBlend: feel.sightBlend,
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
    for (const tracked of [...this.#blockBodies, ...this.#guardBodies, ...this.#spearBodies]) {
      if (!tracked.gone) remember(tracked);
    }
    this.#world.step(this.#queue);
    this.#steps++;
    const now = this.seconds;

    // Blocks hit this step, broken once everything's been counted (in order, so it replays).
    const breaking = new Set<number>();
    this.#queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const a = this.#colliders.get(first);
      const b = this.#colliders.get(second);
      const spear = a?.kind === 'spear' ? a : b?.kind === 'spear' ? b : undefined;
      if (!spear) return;
      const other = spear === a ? b : a;
      const target =
        other && other.kind !== 'spear' ? { kind: other.kind, index: other.index } : undefined;
      this.#spearTouched(spear.index, target, feel, breaking);
    });

    const { damage } = this.rules;
    this.#blockBodies.forEach((tracked, index) => {
      const state = this.blocks[index];
      if (!state || tracked.gone || tracked.body.isSleeping()) return;
      const change = suddenChange(tracked);
      if (change > damage.crashMinSpeed) {
        const amount = (change - damage.crashMinSpeed) * damage.crashPerSpeed;
        this.#impact({ kind: 'block', index }, 'crash', change, amount);
        if (this.#hurt({ kind: 'block', index }, amount)) breaking.add(index);
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

    this.#guardBodies.forEach((tracked, index) => {
      const state = this.guards[index];
      if (!state || state.down || tracked.body.isSleeping()) return;
      const change = suddenChange(tracked);
      if (change > damage.crashMinSpeed) {
        const amount = (change - damage.crashMinSpeed) * damage.crashPerSpeed;
        this.#impact({ kind: 'guard', index }, 'crash', change, amount);
        this.#hurt({ kind: 'guard', index }, amount);
      }
      if (state.hp <= 0 || tiltOf(tracked.body.rotation()) >= this.rules.guard.downTilt) {
        this.#guardDown(index);
      }
    });

    const banner = this.#blockBodies[this.bannerIndex];
    const standing = banner && !banner.gone ? banner.body : undefined;
    if (standing && !this.#bannerFalling) {
      if (tiltOf(standing.rotation()) >= this.rules.banner.fallTilt) {
        this.#bannerFalling = true;
        this.#hooks.onEvent({ type: 'bannerFalling' });
      }
    }

    // The ballista arriving at a spot, or at the next position.
    const move = this.#move;
    if (move && now >= move.at + move.seconds) {
      this.#move = undefined;
      const advance = this.#advance;
      if (advance?.rolling) {
        this.#advance = undefined;
        this.#position = advance.next;
        this.#spot = middleSpot(this.currentPosition);
        this.phase = 'aim';
        this.#hooks.logger.log('siege.position', {
          fort: this.fort.id,
          position: this.#position,
          name: this.currentPosition.name,
          throws: this.#throws,
          step: this.#steps,
        });
        this.#hooks.onEvent({ type: 'arrived', position: this.#position });
      }
    }
    const advance = this.#advance;
    if (advance && !advance.rolling && now >= advance.at + feel.advanceDelaySeconds) {
      advance.rolling = true;
      const next = this.fort.positions[advance.next];
      this.#move = {
        points: [
          this.ballista(),
          ...(next?.approach ?? []).map(([x, z]) => ({ x, z })),
          this.#spotAt(advance.next, middleSpot(next)),
        ],
        at: now,
        seconds: feel.advanceSeconds,
      };
    }

    const view = {
      rules: this.rules,
      bannerHeight: standing?.translation().y,
      guardsLeft: this.guardsLeft,
    };
    if (this.phase === 'aim' && objectiveMet(this.currentPosition.objective, view)) {
      const next = this.#position + 1;
      if (next >= this.fort.positions.length) {
        this.phase = 'won';
        this.#wonAt = now;
        this.#hooks.onEvent({ type: 'won' });
      } else {
        this.phase = 'advance';
        this.#advance = { at: now, next, rolling: false };
        this.#hooks.onEvent({ type: 'positionWon', position: this.#position });
      }
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

  guardPose(index: number, out: Pose): Pose {
    const tracked = this.#guardBodies[index];
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

  /** Leaving mid-round: the shot spears are spent. */
  quit(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.#hooks.logger.log('siege.quit', {
      fort: this.fort.id,
      used: this.#used,
      position: this.#position,
      blocksDown: this.blocksDown,
      guardsDown: this.guardsDown,
      seconds: round2(this.seconds),
    });
  }

  /** Frees the physics world. The round can't be used after. */
  dispose(): void {
    this.#queue.free();
    this.#world.free();
  }

  #spotAt(position: number, spot: number): Spot {
    const at = this.fort.positions[position]?.spots[spot] ?? [0, 0];
    return { x: at[0], z: at[1] };
  }

  /** A box body: a block, or a guard. */
  #addBox(
    at: Vec3,
    size: readonly [number, number, number],
    stuff: { density: number; friction: number },
    restitution: number,
    owner: { kind: 'block' | 'guard'; index: number },
  ): Tracked {
    const physics = this.#physics;
    const body = this.#world.createRigidBody(
      physics.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z),
    );
    const collider = this.#world.createCollider(
      physics.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setDensity(stuff.density)
        .setFriction(stuff.friction)
        .setRestitution(restitution)
        .setCollisionGroups(groups(BLOCK, GROUND | BLOCK | SPEAR)),
      body,
    );
    this.#colliders.set(collider.handle, owner);
    return track(body, collider.handle);
  }

  /** Sends off every spear of the last shot whose moment has come. */
  #launchDue(feel: SiegeFeel): void {
    if (this.#pending.length === 0) return;
    const due = this.#pending.filter((pending) => pending.at <= this.#steps);
    this.#pending = this.#pending.filter((pending) => pending.at > this.#steps);
    for (const pending of due) {
      const spear = this.#addSpear(pending, feel);
      this.#hooks.onEvent({ type: 'launch', spear });
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
    this.spears.push({ flying: true, throwIndex: pending.throwIndex });
    return index;
  }

  /** A spear touched a block or a guard (or the ground, `target` undefined). */
  #spearTouched(
    index: number,
    target: Target | undefined,
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
    if (!target) {
      if (speed >= feel.thudSpeed) this.#hooks.onEvent({ type: 'land', spear: index, speed, at });
      return;
    }
    const key = `${String(index)}:${target.kind}:${String(target.index)}`;
    if (this.#hits.has(key) || this.#gone(target)) return;
    this.#hits.add(key);
    const { spearMinSpeed, spearPerSpeed } = this.rules.damage;
    const damage = Math.max(speed - spearMinSpeed, 0) * spearPerSpeed;
    this.#impact(target, 'spear', speed, damage);
    if (this.#hurt(target, damage) && target.kind === 'block') breaking.add(target.index);
    if (speed < feel.thudSpeed && damage <= 0) return;
    this.#hooks.onEvent({
      type: 'hit',
      spear: index,
      target,
      kind: this.#kindOf(target),
      speed,
      damage: round2(damage),
      at,
    });
  }

  #kindOf(target: Target): MaterialKind | 'guard' {
    return target.kind === 'guard' ? 'guard' : (this.blocks[target.index]?.kind ?? 'stone');
  }

  /** Broken (a block) or down (a guard): spears and crashes do it no more harm. */
  #gone(target: Target): boolean {
    return target.kind === 'block'
      ? this.blocks[target.index]?.broken !== false
      : this.guards[target.index]?.down !== false;
  }

  #impact(target: Target, by: 'spear' | 'crash', speed: number, damage: number): void {
    if (this.#gone(target)) return;
    const material =
      target.kind === 'guard' ? 'guard' : (this.blocks[target.index]?.block.material ?? '');
    this.#hooks.onEvent({
      type: 'impact',
      target,
      material,
      kind: this.#kindOf(target),
      by,
      speed: round2(speed),
      damage: round2(damage),
    });
  }

  /** Deals `amount` damage to a block or a guard. Returns true if that leaves it with none. */
  #hurt(target: Target, amount: number): boolean {
    const state = target.kind === 'block' ? this.blocks[target.index] : this.guards[target.index];
    if (!state || this.#gone(target) || amount <= 0) return false;
    const dealt = Math.min(amount, state.hp);
    state.hp -= dealt;
    this.#damage += dealt;
    return state.hp <= 0;
  }

  /** A guard is down: pushed over if it's still standing, and it lies where it falls. */
  #guardDown(index: number): void {
    const state = this.guards[index];
    const tracked = this.#guardBodies[index];
    if (!state || !tracked || state.down) return;
    state.down = true;
    state.hp = 0;
    const { body } = tracked;
    const at = copy(body.translation());
    if (tiltOf(body.rotation()) < this.rules.guard.downTilt) {
      // Its head goes back, away from the ballista, and it topples.
      const { size, topple } = this.rules.guard;
      body.applyImpulseAtPoint(
        { x: 0, y: 0, z: -topple * body.mass() },
        { x: at.x, y: at.y + size[1] / 2, z: at.z },
        true,
      );
    }
    this.#hooks.logger.log('siege.guardDown', {
      fort: this.fort.id,
      guard: index,
      position: state.position,
      atPosition: this.#position,
      step: this.#steps,
    });
    this.#hooks.onEvent({ type: 'guardDown', guard: index, at });
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
    // Whatever rested on it falls: wake everything near it before taking it away. (Asleep, a
    // body resting on it would stay up in the air; resting bodies don't always still list their
    // contacts once asleep, so it goes by distance.)
    const reach = Math.hypot(...state.block.size) / 2 + WAKE_REACH;
    for (const other of [...this.#blockBodies, ...this.#guardBodies]) {
      if (other.gone || other === tracked) continue;
      const there = other.body.translation();
      if (Math.hypot(there.x - at.x, there.y - at.y, there.z - at.z) <= reach) other.body.wakeUp();
    }
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
      [...this.#blockBodies, ...this.#guardBodies].every((tracked) => still(tracked, true)) &&
      this.#spearBodies.every((tracked) => still(tracked, false))
    );
  }

  /** Blocks broken, by the kind of piece they were part of (wall, gate, keep …). */
  #piecesBroken(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const state of this.blocks) {
      if (state.broken) counts[state.block.pieceKind] = (counts[state.block.pieceKind] ?? 0) + 1;
    }
    return counts;
  }

  #finish(won: boolean): void {
    const blocksDown = this.blocksDown;
    const guardsDown = this.guardsDown;
    const rewards = siegeRewards(
      { won, used: this.#used, throws: this.#throws, blocksDown, guardsDown },
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
      throwsPerPosition: [...this.#throwsAt],
      par: this.fort.par,
      blocksDown,
      blocksBroken: this.blocksBroken,
      guardsDown,
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
      throwsPerPosition: result.throwsPerPosition,
      spearsUsed: result.used,
      par: result.par,
      stars: result.stars,
      xp: result.xp,
      recovered: result.recovered,
      blocksDown,
      blocksBroken: result.blocksBroken,
      piecesBroken: this.#piecesBroken(),
      guardsDown,
      damage: result.damage,
      position: this.#position,
      aimed: this.aimed,
      seconds: result.seconds,
    });
    this.#hooks.finish(result);
    this.#hooks.onEvent({ type: 'end', result });
  }
}

/** The point `share` (0 to 1) of the way along a path of points, by distance. */
function alongPath(points: Spot[], share: number): Spot {
  const legs = points.slice(1).map((to, index) => {
    const from = points[index] ?? to;
    return { from, to, length: Math.hypot(to.x - from.x, to.z - from.z) };
  });
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  let left = share * total;
  for (const leg of legs) {
    if (left <= leg.length || leg === legs.at(-1)) {
      const part = leg.length > 0 ? Math.min(left / leg.length, 1) : 1;
      return {
        x: leg.from.x + (leg.to.x - leg.from.x) * part,
        z: leg.from.z + (leg.to.z - leg.from.z) * part,
      };
    }
    left -= leg.length;
  }
  return points.at(-1) ?? { x: 0, z: 0 };
}

/** The spot a position starts at: the one nearest the middle of the field. */
function middleSpot(position: SiegePosition | undefined): number {
  const spots = position?.spots ?? [];
  let best = 0;
  spots.forEach(([x], index) => {
    if (Math.abs(x) < Math.abs(spots[best]?.[0] ?? Infinity)) best = index;
  });
  return best;
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

/** How much a body's velocity changed in the last step (m/s): a crash, if it's big. */
function suddenChange(tracked: Tracked): number {
  const velocity = tracked.body.linvel();
  return Math.hypot(
    velocity.x - tracked.velocity.x,
    velocity.y - tracked.velocity.y,
    velocity.z - tracked.velocity.z,
  );
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
