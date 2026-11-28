import { Rng, starBonus, type EventLogger, type Stack } from '../../../core';
import type { Archery, ArcheryFeel, ArrowKind } from '../../../data';
import { apex, clampAim, launch, stepArrow, type ArrowFlight } from './flight';
import { heightAt, planBirds, type BirdPlan } from './flock';

/** A bird of the round, where the rules have it. */
export interface LiveBird {
  plan: BirdPlan;
  /** Not in yet, crossing, shot down, or gone off the far side. */
  state: 'waiting' | 'flying' | 'down' | 'gone';
  x: number;
  y: number;
  /** How it's moving (field units a second), for the view (a shot bird tumbles on from this). */
  vx: number;
  vy: number;
  /** Seconds since it came in. */
  age: number;
  /** Field units a second, now (a scared bird flies faster), and before any scare. */
  speed: number;
  baseSpeed: number;
  /** Its hit radius (the data's, times the feel's). */
  radius: number;
  /** How many times it's been scared, the round time it last was, and when it was shot down. */
  scares: number;
  scaredAt: number | undefined;
  downAt: number | undefined;
}

/** An arrow shot this round. */
export interface ShotArrow {
  /** Its number in the round, from 0. */
  index: number;
  flight: ArrowFlight;
  draw: number;
  angle: number;
  firedAt: number;
  state: 'flying' | 'hit' | 'lost';
  /** The nearest it came to any bird's middle, and that bird's kind. */
  closest: number;
  closestBird: string | undefined;
  /** The bird it hit, and whether it broke (else it comes back). */
  bird: LiveBird | undefined;
  broke: boolean;
  /** Birds it grazed (and so scared) on the way past, and how far outside each one's hit radius. */
  scared: LiveBird[];
  grazes: number[];
  /**
   * How it's passing each bird, by the bird's number: its distance last step, whether it's coming
   * closer, and the nearest it's come on this pass.
   */
  readonly passing: Map<number, { last: number; closing: boolean; nearest: number }>;
}

export type ArcheryEndReason = 'time' | 'cleared' | 'empty';

/** How a round went. */
export interface ArcheryResult {
  shots: number;
  hits: number;
  scares: number;
  /** A point a hit and a point a scare, against par: every bird that flew by. */
  points: number;
  par: number;
  stars: number;
  /** Seeds banked (hits and scares), by item, and the bonus the stars added. */
  seeds: Stack[];
  bonus: Stack[];
  feathers: number;
  /** Arrows that came back with their bird, broke in it, and missed (lost). */
  returned: number;
  broken: number;
  lost: number;
  xp: number;
  /** Birds hit, by kind. */
  birds: Record<string, number>;
  seconds: number;
  reason: ArcheryEndReason;
}

/** Things a view plays effects for. */
export type ArcheryEvent =
  | { type: 'flock'; flock: number }
  | { type: 'shot'; arrow: ShotArrow }
  | { type: 'hit'; arrow: ShotArrow; bird: LiveBird; drops: Stack[]; xp: number }
  | { type: 'scare'; arrow: ShotArrow; bird: LiveBird; drops: Stack[] }
  | { type: 'lost'; arrow: ShotArrow }
  | ({ type: 'end' } & ArcheryResult);

export interface ArcheryHooks {
  logger: EventLogger;
  /** The Archery level: which flocks come. */
  level: number;
  seed: number;
  /** Arrows of a kind (its item) in the warchest. */
  count: (item: string) => number;
  /** Takes one arrow of a kind out of the warchest as it's shot. */
  spend: (item: string) => void;
  /**
   * Banks what a hit or a scared bird dropped, with a hit's XP, as it happens (and the stars'
   * bonus seeds at the end).
   */
  bank: (items: Stack[], xp: number) => void;
  onEvent?: (event: ArcheryEvent) => void;
}

/** The most steps of the rules one tick runs: a long stall slows the round, not snowballs it. */
const MAX_STEPS = 30;

/**
 * One round of the bird hunt, without any rendering: flocks cross the field on seeded paths, and
 * arrows shot from the bow fly in arcs; a hit downs a bird, a graze scares one. Runs in fixed
 * steps, so the same seed and the same shots at the same times play out the same. A view feeds it
 * shots and time, and draws it.
 */
