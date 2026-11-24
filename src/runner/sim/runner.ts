import {
  byId,
  type Enemy,
  type GameData,
  type Gate,
  type Level,
  type RunnerData,
  type RunnerFeel,
  type Unit,
} from '../../data';
import { applyGate, isGoodOp, previewGate, type GatePreview } from './gates';
import { Squad, UNARMED, type Fighter } from './squad';

/** The simulation's fixed time step (s). The view runs as many steps as real time needs. */
export const STEP_SECONDS = 1 / 60;

export type Side = 'left' | 'right';
export type Lane = Side | 'both';

/** One gate of a pair, as it stands on the track. */
export interface TrackGate {
  readonly base: Gate;
  /** Attack points landed on a flip gate so far. */
  flipPoints: number;
  flipped: boolean;
}

export interface TrackGates {
  readonly kind: 'gates';
  /** Distance along the track (m). */
  readonly at: number;
  readonly left: TrackGate;
  readonly right: TrackGate;
  passed: boolean;
}

export interface TrackEnemies {
  readonly kind: 'enemies';
  readonly at: number;
  readonly enemy: string;
  readonly lane: Lane;
  readonly total: number;
  readonly totalArmed: number;
  /** Still standing: unarmed ones stand in front and fall first. */
  unarmed: number;
  armed: number;
  /** Hit points left on the enemy fighting at the front. */
  frontHp: number;
  /** True once the squad went past it in the other lane. */
  avoided: boolean;
}

export interface TrackWall {
  readonly kind: 'wall';
  readonly at: number;
  readonly maxHp: number;
  hp: number;
  readonly volleySeconds: number;
  readonly perVolley: number;
}

export type TrackEvent = TrackGates | TrackEnemies | TrackWall;

export type Phase = 'running' | 'clash' | 'wall' | 'won' | 'lost';
export type LossCause = 'gate' | 'enemies' | 'wall';

/** What happened during a step, for the view to animate and the logger to record. */
export type RunnerEvent =
  | {
      type: 'gate';
      index: number;
      side: Side;
      /** The gate as passed (its flipped form if it flipped). */
      gate: Pick<Gate, 'op' | 'value'>;
      good: boolean;
      flipped: boolean;
      before: number;
      after: number;
      armedBefore: number;
      armedAfter: number;
    }
  | { type: 'guardFell'; index: number; side: Side; guardsLeft: number }
  | { type: 'flip'; index: number; side: Side }
  | {
      type: 'clashStart';
      index: number;
      enemies: number;
      enemiesArmed: number;
      squad: number;
      armed: number;
    }
  | { type: 'avoided'; index: number }
  | {
      type: 'blow';
      index: number;
      fighter: Fighter;
      /** What the front enemy fights with: `UNARMED` or its spear quality. */
      enemy: Fighter;
      unitFell: boolean;
      enemyFell: boolean;
      squad: number;
      enemies: number;
    }
  | { type: 'clashWon'; index: number; squad: number; armed: number }
  | { type: 'wallStart'; index: number; squad: number; armed: number }
  | { type: 'wallHit'; index: number; hp: number }
  | { type: 'volley'; index: number; lost: Fighter[]; squad: number }
  | { type: 'won'; result: RunResult }
  | { type: 'lost'; cause: LossCause; result: RunResult };

export interface RunResult {
  won: boolean;
  survivors: number;
  /** Armed survivors. */
  armed: number;
  spearsUsed: number;
  enemiesBeaten: number;
  /** Units lost, by what took them. */
  losses: Record<LossCause, number>;
  seconds: number;
  cause?: LossCause;
}

export interface RunnerConfig {
  level: Level;
  unit: Unit;
  /** Each enemy kind and the unit whose numbers it fights with. */
  enemies: ReadonlyMap<string, { enemy: Enemy; unit: Unit }>;
  runner: Pick<RunnerData, 'trackWidth' | 'trackMetersPerSecond' | 'edgeMargin'>;
  feel: RunnerFeel;
  /** Spear qualities, worst to best. */
  qualities: readonly string[];
  /** Logged so a run can be found again; the rules themselves have no randomness yet. */
  seed: number | string;
}

