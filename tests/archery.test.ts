import { describe, expect, it } from 'vitest';
import { Game, Rng, newGameState, type GameState, type Stack } from '../src/core';
import { GameDataError, parseGameData, type GameData } from '../src/data';
import {
  ArcheryRound,
  apex,
  bestArrow,
  clampAim,
  flockFor,
  heightAt,
  launch,
  planBirds,
  previewPath,
  starsFor,
  stepArrow,
  type ArcheryEvent,
  type FieldPoint,
} from '../src/stations/archery';
import { data, dataWith, editableRawData, testLogger } from './helpers';

const rules = data.archery;
const feel = rules.feel;
const fletched = must(rules.arrows[0]);
const bare = must(rules.arrows[1]);

/** The value, or a failed test if it's missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing from the data');
  return value;
}

/** Where a plain shot at `angle`, drawn `draw`, comes nearest `target`, and how near. */
function nearest(angle: number, draw: number, target: FieldPoint) {
  const path = previewPath(fletched, feel, angle, draw, 3, rules.step);
  return Math.min(...path.map((point) => Math.hypot(point.x - target.x, point.y - target.y)));
}

/** The full-draw angle whose plain flight passes nearest `target` (a still bird). */
function aimAt(target: FieldPoint): number {
  let best = { angle: 90, distance: Infinity };
  for (let angle = rules.aim.min; angle <= rules.aim.max; angle += 0.05) {
    const distance = nearest(angle, 1, target);
    if (distance < best.distance) best = { angle, distance };
  }
  return best.angle;
}

/** The full-draw angle whose plain flight passes `distance` from `target`'s middle, at its nearest. */
function aimPast(target: FieldPoint, distance: number): number {
  let best = { angle: 90, off: Infinity };
  for (let angle = rules.aim.min; angle <= rules.aim.max; angle += 0.02) {
    const off = Math.abs(nearest(angle, 1, target) - distance);
    if (off < best.off) best = { angle, off };
  }
  return best.angle;
}

/** The finch's hit radius and its graze ring's outer edge, as a round has them. */
const finchRadius = must(rules.birds.find((bird) => bird.id === 'finch')).radius * feel.hitRadius;
const grazeEdge = finchRadius + feel.graze;

/**
 * A round over one finch that hangs still at (`x`, `altitude`), with `arrows` fletched arrows:
 * so a test can aim a fletched arrow (which flies plain) exactly. Records what's banked.
 */
function stillBird(edit: (raw: ReturnType<typeof editableRawData>) => void = () => undefined) {
  const tuned = dataWith((raw) => {
    raw.archery.round.flockAt = [0];
    raw.archery.flocks = [
      { level: 1, birds: { min: 1, max: 1 }, mix: [{ bird: 'finch', weight: 1 }] },
    ];
    const finch = raw.archery.birds.find((bird) => bird.id === 'finch');
    if (!finch) throw new Error('No finch');
    finch.speed = { min: 0.001, max: 0.001 };
    finch.altitude = { min: 20, max: 20 };
    finch.path.amplitude = 0;
    edit(raw);
  });
  return tuned;
}

interface Played {
  round: ArcheryRound;
  banked: Stack[];
  xp: number;
  events: ArcheryEvent[];
  counts: Record<string, number>;
  log: ReturnType<typeof testLogger>;
}

function play(
  source: GameData,
  options: { seed?: number; level?: number; arrows?: Record<string, number> } = {},
): Played {
  const { seed = 1, level = 1, arrows = { fletched_arrow: 20 } } = options;
  const log = testLogger();
  const counts: Record<string, number> = { ...arrows };
  const played: Played = {
    round: undefined as unknown as ArcheryRound,
    banked: [],
    xp: 0,
    events: [],
    counts,
    log,
  };
  played.round = new ArcheryRound(source.archery, source.archery.feel, {
    logger: log.logger,
    level,
    seed,
    count: (item) => counts[item] ?? 0,
    spend: (item) => {
      counts[item] = (counts[item] ?? 0) - 1;
    },
    bank: (items, xp) => {
      for (const stack of items) {
        played.banked.push(stack);
        counts[stack.item] = (counts[stack.item] ?? 0) + stack.count;
      }
      played.xp += xp;
    },
    onEvent: (event) => played.events.push(event),
  });
  return played;
}