export class ArcheryRound {
  readonly rules: Archery;
  /** The feel, fixed for the round (sliders apply from the next one). */
  readonly feel: ArcheryFeel;
  readonly birds: LiveBird[];
  readonly arrows: ShotArrow[] = [];
  readonly seed: number;
  phase: 'hunt' | 'done' = 'hunt';
  /** Seconds into the round, in whole steps. */
  now = 0;
  result: ArcheryResult | undefined;
  readonly #hooks: ArcheryHooks;
  readonly #drops: Rng;
  #carry = 0;
  #flocksIn = new Set<number>();
  #hits = 0;
  #scares = 0;
  #feathers = 0;
  #returned = 0;
  #broken = 0;
  #xp = 0;
  #seeds = new Map<string, number>();
  #byBird: Record<string, number> = {};

  constructor(rules: Archery, feel: ArcheryFeel, hooks: ArcheryHooks) {
    this.rules = rules;
    this.feel = { ...feel };
    this.seed = hooks.seed;
    this.#hooks = hooks;
    this.#drops = new Rng(`${String(hooks.seed)}:drops`);
    this.birds = planBirds(rules, hooks.level, hooks.seed).map((plan) => ({
      plan,
      state: 'waiting',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      speed: plan.speed * this.feel.birdSpeed,
      baseSpeed: plan.speed * this.feel.birdSpeed,
      radius: plan.bird.radius * this.feel.hitRadius,
      scares: 0,
      scaredAt: undefined,
      downAt: undefined,
    }));
    const kinds: Record<string, number> = {};
    for (const bird of this.birds) kinds[bird.plan.bird.id] = (kinds[bird.plan.bird.id] ?? 0) + 1;
    const round2 = (value: number) => Math.round(value * 100) / 100;
    hooks.logger.log('archery.roundStart', {
      seed: hooks.seed,
      level: hooks.level,
      birds: kinds,
      // Par: every bird that flies by.
      par: this.birds.length,
      flocks: rules.round.flockAt.map(
        (_, flock) => this.birds.filter((bird) => bird.plan.flock === flock).length,
      ),
      arrows: Object.fromEntries(
        rules.arrows.map((arrow) => [arrow.item, hooks.count(arrow.item)]),
      ),
      // How high each kind reaches at a full draw: the drop the feel gives.
      apex: Object.fromEntries(
        rules.arrows.map((arrow) => [arrow.item, round2(apex(arrow, this.feel, rules.step))]),
      ),
      feel: this.feel,
    });
  }

  /** The arrow kind for an item. */
  kind(item: string): ArrowKind | undefined {
    return this.rules.arrows.find((arrow) => arrow.item === item);
  }

  /** Arrows left, of every kind. */
  get arrowsLeft(): number {
    return this.rules.arrows.reduce((sum, arrow) => sum + this.#hooks.count(arrow.item), 0);
  }

  get flying(): boolean {
    return this.arrows.some((arrow) => arrow.state === 'flying');
  }

  /** Points so far: a hit or a scare is one each. */
  get points(): number {
    return this.#hits + this.#scares;
  }

  /** Par: every bird that flies by in the round, shot at or not. */
  get par(): number {
    return this.birds.length;
  }

  /** Seconds left in the round. */
  get left(): number {
    return Math.max(this.rules.round.seconds - this.now, 0);
  }

  /**
   * Shoots an arrow of `item` at `angle` degrees, drawn `draw` of a full draw. Nothing happens
   * (false) once the round's over, under the least draw (the string's let down), or with none of
   * that arrow left.
   */
  shoot(item: string, angle: number, draw: number): boolean {
    const kind = this.kind(item);
    if (this.phase !== 'hunt' || !kind || draw < this.feel.minDraw) return false;
    if (this.#hooks.count(item) < 1) return false;
    this.#hooks.spend(item);
    const index = this.arrows.length;
    const aimed = clampAim(angle, this.rules.aim);
    const flight = launch(
      kind,
      this.feel,
      aimed,
      Math.min(draw, 1),
      new Rng(`${String(this.seed)}:shot:${String(index)}`),
    );
    const arrow: ShotArrow = {
      index,
      flight,
      draw: Math.min(draw, 1),
      angle: aimed,
      firedAt: this.now,
      state: 'flying',
      closest: Infinity,
      closestBird: undefined,
      bird: undefined,
      broke: false,
      scared: [],
      grazes: [],
      passing: new Map(),
    };
    this.arrows.push(arrow);
    this.#hooks.onEvent?.({ type: 'shot', arrow });
    return true;
  }

  /** Runs the round on by `dt` seconds, in whole steps. */
  tick(dt: number): void {
    if (this.phase !== 'hunt') return;
    const step = this.rules.step;
    this.#carry = Math.min(this.#carry + Math.max(dt, 0), step * MAX_STEPS);
    while (this.#carry >= step - 1e-9 && !this.result) {
      this.#carry -= step;
      this.#step(step);
    }
  }

  /** Leaving mid-round: arrows in the air are lost; what's been banked stays. */
  exit(): void {
    if (this.phase === 'done') return;
    this.#hooks.logger.log('archery.leave', {
      seed: this.seed,
      seconds: Math.round(this.now * 100) / 100,
      shots: this.arrows.length,
      hits: this.#hits,
      flying: this.arrows.filter((arrow) => arrow.state === 'flying').length,
    });
    this.phase = 'done';
  }

