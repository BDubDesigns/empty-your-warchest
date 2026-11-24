import { Rng } from '../../core/rng';
import {
  byId,
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
  readonly total: number;
  left: number;
}

export interface TrackWall {
  readonly kind: 'wall';
  readonly at: number;
  readonly maxHp: number;
  hp: number;
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
  | { type: 'flip'; index: number; side: Side }
  | { type: 'clashStart'; index: number; enemies: number; squad: number; armed: number }
  | {
      type: 'trade';
      index: number;
      fighter: Fighter;
      killed: number;
      squad: number;
      enemies: number;
    }
  | { type: 'clashWon'; index: number; squad: number; armed: number }
  | { type: 'wallStart'; index: number; squad: number; armed: number }
  | { type: 'wallHit'; index: number; fighter: Fighter; damage: number; hp: number; spent: boolean }
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
  runner: Pick<RunnerData, 'trackWidth' | 'trackMetersPerSecond' | 'edgeMargin' | 'clash'>;
  feel: RunnerFeel;
  /** Spear qualities, worst to best. */
  qualities: readonly string[];
  seed: number | string;
}

/**
 * The Attack Run's rules: pure, fixed-step and seeded, so the same inputs and seed always give
 * the same run. The rules decide every outcome; the view only animates the events.
 */
export class RunnerSim {
  readonly squad: Squad;
  readonly track: readonly TrackEvent[];
  readonly length: number;
  readonly halfWidth: number;
  /** Distance travelled (m). */
  distance = 0;
  /** Squad centre, sideways (m, 0 = middle, negative = left). */
  x = 0;
  phase: Phase = 'running';
  seconds = 0;
  steps = 0;
  #feel: RunnerFeel;
  readonly #config: RunnerConfig;
  readonly #rng: Rng;
  #next = 0;
  #timer = 0;
  #gap = 0;
  #enemiesBeaten = 0;
  readonly #losses: Record<LossCause, number> = { gate: 0, enemies: 0, wall: 0 };
  #result: RunResult | undefined;

  constructor(config: RunnerConfig) {
    this.#config = config;
    this.#feel = config.feel;
    this.#rng = new Rng(config.seed);
    const { feel, level, runner } = config;
    this.squad = new Squad(config.qualities, {
      ...Object.fromEntries(config.qualities.map((quality) => [quality, 0])),
      ...spearSupply(config.qualities, feel),
    });
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
          return { kind: 'enemies', at, enemy: event.enemy, total: event.count, left: event.count };
        case 'wall':
          return { kind: 'wall', at, maxHp: event.hp, hp: event.hp };
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

  /** A gate's current form: its flipped side once flipped. */
  activeGate(gate: TrackGate): Pick<Gate, 'op' | 'value'> {
    return gate.flipped && gate.base.flip ? gate.base.flip : gate.base;
  }

  /**
   * The ghost of the new count if the squad keeps to its side, once the next gate pair is within
   * reading distance.
   */
  preview(): (GatePreview & { side: Side; index: number }) | undefined {
    const event = this.nextEvent;
    if (!event || event.kind !== 'gates' || this.phase !== 'running') return undefined;
    if (event.at - this.distance > this.#feel.runSpeed * this.#feel.gateReadSeconds) {
      return undefined;
    }
    const side = this.side;
    return {
      side,
      index: this.#next,
      ...previewGate(this.squad, this.activeGate(event[side])),
    };
  }

  /** Damage one unit deals: the unarmed value or its spear's. */
  damageOf(fighter: Fighter): number {
    const unit = this.#config.unit;
    if (fighter === UNARMED) return unit.unarmedDamage;
    return unit.weapon.damageByQuality[fighter] ?? 0;
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
      // Enemies and the wall stop the squad where it meets them.
      this.distance = event.at;
      this.#gap = event.kind === 'enemies' ? this.#feel.tradeSeconds : this.#feel.wallHitSeconds;
      this.#timer = this.#gap;
      const { count: squad, armedCount: armed } = this.squad;
      if (event.kind === 'enemies') {
        this.phase = 'clash';
        events.push({ type: 'clashStart', index, enemies: event.left, squad, armed });
      } else {
        this.phase = 'wall';
        events.push({ type: 'wallStart', index, squad, armed });
      }
      return;
    }
  }