/** Runs the round on for `seconds`, a frame at a time. */
function run(played: Played, seconds: number): void {
  for (let tick = 0; tick < Math.round(seconds * 60); tick++) played.round.tick(1 / 60);
}

const banked = (played: Played, item: string) =>
  played.banked.filter((stack) => stack.item === item).reduce((sum, s) => sum + s.count, 0);

/** Ticks until the round's first bird is in the field, and returns where it is. */
function untilBirdIn(played: Played): FieldPoint {
  for (let tick = 0; tick < 600; tick++) {
    const bird = played.round.birds.find((entry) => entry.state === 'flying');
    if (bird) return { x: bird.x, y: bird.y };
    played.round.tick(1 / 60);
  }
  throw new Error('No bird came in');
}

/** Ticks until no arrow is in the air (or the round's over). */
function untilLanded(played: Played): void {
  for (let tick = 0; tick < 600 && played.round.flying; tick++) played.round.tick(1 / 60);
}

describe('arrow flight', () => {
  it('flies a fletched arrow past the top of the field, and a bare one shorter', () => {
    const fletchedTop = apex(fletched, feel, rules.step);
    const bareTop = apex(bare, feel, rules.step);
    expect(fletchedTop).toBeGreaterThan(rules.field.height);
    expect(bareTop).toBeLessThan(fletchedTop);
    // A bare arrow still reaches the birds (crows fly highest).
    const crow = rules.birds.find((bird) => bird.id === 'crow');
    expect(bareTop).toBeGreaterThan(crow?.altitude.min ?? Infinity);
  });

  it('drops in an arc: up, then down under gravity', () => {
    const path = previewPath(fletched, feel, 60, 1, 4, rules.step);
    const top = Math.max(...path.map((point) => point.y));
    expect(top).toBeGreaterThan(0);
    expect(path[path.length - 1]?.y).toBeLessThan(top);
  });

  it('a weaker draw flies slower and drops sooner', () => {
    const full = launch(fletched, feel, 90, 1);
    const half = launch(fletched, feel, 90, 0.5);
    expect(half.vy).toBeCloseTo(full.vy / 2);
    const fullTop = apex(fletched, feel, rules.step);
    expect(fullTop).toBeGreaterThan(30);
  });

  it('a fletched arrow flies true: the preview is its path', () => {
    const plain = previewPath(fletched, feel, 70, 0.8, 1, rules.step);
    const shot = launch(fletched, feel, 70, 0.8, new Rng(5));
    for (let index = 1; index < plain.length; index++) stepArrow(shot, feel.gravity, rules.step);
    const last = plain[plain.length - 1];
    expect(shot.x).toBeCloseTo(last?.x ?? NaN, 6);
    expect(shot.y).toBeCloseTo(last?.y ?? NaN, 6);
  });

  it('a bare arrow wobbles and drifts off its preview, differently every shot', () => {
    const ends = [1, 2, 3].map((seed) => {
      const shot = launch(bare, feel, 70, 0.8, new Rng(seed));
      for (let index = 0; index < 120; index++) stepArrow(shot, feel.gravity, rules.step);
      return { x: shot.x, y: shot.y };
    });
    const plain = previewPath(bare, feel, 70, 0.8, 1, rules.step).at(-1);
    for (const end of ends) {
      expect(Math.hypot(end.x - (plain?.x ?? 0), end.y - (plain?.y ?? 0))).toBeGreaterThan(0.05);
    }
    expect(new Set(ends.map((end) => end.x.toFixed(3))).size).toBe(3);
  });

  it('shows only the first part of the path in the preview', () => {
    const path = previewPath(fletched, feel, 80, 1, feel.previewSeconds, rules.step);
    expect(path).toHaveLength(Math.round(feel.previewSeconds / rules.step) + 1);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)?.y ?? Infinity).toBeLessThan(rules.field.height);
  });

  it('keeps the aim between the steepest and flattest shots', () => {
    expect(clampAim(-20, rules.aim)).toBe(rules.aim.min);
    expect(clampAim(200, rules.aim)).toBe(rules.aim.max);
    expect(clampAim(90, rules.aim)).toBe(90);
  });

  it('picks the best arrow you have for the quiver', () => {
    expect(bestArrow(rules, (item) => (item === 'bare_arrow' ? 3 : 0))).toBe('bare_arrow');
    expect(bestArrow(rules, () => 1)).toBe('fletched_arrow');
    expect(bestArrow(rules, () => 0)).toBeUndefined();
  });
});

