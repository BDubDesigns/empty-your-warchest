import type { Splitting, SplittingLog } from '../../../data';

const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** An angle brought into 0 to 2π. */
export function normalize(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Whether `angle` lies strictly inside the arc from `start` for `width`. */
export function inArc(angle: number, start: number, width: number): boolean {
  const offset = normalize(angle - start);
  return offset > 1e-9 && offset < width - 1e-9;
}

/** Whether two arcs share any of the end face. */
export function arcsOverlap(
  a: { start: number; width: number },
  b: { start: number; width: number },
): boolean {
  return (
    inArc(b.start, a.start, a.width) ||
    inArc(a.start, b.start, b.width) ||
    Math.abs(normalize(a.start - b.start)) < 1e-9
  );
}

/** A turn brought onto the rules' steps (whole degrees), in 0 to 2π. */
export function snapTurn(rules: Splitting, rotation: number): number {
  const step = rules.turnStep * DEG;
  return normalize(Math.round(normalize(rotation) / step) * step);
}

/** A grain's (or knot's) arc of the end face. */
export function markArc(mark: { angle: number; width: number }): { start: number; width: number } {
  return { start: normalize((mark.angle - mark.width / 2) * DEG), width: mark.width * DEG };
}

/** One wedge of the log a head splits off: the arc of the end face from `start` for `width`. */
export interface Wedge {
  index: number;
  start: number;
  width: number;
}

/** The cut lines of a `count`-way head turned to `rotation` (radians), going round. */
export function cutLines(count: number, rotation: number): number[] {
  return Array.from({ length: count }, (_, index) => normalize(rotation + (index * TAU) / count));
}

/** The wedges between the cut lines: wedge i runs from line i to line i + 1. */
export function wedgesOf(count: number, rotation: number): Wedge[] {
  return cutLines(count, rotation).map((start, index) => ({ index, start, width: TAU / count }));
}

/** Everything a head at this turn would make: what the rules and the guide both read. */
export interface Plan {
  count: number;
  rotation: number;
  lines: number[];
  wedges: Wedge[];
  /** Grains (by index) a line runs through: cancelled, good or bad. */
  cut: number[];
  /** Wedges (by index) touching a knot: they don't count as staves. */
  knotted: number[];
  /** Grains (by index) whole in a stave, and which wedge each is in. */
  kept: { grain: number; wedge: number }[];
  /** What the kept grains multiply the log by (capped), the staves, and staves × multiplier. */
  multiplier: number;
  staves: number;
  worth: number;
}

/** What a set of grains multiplies the log's staves by, together, up to the rules' cap. */
export function multiplierOf(
  rules: Splitting,
  log: SplittingLog,
  grains: readonly number[],
): number {
  const product = grains.reduce((total, index) => {
    const kind = rules.grainKinds.find((entry) => entry.id === log.grains[index]?.kind);
    return total * (kind?.multiplier ?? 1);
  }, 1);
  return Math.min(product, rules.multiplierCap);
}

/** Staves × multiplier, rounded down: what a log banks. */
export function worthOf(staves: number, multiplier: number): number {
  return Math.floor(staves * multiplier + 1e-9);
}

/** What a `count`-way head turned to `rotation` makes of `log`. */
export function planFor(
  rules: Splitting,
  log: SplittingLog,
  count: number,
  rotation: number,
): Plan {
  const lines = cutLines(count, rotation);
  const wedges = wedgesOf(count, rotation);
  const through = (arc: { start: number; width: number }) =>
    lines.filter((line) => inArc(line, arc.start, arc.width)).length;
  const cut = log.grains.flatMap((grain, index) => (through(markArc(grain)) > 0 ? [index] : []));
  const knotted = wedges.flatMap((wedge) =>
    log.knots.some((knot) => arcsOverlap(wedge, markArc(knot))) ? [wedge.index] : [],
  );
  const counts = (wedge: Wedge) => !knotted.includes(wedge.index);
  // A grain no line runs through lies wholly in one wedge: its middle says which.
  const kept = log.grains.flatMap((grain, index) => {
    if (cut.includes(index)) return [];
    const wedge = wedges.find((entry) => inArc(grain.angle * DEG, entry.start, entry.width));
    return wedge && counts(wedge) ? [{ grain: index, wedge: wedge.index }] : [];
  });
  const multiplier = multiplierOf(
    rules,
    log,
    kept.map((entry) => entry.grain),
  );
  const staves = wedges.filter(counts).length;
  return {
    count,
    rotation: normalize(rotation),
    lines,
    wedges,
    cut,
    knotted,
    kept,
    multiplier,
    staves,
    worth: worthOf(staves, multiplier),
  };
}

/**
 * Every turn a head can be at, step by step, until its cuts come round to where they started
 * (a 7-way's 51.4° never lands on a whole step again, so it's tried all the way round).
 */
function turnsFor(rules: Splitting, count: number): number {
  const steps = 360 / count / rules.turnStep;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? Math.round(steps) : 360 / rules.turnStep;
}

/**
 * The best a log could make with these heads: every head tried at every step of turn. The first
 * best found wins ties, so the answer is the same every time.
 */
export function bestPlan(rules: Splitting, log: SplittingLog, counts: readonly number[]): Plan {
  return survey(rules, log, counts).best;
}

/**
 * The best plan, and how the log plays: `easy` is the share of every head at every turn that
 * would earn 3 stars (high means nearly anything works), and `leeway` the most degrees in a row
 * any one head keeps 3 stars over (low means a sliver you have to hunt for).
 */
export function survey(
  rules: Splitting,
  log: SplittingLog,
  counts: readonly number[],
): { best: Plan; easy: number; leeway: number } {
  const byHead = counts.map((count) =>
    Array.from({ length: turnsFor(rules, count) }, (_, step) =>
      planFor(rules, log, count, step * rules.turnStep * DEG),
    ),
  );
  let best: Plan | undefined;
  for (const plans of byHead)
    for (const plan of plans) if (!best || plan.worth > best.worth) best = plan;
  if (!best) throw new Error('No heads to split with');
  const top = best.worth;
  let threeStar = 0;
  let total = 0;
  let longest = 0;
  for (const plans of byHead) {
    const good = plans.map((plan) => starsFor(rules, plan.worth, top) >= 3);
    threeStar += good.filter(Boolean).length;
    total += good.length;
    longest = Math.max(longest, longestRun(good));
  }
  return { best, easy: threeStar / total, leeway: longest * rules.turnStep };
}

/** The most `true`s in a row, going round (the last step runs on into the first). */
function longestRun(values: readonly boolean[]): number {
  if (values.every(Boolean)) return values.length;
  let longest = 0;
  let run = 0;
  for (const value of [...values, ...values]) {
    run = value ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return Math.min(longest, values.length);
}

/** Stars for a log's worth against the best it could make: 0 to 3. */
export function starsFor(rules: Splitting, worth: number, best: number): number {
  const share = best > 0 ? worth / best : 1;
  const { one, two, three } = rules.stars;
  return share >= three - 1e-9 ? 3 : share >= two - 1e-9 ? 2 : share >= one - 1e-9 ? 1 : 0;
}

/** The heads open at a Splitting level, fewest pieces first. */
export function openHeads(rules: Splitting, level: number): number[] {
  return rules.cutters
    .filter((cutter) => cutter.level <= level)
    .map((cutter) => cutter.count)
    .sort((a, b) => a - b);
}