/** Wall hit points between `wallHit` events, as a share of the wall, so the view can crack it. */
const WALL_HIT_STEP = 0.04;

/**
 * The Attack Run's rules: pure and fixed-step, so the same inputs always give the same run. The
 * rules decide every outcome; the view only animates the events.
 */
export class RunnerSim {
  readonly squad: Squad;
  readonly track: readonly TrackEvent[];
  readonly length: number;
  readonly halfWidth: number;
  readonly seed: number | string;
  /** Distance travelled by the squad's front line (m). */
  distance = 0;
  /** Squad centre, sideways (m, 0 = middle, negative = left). */
  x = 0;
  phase: Phase = 'running';
  seconds = 0;
  steps = 0;
  #feel: RunnerFeel;
  readonly #config: RunnerConfig;
  #next = 0;
  #timer = 0;
  #gap = 0;
  /** Hit points left on the squad's front fighter. */
  #frontHp = 0;
  #wallHitAt = 0;
  #enemiesBeaten = 0;
  readonly #losses: Record<LossCause, number> = { gate: 0, enemies: 0, wall: 0 };
  #result: RunResult | undefined;

  constructor(config: RunnerConfig) {
    this.#config = config;
    this.#feel = config.feel;
    this.seed = config.seed;
    const { feel, level, runner } = config;
    this.squad = new Squad(config.qualities, spearSupply(config.qualities, feel));
    this.squad.recruit(level.startingRecruits);
    this.length = level.durationSeconds * runner.trackMetersPerSecond;
    this.halfWidth = runner.trackWidth / 2;
    this.track = level.events.map((event): TrackEvent => {
      const at = event.at * this.length;
      switch (event.type) {
        case 'gates':
          return {
            kind: 'gates',
            at,
            left: { base: event.left, flipPoints: 0, flipped: false },
            right: { base: event.right, flipPoints: 0, flipped: false },
            passed: false,
          };
        case 'enemies':
          return {
            kind: 'enemies',
            at,
            enemy: event.enemy,
            lane: event.lane,
            total: event.count,
            totalArmed: event.armed,
            unarmed: event.count - event.armed,
            armed: event.armed,
            frontHp: this.#enemyUnit(event.enemy).hp,
            avoided: false,
          };
        case 'wall':
          return {
            kind: 'wall',
            at,
            maxHp: event.hp,
            hp: event.hp,
            volleySeconds: event.archers.volleySeconds,
            perVolley: event.archers.perVolley,
          };
      }
    });
  }

  get feel(): RunnerFeel {
    return this.#feel;
  }

  /** Live tuning: steering, speeds and timings change mid-run; spears apply from the next run. */
  setFeel(feel: RunnerFeel): void {
    this.#feel = feel;
  }

  get done(): boolean {
    return this.phase === 'won' || this.phase === 'lost';
  }

  get result(): RunResult | undefined {
    return this.#result;
  }

  /** The side of the track the squad's centre is on: it decides which gate it takes. */
  get side(): Side {
    return this.x < 0 ? 'left' : 'right';
  }