describe('birds and flocks', () => {
  it('plans the same flocks from the same seed', () => {
    expect(planBirds(rules, 1, 42)).toEqual(planBirds(rules, 1, 42));
    expect(planBirds(rules, 1, 42)).not.toEqual(planBirds(rules, 1, 43));
  });

  it('sends a flock at each time in the data, sized and mixed by level', () => {
    for (const level of [1, 10, 40]) {
      const flock = flockFor(rules, level);
      const plans = planBirds(rules, level, 7);
      rules.round.flockAt.forEach((at, index) => {
        const birds = plans.filter((plan) => plan.flock === index);
        expect(birds.length).toBeGreaterThanOrEqual(flock.birds.min);
        expect(birds.length).toBeLessThanOrEqual(flock.birds.max);
        expect(birds[0]?.enterAt).toBe(at);
        // A flock flies one way.
        expect(new Set(birds.map((bird) => bird.dir)).size).toBe(1);
        for (const bird of birds) {
          expect(flock.mix.map((entry) => entry.bird)).toContain(bird.bird.id);
        }
      });
    }
    expect(flockFor(rules, 1).level).toBe(1);
    expect(flockFor(rules, 12).level).toBe(10);
  });

  it('bobs a straight flier round its height, and swoops a jay down and back', () => {
    const plans = [1, 2, 3, 4, 5].flatMap((seed) => planBirds(rules, 25, seed));
    const jay = plans.find((plan) => plan.bird.path.kind === 'swoop');
    const finch = plans.find((plan) => plan.bird.id === 'finch');
    if (!jay || !finch) throw new Error('Expected a jay and a finch');
    const ages = Array.from({ length: 200 }, (_, index) => index * 0.05);
    const jayHeights = ages.map((age) => heightAt(jay, age));
    expect(Math.max(...jayHeights)).toBeLessThanOrEqual(jay.altitude + 1e-9);
    expect(jay.altitude - Math.min(...jayHeights)).toBeGreaterThan(jay.bird.path.amplitude * 0.9);
    for (const age of ages) {
      expect(Math.abs(heightAt(finch, age) - finch.altitude)).toBeLessThanOrEqual(
        finch.bird.path.amplitude + 1e-9,
      );
    }
  });

  it('flies birds across the field and off the far side', () => {
    const played = play(data);
    run(played, (rules.round.flockAt[0] ?? 0) + 1);
    const first = played.round.birds[0];
    if (!first) throw new Error('No birds');
    expect(first.state).toBe('flying');
    const x = first.x;
    run(played, 0.5);
    expect((first.x - x) * first.plan.dir).toBeGreaterThan(0);
    run(played, 30);
    expect(first.state).toBe('gone');
  });
});