  /** The squad attacks a flip gate on its side while it's in range, filling its bar. */
  #attackFlipGates(dt: number, events: RunnerEvent[]): void {
    const event = this.nextEvent;
    if (!event || event.kind !== 'gates') return;
    if (event.at - this.distance > this.#feel.flipRange) return;
    const side = this.side;
    const gate = event[side];
    const flip = gate.base.flip;
    if (!flip || gate.flipped) return;
    gate.flipPoints += this.#squadDamage() * this.#feel.flipAttackRate * dt;
    if (gate.flipPoints >= flip.hp) {
      gate.flipPoints = flip.hp;
      gate.flipped = true;
      events.push({ type: 'flip', index: this.#next, side });
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

  /** Front-line trade: one pair at a time, speeding up as it goes. */
  #clash(dt: number, events: RunnerEvent[]): void {
    const event = this.nextEvent;
    if (!event || event.kind !== 'enemies') return;
    this.#timer -= dt;
    while (this.#timer <= 0 && this.phase === 'clash') {
      const fighter = this.squad.front();
      if (fighter === undefined) break;
      const { killChance, unarmedKillChance, doubleChance } = this.#config.runner.clash;
      const kills = fighter === UNARMED ? unarmedKillChance : (killChance[fighter] ?? 1);
      let killed = 0;
      if (this.#rng.chance(kills)) {
        killed = fighter !== UNARMED && this.#rng.chance(doubleChance[fighter] ?? 0) ? 2 : 1;
      }
      killed = Math.min(killed, event.left);
      event.left -= killed;
      this.#enemiesBeaten += killed;
      this.squad.lose(1);
      this.#losses.enemies++;
      events.push({
        type: 'trade',
        index: this.#next,
        fighter,
        killed,
        squad: this.squad.count,
        enemies: event.left,
      });
      if (event.left === 0) {
        const index = this.#next;
        this.#next++;
        this.phase = 'running';
        events.push({
          type: 'clashWon',
          index,
          squad: this.squad.count,
          armed: this.squad.armedCount,
        });
      } else if (this.squad.count === 0) {
        this.#finish(false, events, 'enemies');
      } else {
        this.#nextGap();
      }
    }
  }

  /** The squad spends itself on the palisade, one hit at a time. */
  #wall(dt: number, events: RunnerEvent[]): void {
    const wall = this.nextEvent;
    if (!wall || wall.kind !== 'wall') return;
    this.#timer -= dt;
    while (this.#timer <= 0 && this.phase === 'wall') {
      const fighter = this.squad.front();
      if (fighter === undefined) break;
      const damage = this.damageOf(fighter);
      wall.hp = Math.max(0, wall.hp - damage);
      // The hit that breaks the wall leaves its unit standing: breaking it with one unit wins.
      const spent = wall.hp > 0;
      if (spent) {
        this.squad.lose(1);
        this.#losses.wall++;
      }
      events.push({ type: 'wallHit', index: this.#next, fighter, damage, hp: wall.hp, spent });
      if (wall.hp === 0) {
        this.#next++;
        this.#finish(true, events);
      } else if (this.squad.count === 0) {
        this.#finish(false, events, 'wall');
      } else {
        this.#nextGap();
      }
    }
  }

  #nextGap(): void {
    this.#gap = Math.max(this.#feel.tradeMinSeconds, this.#gap * this.#feel.tradeSpeedup);
    this.#timer += this.#gap;
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

/** The spears a run starts with, by quality, from the debug sliders. */
export function spearSupply(
  qualities: readonly string[],
  feel: Pick<RunnerFeel, 'spearsPoor' | 'spearsGood' | 'spearsPerfect'>,
): Record<string, number> {
  // The sliders are named for the three tiers in data, worst to best.
  const counts = [feel.spearsPoor, feel.spearsGood, feel.spearsPerfect];
  return Object.fromEntries(qualities.map((quality, index) => [quality, counts[index] ?? 0]));
}

/** The War tent's run from game data: its level, unit and spear tiers. */
export function runnerConfig(
  data: GameData,
  feel: RunnerFeel,
  seed: number | string,
): RunnerConfig {
  const level = byId(data.levels, data.runner.level);
  return {
    level,
    unit: byId(data.units, level.unit),
    runner: data.runner,
    feel,
    qualities: data.qualities.map((quality) => quality.id),
    seed,
  };
}