  /** How far the squad's centre may go from the middle (m). */
  get maxX(): number {
    return Math.max(0, this.halfWidth - this.#config.runner.edgeMargin);
  }

  /** Radius of the crowd blob (m): it grows with √count. */
  get crowdRadius(): number {
    return this.#feel.crowdSpread * Math.sqrt(Math.max(1, this.squad.count));
  }

  /** The event the squad meets next, if any. */
  get nextEvent(): TrackEvent | undefined {
    return this.track[this.#next];
  }

  get nextIndex(): number {
    return this.#next;
  }

  /** The next gate pair ahead, past any lane group in front of it. */
  get nextGates(): { event: TrackGates; index: number } | undefined {
    for (let index = this.#next; index < this.track.length; index++) {
      const event = this.track[index];
      if (event?.kind === 'gates') return { event, index };
      if (event?.kind !== 'enemies' || event.lane === 'both') return undefined;
    }
    return undefined;
  }

  /** A gate's current form: its flipped side once flipped. */
  activeGate(gate: TrackGate): Pick<Gate, 'op' | 'value'> {
    return gate.flipped && gate.base.flip ? gate.base.flip : gate.base;
  }

  /** True while the squad is close enough to a flip gate on its side to be attacking it. */
  attacking(gates: TrackGates, side: Side): boolean {
    const gate = gates[side];
    return (
      this.phase === 'running' &&
      gate.base.flip !== undefined &&
      !gate.flipped &&
      !gates.passed &&
      this.side === side &&
      gates.at - this.distance <= this.#feel.flipRange
    );
  }

  /**
   * The ghost of the new count if the squad keeps to its side, once the next gate pair is within
   * reading distance.
   */
  preview(): (GatePreview & { side: Side; index: number }) | undefined {
    const next = this.nextGates;
    if (!next || this.phase !== 'running') return undefined;
    if (next.event.at - this.distance > this.#feel.runSpeed * this.#feel.gateReadSeconds) {
      return undefined;
    }
    const side = this.side;
    return {
      side,
      index: next.index,
      ...previewGate(this.squad, this.activeGate(next.event[side])),
    };
  }

  /** Damage one unit deals: the unarmed value or its spear's. */
  damageOf(fighter: Fighter, unit: Unit = this.#config.unit): number {
    if (fighter === UNARMED) return unit.unarmedDamage;
    return unit.weapon.damageByQuality[fighter] ?? 0;
  }

  /** What the front enemy of a group fights with. */
  enemyFront(group: TrackEnemies): Fighter {
    return group.unarmed > 0 ? UNARMED : this.#enemy(group.enemy).weaponQuality;
  }

  /** Advances one fixed step, steering toward `targetX` (m). Returns what happened. */
  step(targetX: number): RunnerEvent[] {
    const events: RunnerEvent[] = [];
    if (this.done) return events;
    const dt = STEP_SECONDS;
    this.steps++;
    this.seconds += dt;
    this.#steer(targetX, dt);
    switch (this.phase) {
      case 'running':
        this.#run(dt, events);
        break;
      case 'clash':
        this.#clash(dt, events);
        break;
      case 'wall':
        this.#wall(dt, events);
        break;
      default:
        break;
    }
    return events;
  }

  #enemy(id: string): Enemy {
    const entry = this.#config.enemies.get(id);
    if (!entry) throw new Error(`Unknown enemy "${id}"`);
    return entry.enemy;
  }

  #enemyUnit(id: string): Unit {
    const entry = this.#config.enemies.get(id);
    if (!entry) throw new Error(`Unknown enemy "${id}"`);
    return entry.unit;
  }