describe('a round of the bird hunt', () => {
  it('a hit downs the bird: its seeds, 2 to 4 feathers, XP, and the arrow back', () => {
    const played = play(stillBird((raw) => (must(raw.archery.arrows[0]).breakChance = 0)));
    const bird = untilBirdIn(played);
    expect(played.round.shoot('fletched_arrow', aimAt(bird), 1)).toBe(true);
    expect(played.counts.fletched_arrow).toBe(19);
    untilLanded(played);
    const finch = played.round.birds[0];
    expect(finch?.state).toBe('down');
    // What the hit dropped (the round's over now too, and its stars add bonus seeds).
    const hit = played.events.find((event) => event.type === 'hit');
    const dropped = (item: string) =>
      hit?.type === 'hit' ? (hit.drops.find((stack) => stack.item === item)?.count ?? 0) : 0;
    expect(dropped('sunflower_seed')).toBeGreaterThanOrEqual(1);
    expect(dropped('sunflower_seed')).toBeLessThanOrEqual(2);
    expect(dropped('feather')).toBeGreaterThanOrEqual(2);
    expect(dropped('feather')).toBeLessThanOrEqual(4);
    expect(banked(played, 'feather')).toBe(dropped('feather'));
    expect(played.xp).toBe(8);
    // The arrow came back with the bird.
    expect(played.counts.fletched_arrow).toBe(20);
    expect(played.events.map((event) => event.type)).toContain('hit');
  });

  it('a hit arrow can break in the bird, and then it is not returned', () => {
    const played = play(stillBird((raw) => (must(raw.archery.arrows[0]).breakChance = 1)));
    played.round.shoot('fletched_arrow', aimAt(untilBirdIn(played)), 1);
    untilLanded(played);
    expect(played.round.arrows[0]?.state).toBe('hit');
    expect(played.round.arrows[0]?.broke).toBe(true);
    expect(played.counts.fletched_arrow).toBe(19);
  });

  it('a graze scares the bird: it poops one seed and flies off faster', async () => {
    const played = play(stillBird());
    const bird = untilBirdIn(played);
    const before = played.round.birds[0]?.speed ?? 0;
    // Through the thin ring just outside the finch's hit radius.
    played.round.shoot('fletched_arrow', aimPast(bird, (finchRadius + grazeEdge) / 2), 1);
    untilLanded(played);
    const finch = played.round.birds[0];
    expect(finch?.state).toBe('flying');
    expect(finch?.scaredAt).toBeDefined();
    expect(finch?.speed).toBeCloseTo(before * rules.scare.speedUp);
    expect(banked(played, 'sunflower_seed')).toBe(rules.scare.seeds);
    expect(banked(played, 'feather')).toBe(0);
    expect(played.round.arrows[0]?.state).toBe('lost');
    expect(played.events.filter((event) => event.type === 'scare')).toHaveLength(1);
    expect(played.round.points).toBe(1);
    await played.log.logger.flush();
    const shot = played.log.sink.events.find((event) => event.type === 'archery.shot');
    expect(shot?.data?.scared).toEqual(['finch']);
    const graze = (shot?.data?.graze as number[] | undefined)?.[0] ?? -1;
    expect(graze).toBeGreaterThan(0);
    expect(graze).toBeLessThanOrEqual(feel.graze);
    // It can be scared again: another seed and another point.
    played.round.shoot(
      'fletched_arrow',
      aimPast({ x: finch?.x ?? 0, y: finch?.y ?? 0 }, (finchRadius + grazeEdge) / 2),
      1,
    );
    untilLanded(played);
    expect(finch?.scares).toBe(2);
    expect(banked(played, 'sunflower_seed')).toBe(rules.scare.seeds * 2);
    expect(played.round.points).toBe(2);
  });

  it('one arrow can scare a bird on its way up and again on its way back down', () => {
    const played = play(stillBird());
    untilBirdIn(played);
    const finch = must(played.round.birds[0]);
    // Hanging just off the line of a shot straight up: passed going up, and coming down.
    finch.x = (finchRadius + grazeEdge) / 2;
    played.round.shoot('fletched_arrow', 90, 1);
    untilLanded(played);
    expect(finch.scares).toBe(2);
    expect(played.round.arrows[0]?.scared).toHaveLength(2);
    expect(played.round.points).toBe(2);
    expect(finch.speed).toBeCloseTo(finch.baseSpeed * rules.scare.speedUp ** 2);
  });

  it('scares a bird at most once a cooldown, and caps how fast it flees', () => {
    const played = play(stillBird());
    untilBirdIn(played);
    const finch = must(played.round.birds[0]);
    finch.x = (finchRadius + grazeEdge) / 2;
    // Two arrows side by side pass it together: one scare.
    played.round.shoot('fletched_arrow', 90, 1);
    played.round.shoot('fletched_arrow', 90, 1);
    run(played, 0.6);
    expect(finch.scares).toBe(1);
    untilLanded(played);
    // Arrow after arrow, well apart: scared every pass, but never past the cap.
    for (let shot = 0; shot < 3; shot++) {
      played.round.shoot('fletched_arrow', 90, 1);
      run(played, rules.scare.cooldown + 0.3);
    }
    untilLanded(played);
    expect(finch.scares).toBeGreaterThanOrEqual(5);
    expect(finch.speed).toBeCloseTo(finch.baseSpeed * rules.scare.maxSpeedUp);
  });

  it('an arrow passing wider than the scare zone does nothing', () => {
    const played = play(stillBird());
    const bird = untilBirdIn(played);
    played.round.shoot('fletched_arrow', aimPast(bird, grazeEdge + 0.3), 1);
    untilLanded(played);
    expect(played.round.birds[0]?.scaredAt).toBeUndefined();
    expect(played.banked).toEqual([]);
    expect(played.round.points).toBe(0);
  });

  it('a graze and a hit on the same bird both count: graze it, then hit it as it flees', () => {
    const played = play(stillBird((raw) => (must(raw.archery.arrows[0]).breakChance = 0)));
    const bird = untilBirdIn(played);
    played.round.shoot('fletched_arrow', aimPast(bird, (finchRadius + grazeEdge) / 2), 1);
    untilLanded(played);
    const finch = must(played.round.birds[0]);
    played.round.shoot('fletched_arrow', aimAt({ x: finch.x, y: finch.y }), 1);
    untilLanded(played);
    expect(finch.state).toBe('down');
    played.round.tick(rules.step);
    expect(played.round.result).toMatchObject({ hits: 1, scares: 1, points: 2, par: 1, stars: 3 });
  });

  it('a wide miss is lost, and logs how close it came and to what', async () => {
    const played = play(stillBird());
    const bird = untilBirdIn(played);
    played.round.shoot('fletched_arrow', aimPast(bird, 4), 0.95);
    untilLanded(played);
    expect(played.round.arrows[0]?.state).toBe('lost');
    expect(played.banked).toEqual([]);
    await played.log.logger.flush();
    const shot = played.log.sink.events.find((event) => event.type === 'archery.shot');
    expect(shot?.data).toMatchObject({
      kind: 'fletched_arrow',
      hit: false,
      species: 'finch',
      draw: 0.95,
      scared: [],
    });
    expect(shot?.data?.closest).toBeGreaterThan(grazeEdge);
    expect(typeof shot?.data?.angle).toBe('number');
  });

  it('needs an arrow and a real draw to shoot', () => {
    const played = play(data, { arrows: { fletched_arrow: 1 } });
    expect(played.round.shoot('fletched_arrow', 90, feel.minDraw / 2)).toBe(false);
    expect(played.round.shoot('bare_arrow', 90, 1)).toBe(false);
    expect(played.counts.fletched_arrow).toBe(1);
    expect(played.round.shoot('fletched_arrow', 90, 1)).toBe(true);
    expect(played.round.shoot('fletched_arrow', 90, 1)).toBe(false);
  });

  it('ends when the quiver is empty and the last arrow is down', () => {
    const played = play(data, { arrows: { fletched_arrow: 1 } });
    played.round.shoot('fletched_arrow', 10, 1);
    untilLanded(played);
    played.round.tick(rules.step);
    expect(played.round.phase).toBe('done');
    expect(played.round.result).toMatchObject({ reason: 'empty', shots: 1, lost: 1, stars: 0 });
  });

  it('ends when time is up, and logs the round start and end', async () => {
    const played = play(data);
    run(played, rules.round.seconds + 1);
    await played.log.logger.flush();
    expect(played.round.phase).toBe('done');
    expect(['time', 'cleared']).toContain(played.round.result?.reason);
    const types = played.log.sink.events.map((event) => event.type);
    expect(types).toContain('archery.roundStart');
    expect(types).toContain('archery.roundEnd');
    const start = played.log.sink.events.find((event) => event.type === 'archery.roundStart');
    expect(start?.data).toMatchObject({ seed: 1, level: 1, feel, par: played.round.birds.length });
    // Par is every bird that flew by, shot at or not.
    expect(played.round.result).toMatchObject({ points: 0, par: played.round.birds.length });
    expect(played.round.par).toBeGreaterThanOrEqual(rules.round.flockAt.length * 3);
  });

  it('plays out the same from the same seed and the same shots', () => {
    const run = () => {
      const played = play(data, { seed: 99, arrows: { fletched_arrow: 5, bare_arrow: 5 } });
      for (let tick = 0; tick < 60 * 50; tick++) {
        if (tick % 90 === 30)
          played.round.shoot(tick % 180 ? 'bare_arrow' : 'fletched_arrow', 70, 0.9);
        played.round.tick(1 / 60);
      }
      return { result: played.round.result, banked: played.banked };
    };
    expect(run()).toEqual(run());
  });

  it('pays bonus seeds for 3 stars', () => {
    const played = play(
      stillBird((raw) => {
        must(raw.archery.birds.find((bird) => bird.id === 'finch')).seeds = { min: 2, max: 2 };
      }),
    );
    played.round.shoot('fletched_arrow', aimAt(untilBirdIn(played)), 1);
    untilLanded(played);
    played.round.tick(rules.step);
    expect(played.round.result).toMatchObject({ hits: 1, shots: 1, stars: 3, reason: 'cleared' });
    // Half as many again, as the data says.
    expect(played.round.result?.bonus).toEqual([{ item: 'sunflower_seed', count: 1 }]);
    expect(banked(played, 'sunflower_seed')).toBe(3);
  });
});