  #step(step: number): void {
    this.now += step;
    this.#moveBirds(step);
    for (const arrow of this.arrows) if (arrow.state === 'flying') this.#moveArrow(arrow, step);
    this.#checkEnd();
  }

  #moveBirds(step: number): void {
    const { field } = this.rules;
    const edge = field.width / 2 + field.margin;
    for (const bird of this.birds) {
      const { plan } = bird;
      if (bird.state === 'waiting' && this.now >= plan.enterAt) {
        bird.state = 'flying';
        bird.x = -plan.dir * edge;
        bird.y = heightAt(plan, 0);
        if (!this.#flocksIn.has(plan.flock)) {
          this.#flocksIn.add(plan.flock);
          this.#hooks.onEvent?.({ type: 'flock', flock: plan.flock });
        }
        continue;
      }
      if (bird.state !== 'flying') continue;
      bird.age += step;
      const x = bird.x + plan.dir * bird.speed * step;
      const y = heightAt(plan, bird.age);
      bird.vx = (x - bird.x) / step;
      bird.vy = (y - bird.y) / step;
      bird.x = x;
      bird.y = y;
      if (plan.dir * bird.x > edge) bird.state = 'gone';
    }
  }

  #moveArrow(arrow: ShotArrow, step: number): void {
    const { flight } = arrow;
    stepArrow(flight, this.feel.gravity, step);
    let hit: LiveBird | undefined;
    let nearest = Infinity;
    for (const bird of this.birds) {
      if (bird.state !== 'flying') continue;
      const distance = Math.hypot(flight.x - bird.x, flight.y - bird.y);
      if (distance < arrow.closest) {
        arrow.closest = distance;
        arrow.closestBird = bird.plan.bird.id;
      }
      if (distance <= bird.radius && distance < nearest) {
        hit = bird;
        nearest = distance;
      }
      // A graze: it came within `graze` of the bird's hit radius and is now going away from it.
      // Every pass counts (up past a bird and back down past it again is two), but a bird is
      // only scared once per cooldown.
      let passing = arrow.passing.get(bird.plan.index);
      if (!passing) {
        passing = { last: Infinity, closing: false, nearest: Infinity };
        arrow.passing.set(bird.plan.index, passing);
      }
      if (distance < passing.last) {
        passing.closing = true;
        passing.nearest = distance;
      } else if (passing.closing) {
        passing.closing = false;
        const calm =
          bird.scaredAt === undefined || this.now - bird.scaredAt >= this.rules.scare.cooldown;
        if (passing.nearest <= bird.radius + this.feel.graze && calm) {
          this.#scare(arrow, bird, passing.nearest - bird.radius);
        }
      }
      passing.last = distance;
    }
    if (hit) {
      this.#hit(arrow, hit);
      return;
    }
    const { field } = this.rules;
    const out =
      (flight.y < 0 && flight.age > step) ||
      Math.abs(flight.x) > field.width / 2 + field.margin * 2 ||
      flight.age >= this.rules.arrowSeconds;
    if (out) {
      arrow.state = 'lost';
      this.#logShot(arrow);
      this.#hooks.onEvent?.({ type: 'lost', arrow });
    }
  }

  #hit(arrow: ShotArrow, bird: LiveBird): void {
    const species = bird.plan.bird;
    const rng = this.#drops;
    const seeds = rng.int(species.seeds.min, species.seeds.max);
    const feathers = rng.int(this.rules.feathers.count.min, this.rules.feathers.count.max);
    const broke = rng.chance(arrow.flight.kind.breakChance);
    arrow.state = 'hit';
    arrow.bird = bird;
    arrow.broke = broke;
    bird.state = 'down';
    bird.downAt = this.now;
    const drops: Stack[] = [
      { item: species.seed, count: seeds },
      { item: this.rules.feathers.item, count: feathers },
      ...(broke ? [] : [{ item: arrow.flight.kind.item, count: 1 }]),
    ];
    this.#hits += 1;
    this.#feathers += feathers;
    if (broke) this.#broken += 1;
    else this.#returned += 1;
    this.#xp += species.xp;
    this.#seeds.set(species.seed, (this.#seeds.get(species.seed) ?? 0) + seeds);
    this.#byBird[species.id] = (this.#byBird[species.id] ?? 0) + 1;
    this.#hooks.bank(drops, species.xp);
    this.#logShot(arrow);
    this.#hooks.onEvent?.({ type: 'hit', arrow, bird, drops, xp: species.xp });
  }

  #scare(arrow: ShotArrow, bird: LiveBird, graze: number): void {
    const species = bird.plan.bird;
    bird.scaredAt = this.now;
    bird.scares += 1;
    const { speedUp, maxSpeedUp } = this.rules.scare;
    bird.speed = Math.min(bird.speed * speedUp, bird.baseSpeed * maxSpeedUp);
    arrow.scared.push(bird);
    arrow.grazes.push(graze);
    const drops: Stack[] = [{ item: species.seed, count: this.rules.scare.seeds }];
    this.#scares += 1;
    this.#seeds.set(species.seed, (this.#seeds.get(species.seed) ?? 0) + this.rules.scare.seeds);
    this.#hooks.bank(drops, 0);
    this.#hooks.onEvent?.({ type: 'scare', arrow, bird, drops });
  }

  #checkEnd(): void {
    if (this.flying) return;
    let reason: ArcheryEndReason | undefined;
    if (this.now >= this.rules.round.seconds) reason = 'time';
    else if (this.birds.every((bird) => bird.state === 'down' || bird.state === 'gone')) {
      reason = 'cleared';
    } else if (this.arrowsLeft === 0) reason = 'empty';
    if (reason) this.#finish(reason);
  }

  #finish(reason: ArcheryEndReason): void {
    this.phase = 'done';
    const shots = this.arrows.length;
    const stars = starsFor(this.rules.stars, this.points, this.par);
    const seeds = [...this.#seeds].map(([item, count]) => ({ item, count }));
    const bonus = seeds
      .map((stack) => ({
        item: stack.item,
        count: starBonus(stack.count, stars, this.rules.starBonus),
      }))
      .filter((stack) => stack.count > 0);
    if (bonus.length > 0) this.#hooks.bank(bonus, 0);
    const result: ArcheryResult = {
      shots,
      hits: this.#hits,
      scares: this.#scares,
      points: this.points,
      par: this.par,
      stars,
      seeds,
      bonus,
      feathers: this.#feathers,
      returned: this.#returned,
      broken: this.#broken,
      lost: this.arrows.filter((arrow) => arrow.state === 'lost').length,
      xp: this.#xp,
      birds: { ...this.#byBird },
      seconds: this.now,
      reason,
    };
    this.result = result;
    this.#hooks.logger.log('archery.roundEnd', {
      seed: this.seed,
      level: this.#hooks.level,
      ...result,
      seconds: Math.round(this.now * 100) / 100,
      arrowsLeft: this.arrowsLeft,
    });
    this.#hooks.onEvent?.({ type: 'end', ...result });
  }

  /** One log line per shot, once it's come down: how it was shot and how it went. */
  #logShot(arrow: ShotArrow): void {
    const round2 = (value: number) => Math.round(value * 100) / 100;
    this.#hooks.logger.log('archery.shot', {
      seed: this.seed,
      shot: arrow.index,
      at: round2(arrow.firedAt),
      kind: arrow.flight.kind.item,
      draw: round2(arrow.draw),
      angle: round2(arrow.angle),
      hit: arrow.state === 'hit',
      // The bird it hit, or the nearest it came to.
      species: arrow.bird?.plan.bird.id ?? arrow.closestBird ?? null,
      closest: Number.isFinite(arrow.closest) ? round2(arrow.closest) : null,
      scared: arrow.scared.map((bird) => bird.plan.bird.id),
      // How far outside each grazed bird's hit radius it passed.
      graze: arrow.grazes.map(round2),
      ...(arrow.state === 'hit' && { broke: arrow.broke }),
      seconds: round2(arrow.flight.age),
      drift: round2(arrow.flight.drift),
    });
  }
}

/**
 * Stars from points against par: 3 at par or more, 2 and 1 from those shares of it, else none.
 */
export function starsFor(rules: Archery['stars'], points: number, par: number): number {
  if (par <= 0) return 0;
  if (points >= par) return 3;
  if (points >= rules.two * par) return 2;
  return points >= rules.one * par ? 1 : 0;
}

/** The best arrow kind there's any of (the data lists them best first), for the quiver. */
export function bestArrow(rules: Pick<Archery, 'arrows'>, count: (item: string) => number) {
  return rules.arrows.find((arrow) => count(arrow.item) > 0)?.item;
}