  #steer(targetX: number, dt: number): void {
    const { steerSmoothing, steerSpeed } = this.#feel;
    const target = Math.max(-this.maxX, Math.min(this.maxX, targetX));
    const follow = steerSmoothing > 0 ? 1 - Math.exp(-dt / steerSmoothing) : 1;
    const wanted = (target - this.x) * follow;
    const limit = steerSpeed * dt;
    this.x += Math.max(-limit, Math.min(limit, wanted));
  }

  #run(dt: number, events: RunnerEvent[]): void {
    this.distance = Math.min(this.length, this.distance + this.#feel.runSpeed * dt);
    this.#attackFlipGates(dt, events);
    for (let event = this.nextEvent; event && this.distance >= event.at; event = this.nextEvent) {
      const index = this.#next;
      if (event.kind === 'gates') {
        this.#passGate(event, index, events);
        this.#next++;
        if (this.done) return;
        continue;
      }
      if (event.kind === 'enemies' && event.lane !== 'both' && event.lane !== this.side) {
        // A lane group only blocks a squad on its side.
        event.avoided = true;
        events.push({ type: 'avoided', index });
        this.#next++;
        continue;
      }
      // Enemies and the wall stop the squad where it meets them.
      this.distance = event.at;
      this.#frontHp = this.#config.unit.hp;
      const { count: squad, armedCount: armed } = this.squad;
      if (event.kind === 'enemies') {
        this.phase = 'clash';
        this.#gap = this.#feel.tradeSeconds;
        this.#timer = this.#gap;
        events.push({
          type: 'clashStart',
          index,
          enemies: event.unarmed + event.armed,
          enemiesArmed: event.armed,
          squad,
          armed,
        });
      } else {
        this.phase = 'wall';
        this.#timer = event.volleySeconds;
        this.#wallHitAt = event.hp - event.maxHp * WALL_HIT_STEP;
        events.push({ type: 'wallStart', index, squad, armed });
      }
      return;
    }
  }

  /** The squad attacks a flip gate on its side while it's in range, filling its bar. */
  #attackFlipGates(dt: number, events: RunnerEvent[]): void {
    const next = this.nextGates;
    if (!next) return;
    const side = this.side;
    if (!this.attacking(next.event, side)) return;
    const gate = next.event[side];
    const flip = gate.base.flip;
    if (!flip) return;
    const before = guardsLeft(gate);
    gate.flipPoints = Math.min(
      flip.hp,
      gate.flipPoints + this.#squadDamage() * this.#feel.flipAttackRate * dt,
    );
    const after = guardsLeft(gate);
    if (after < before && after > 0) {
      events.push({ type: 'guardFell', index: next.index, side, guardsLeft: after });
    }
    if (after === 0) {
      gate.flipPoints = flip.hp;
      gate.flipped = true;
      events.push({ type: 'flip', index: next.index, side });
    }
  }

  #squadDamage(): number {
    let damage = this.squad.unarmed * this.damageOf(UNARMED);
    for (const quality of this.squad.qualities) {
      damage += this.squad.armed(quality) * this.damageOf(quality);
    }
    return damage;
  }

  #passGate(event: TrackGates, index: number, events: RunnerEvent[]): void {
    event.passed = true;
    const side = this.side;
    const trackGate = event[side];
    const gate = this.activeGate(trackGate);
    const before = this.squad.count;
    const armedBefore = this.squad.armedCount;
    const lost = this.squad.resize(applyGate(before, gate));
    this.#losses.gate += lost.length;
    events.push({
      type: 'gate',
      index,
      side,
      gate,
      good: isGoodOp(gate.op),
      flipped: trackGate.flipped,
      before,
      after: this.squad.count,
      armedBefore,
      armedAfter: this.squad.armedCount,
    });
    if (this.squad.count === 0) this.#finish(false, events, 'gate');
  }

  /**
   * The front-line duel: the squad's front soldier and the group's front enemy swap blows until
   * one falls (both can), then the next steps up. Blows speed up so big fights don't drag.
   */
  #clash(dt: number, events: RunnerEvent[]): void {
    const group = this.nextEvent;
    if (!group || group.kind !== 'enemies') return;
    const enemyUnit = this.#enemyUnit(group.enemy);
    this.#timer -= dt;
    while (this.#timer <= 0 && this.phase === 'clash') {
      const fighter = this.squad.front();
      if (fighter === undefined) break;
      const enemy = this.enemyFront(group);
      group.frontHp -= this.damageOf(fighter);
      this.#frontHp -= this.damageOf(enemy, enemyUnit);
      const enemyFell = group.frontHp <= 0;
      const unitFell = this.#frontHp <= 0;
      if (enemyFell) {
        if (group.unarmed > 0) group.unarmed--;
        else group.armed--;
        group.frontHp = enemyUnit.hp;
        this.#enemiesBeaten++;
      }
      if (unitFell) {
        this.squad.lose(1);
        this.#losses.enemies++;
        this.#frontHp = this.#config.unit.hp;
      }
      const enemies = group.unarmed + group.armed;
      events.push({
        type: 'blow',
        index: this.#next,
        fighter,
        enemy,
        unitFell,
        enemyFell,
        squad: this.squad.count,
        enemies,
      });
      if (this.squad.count === 0) {
        // Losing your last soldier loses the fight, even if the last enemy fell with him.
        this.#finish(false, events, 'enemies');
      } else if (enemies === 0) {
        const index = this.#next;
        this.#next++;
        this.phase = 'running';
        events.push({
          type: 'clashWon',
          index,
          squad: this.squad.count,
          armed: this.squad.armedCount,
        });
      } else {
        this.#gap = Math.max(this.#feel.tradeMinSeconds, this.#gap * this.#feel.tradeSpeedup);
        this.#timer += this.#gap;
      }
    }
  }

  /**
   * The palisade: the whole squad hammers it at once while archers on the walkway fire volleys.
   * Break it before the volleys get everyone.
   */
  #wall(dt: number, events: RunnerEvent[]): void {
    const wall = this.nextEvent;
    if (!wall || wall.kind !== 'wall') return;
    wall.hp = Math.max(0, wall.hp - this.#squadDamage() * this.#feel.wallAttackRate * dt);
    if (wall.hp <= this.#wallHitAt || wall.hp === 0) {
      events.push({ type: 'wallHit', index: this.#next, hp: wall.hp });
      this.#wallHitAt = wall.hp - wall.maxHp * WALL_HIT_STEP;
    }
    if (wall.hp === 0) {
      this.#next++;
      this.#finish(true, events);
      return;
    }
    this.#timer -= dt;
    if (this.#timer <= 0) {
      this.#timer += wall.volleySeconds;
      const lost = this.squad.lose(wall.perVolley);
      this.#losses.wall += lost.length;
      events.push({ type: 'volley', index: this.#next, lost, squad: this.squad.count });
      if (this.squad.count === 0) this.#finish(false, events, 'wall');
    }
  }

  #finish(won: boolean, events: RunnerEvent[], cause?: LossCause): void {
    this.phase = won ? 'won' : 'lost';
    const result: RunResult = {
      won,
      survivors: this.squad.count,
      armed: this.squad.armedCount,
      spearsUsed: this.squad.spearsUsed,
      enemiesBeaten: this.#enemiesBeaten,
      losses: { ...this.#losses },
      seconds: this.seconds,
    };
    if (cause) result.cause = cause;
    this.#result = result;
    events.push(
      won ? { type: 'won', result } : { type: 'lost', cause: cause ?? 'enemies', result },
    );
  }
}

/** Guards still standing in front of a flip gate: each takes `hp / guards` attack points. */
export function guardsLeft(gate: TrackGate): number {
  const flip = gate.base.flip;
  if (!flip || gate.flipped) return 0;
  const perGuard = flip.hp / flip.guards;
  return Math.max(0, flip.guards - Math.floor(gate.flipPoints / perGuard + 1e-9));
}

/** The spears a run starts with, by quality, from the debug sliders. */
export function spearSupply(
  qualities: readonly string[],
  feel: Pick<RunnerFeel, 'spearsPoor' | 'spearsGood' | 'spearsPerfect'>,
): Record<string, number> {
  // The sliders are named for the three tiers in data, worst to best.
  const counts = [feel.spearsPoor, feel.spearsGood, feel.spearsPerfect];
  return Object.fromEntries(qualities.map((quality, index) => [quality, counts[index] ?? 0]));
}

/** The War tent's run from game data: its level, unit, enemies and spear tiers. */
export function runnerConfig(
  data: GameData,
  feel: RunnerFeel,
  seed: number | string,
): RunnerConfig {
  const level = byId(data.levels, data.runner.level);
  return {
    level,
    unit: byId(data.units, level.unit),
    enemies: new Map(
      data.enemies.map((enemy) => [enemy.id, { enemy, unit: byId(data.units, enemy.unit) }]),
    ),
    runner: data.runner,
    feel,
    qualities: data.qualities.map((quality) => quality.id),
    seed,
  };
}