describe('stars', () => {
  const stars = rules.stars;
  it('come from points against par: 3 at par, 2 and 1 at shares of it', () => {
    // Par 10 (ten birds flew by): 0.4 and 0.7 of it in data.
    expect(starsFor(stars, 10, 10)).toBe(3);
    expect(starsFor(stars, 14, 10)).toBe(3);
    expect(starsFor(stars, 9, 10)).toBe(2);
    expect(starsFor(stars, 7, 10)).toBe(2);
    expect(starsFor(stars, 6, 10)).toBe(1);
    expect(starsFor(stars, 4, 10)).toBe(1);
    expect(starsFor(stars, 3, 10)).toBe(0);
    expect(starsFor(stars, 0, 0)).toBe(0);
  });
});

describe('hunting stand workers', () => {
  it('spend fletched arrows on a hunt and bring back seeds and feathers, about a tenth of playing', () => {
    const state: GameState = newGameState(data, 0);
    state.inventory = [{ item: 'fletched_arrow', count: 20 }];
    const { logger } = testLogger();
    const game = new Game(data, state, logger);
    game.assignWorker('tree_line', -1);
    game.assignWorker('hunting_stand', 1);
    expect(game.crew('hunting_stand')).toBe(1);
    const result = game.work(30);
    // A hunt every 3 minutes, 3 arrows each: 20 arrows last 6 hunts.
    const pile = (item: string) =>
      game.pile('hunting_stand').find((stack) => stack.item === item)?.count ?? 0;
    expect(pile('feather')).toBe(6 * 9);
    expect(pile('sunflower_seed')).toBe(6);
    expect(pile('woad_seed')).toBe(6);
    expect(pile('mushroom_spores')).toBe(6);
    expect(game.inventory.count('fletched_arrow')).toBe(2);
    expect(result.stations.find((station) => station.station === 'hunting_stand')?.short).toBe(
      'fletched_arrow',
    );
    // A minute of a worker is under a fifth of the birds a minute of playing downs.
    const job = data.workers.jobs.find(
      (entry) => 'recipe' in entry && entry.recipe === 'hunt_flock',
    );
    expect((job?.perMinute ?? 0) * 3).toBeLessThan(2);
  });
});

