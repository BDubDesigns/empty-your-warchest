import {
  byId,
  type Enemy,
  type GameData,
  type Level,
  type RunnerData,
  type RunnerFeel,
  type Unit,
} from '../../data';
import { applyGate, isGoodOp, previewGate, type GateEffect, type GatePreview } from './gates';
import { rollLevel, type RolledGate } from './roll';
import { ARMED, Squad, UNARMED, type Fighter } from './squad';

/** The simulation's fixed time step (s). The view runs as many steps as real time needs. */
export const STEP_SECONDS = 1 / 60;

export type Side = 'left' | 'right';
export type Lane = Side | 'both';

/** One gate of a pair, as it stands on the track. */
export interface TrackGate {
  readonly base: RolledGate;
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
  /** Still standing: the armed lead, like the squad's spearmen, and fall first. */
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
      gate: GateEffect;
      good: boolean;
      before: number;
      after: number;
      armedBefore: number;
      armedAfter: number;
    }
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
      /** What the front enemy fights with. */
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
  runner: Pick<RunnerData, 'trackWidth' | 'trackMetersPerSecond' | 'edgeMargin' | 'guardGap'>;
  feel: RunnerFeel;
  /** Rolls the track from the level template; the same seed always gives the same run. */
  seed: number | string;
  /** Command level: scales the level template's rolls (bigger gates, bigger groups). */
  commandLevel: number;
  /** Spears the run can hand out: from the warchest, or the debug slider. */
  spears: number;
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
    const { level, runner } = config;
    this.squad = new Squad(config.spears);
    this.squad.recruit(level.startingRecruits);
    this.length = level.durationSeconds * runner.trackMetersPerSecond;
    this.halfWidth = runner.trackWidth / 2;
    const track: TrackEvent[] = [];
    for (const event of rollLevel(level, config.commandLevel, config.seed)) {
      const at = event.at * this.length;
      switch (event.type) {
        case 'gates': {
          const gates: TrackGates = {
            kind: 'gates',
            at,
            left: { base: event.left },
            right: { base: event.right },
            passed: false,
          };
          // A guarded gate's guards stand in its lane, just in front of it.
          for (const side of ['left', 'right'] as const) {
            const guards = event[side].guards;
            if (!guards) continue;
            track.push(
              this.#group(at - runner.guardGap, guards.enemy, side, guards.count, guards.armed),
            );
          }
          track.push(gates);
          break;
        }
        case 'enemies':
          track.push(this.#group(at, event.enemy, event.lane, event.count, event.armed));
          break;
        case 'wall':
          track.push({
            kind: 'wall',
            at,
            maxHp: event.hp,
            hp: event.hp,
            volleySeconds: event.archers.volleySeconds,
            perVolley: event.archers.perVolley,
          });
          break;
      }
    }
    this.track = track;
  }

  #group(at: number, enemy: string, lane: Lane, count: number, armed: number): TrackEnemies {
    return {
      kind: 'enemies',
      at,
      enemy,
      lane,
      total: count,
      totalArmed: armed,
      unarmed: count - armed,
      armed,
      frontHp: this.#enemyUnit(enemy).hp,
      avoided: false,
    };
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

  /** What a gate does to the squad. */
  activeGate(gate: TrackGate): GateEffect {
    return gate.base;
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
    return fighter === UNARMED ? unit.unarmedDamage : unit.weapon.damage;
  }

  /** What the front enemy of a group fights with. */
  enemyFront(group: TrackEnemies): Fighter {
    return group.armed > 0 ? ARMED : UNARMED;
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

  #squadDamage(): number {
    return (
      this.squad.unarmed * this.damageOf(UNARMED) + this.squad.armedCount * this.damageOf(ARMED)
    );
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
      before,
      after: this.squad.count,
      armedBefore,
      armedAfter: this.squad.armedCount,
    });
    if (this.squad.count === 0) this.#finish(false, events, 'gate');
  }

  /**
   * The front line: the squad's front soldier and the group's front enemy meet, one pair at a time.
   * A spear beats no spear outright; two spears (or two unarmed) swap blows until one falls (both
   * can), then the next steps up. Blows speed up so big fights don't drag.
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
      // Spear vs no spear: the spear wins in one blow. Spear vs spear: a duel.
      // No spear vs no spear: an even brawl. (Decided Nov 24: fists can't beat spears, so a gate is
      // only worth what you can arm.)
      const armed = fighter !== UNARMED;
      const enemyArmed = enemy !== UNARMED;
      if (armed && !enemyArmed) group.frontHp = 0;
      else if (!armed && enemyArmed) this.#frontHp = 0;
      else {
        group.frontHp -= this.damageOf(fighter);
        this.#frontHp -= this.damageOf(enemy, enemyUnit);
      }
      const enemyFell = group.frontHp <= 0;
      const unitFell = this.#frontHp <= 0;
      if (enemyFell) {
        if (group.armed > 0) group.armed--;
        else group.unarmed--;
        group.frontHp = enemyUnit.hp;
        this.#enemiesBeaten++;
      }
      if (unitFell) {
        this.squad.fall(1);
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
      const lost = this.squad.fall(wall.perVolley);
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

/** The War tent's run from game data: its level, unit and enemies. */
export function runnerConfig(
  data: GameData,
  feel: RunnerFeel,
  seed: number | string,
  options: { commandLevel: number; spears: number },
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
    seed,
    ...options,
  };
}

/** Spears recovered after a run: a share of those handed out on a win, none on a loss. */
export function recoveredSpears(used: number, won: boolean, recoveryOnWin: number): number {
  return won ? Math.floor(used * recoveryOnWin) : 0;
}