describe('archery data', () => {
  const invalid = (edit: (raw: ReturnType<typeof editableRawData>) => void, message: string) => {
    const raw = editableRawData();
    edit(raw);
    expect(() => parseGameData(raw)).toThrow(GameDataError);
    expect(() => parseGameData(raw)).toThrow(message);
  };

  it('fails loudly on a two-star share under the one-star share', () => {
    invalid((raw) => {
      raw.archery.stars = { one: 0.8, two: 0.5 };
    }, 'More stars must not need less');
  });

  it('fails loudly on a speed cap under one scare’s speed-up', () => {
    invalid((raw) => {
      raw.archery.scare.maxSpeedUp = 1.2;
    }, 'Must not be under one scare’s speed-up');
  });

  it('fails loudly on a flock with an unknown bird', () => {
    invalid((raw) => {
      raw.archery.flocks[0]?.mix.push({ bird: 'eagle', weight: 1 });
    }, 'Unknown bird "eagle"');
  });

  it('fails loudly on a bird whose seed is not an item', () => {
    invalid((raw) => {
      must(raw.archery.birds[0]).seed = 'acorn';
    }, 'Unknown item "acorn"');
  });

  it('fails loudly on an arrow kind that is not an item, or listed twice', () => {
    invalid((raw) => {
      must(raw.archery.arrows[1]).item = 'fire_arrow';
    }, 'Unknown item "fire_arrow"');
    invalid((raw) => {
      must(raw.archery.arrows[1]).item = 'fletched_arrow';
    }, 'Twice');
  });

  it('fails loudly on trees in front of the field, or a bird above it', () => {
    invalid((raw) => {
      raw.archery.looks.treeDistance.min = 10;
    }, 'The trees must stand behind the field');
    invalid((raw) => {
      must(raw.archery.birds[2]).altitude.max = 99;
    }, 'Above the field');
  });

  it('flies the duster straight but short, like a shuttlecock, and shoots it from the quiver', () => {
    const duster = must(rules.arrows.find((arrow) => arrow.item === 'duster_arrow'));
    // Shorter than even a bare arrow, but it still reaches the lower finches.
    const top = apex(duster, feel, rules.step);
    expect(top).toBeLessThan(apex(bare, feel, rules.step));
    const finch = must(rules.birds.find((bird) => bird.id === 'finch'));
    expect(top).toBeGreaterThan(finch.altitude.min);
    // Straight: every shot flies its preview exactly (no drift, no wobble).
    const shot = launch(duster, feel, 70, 1, new Rng(3));
    for (let step = 0; step < 60; step++) stepArrow(shot, feel.gravity, rules.step);
    const plain = previewPath(duster, feel, 70, 1, 60 * rules.step, rules.step).at(-1);
    expect(shot.x).toBeCloseTo(plain?.x ?? NaN, 6);
    expect(shot.y).toBeCloseTo(plain?.y ?? NaN, 6);
    // Slow: high drag sheds its speed, so it's soon falling nearly straight down.
    expect(Math.hypot(shot.vx, shot.vy)).toBeLessThan(duster.speed * 0.6);
    // The quiver only starts on it when there's nothing better.
    expect(bestArrow(rules, (item) => (item === 'duster_arrow' ? 4 : 0))).toBe('duster_arrow');
    expect(bestArrow(rules, (item) => (item === 'duster_arrow' ? 4 : 1))).toBe('fletched_arrow');
    const played = play(data, { arrows: { duster_arrow: 1 } });
    expect(played.round.shoot('duster_arrow', 90, 1)).toBe(true);
  });
});
