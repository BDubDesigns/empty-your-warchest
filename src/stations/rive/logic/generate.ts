import { Rng } from '../../../core';
import type { Riving, RivingLog } from '../../../data';
import { survey } from './pattern';

/**
 * A random log from `seed`: its size, rings, checks, knots and grains. Every log has good grains
 * to keep and bad ones to cut out (kinds picked by their weights, each as wide as its kind
 * allows), and most put a good grain close to a bad one. Each log is checked against the heads
 * the player has: one where nearly any turn earns 3 stars is usually made again, so most logs are
 * a real choice. The same seed and heads always give the same log.
 */
export function generateLog(rules: Riving, seed: number, heads: readonly number[]): RivingLog {
  const rng = new Rng(seed);
  const { generator } = rules;
  let log = makeLog(rules, rng, seed);
  for (let attempt = 1; attempt < generator.tries; attempt++) {
    if (survey(rules, log, heads).easy <= generator.easyShare) break;
    if (rng.chance(generator.easyChance)) break;
    log = makeLog(rules, rng, seed);
  }
  return log;
}

function makeLog(rules: Riving, rng: Rng, seed: number): RivingLog {
  const { generator } = rules;
  const checks = Array.from({ length: rng.int(generator.checks.min, generator.checks.max) }, () =>
    Math.round(rng.range(0, 360)),
  );
  const pickKind = (kinds: Riving['grainKinds']) => {
    const total = kinds.reduce((sum, kind) => sum + kind.weight, 0);
    let roll = rng.range(0, total);
    for (const kind of kinds) {
      roll -= kind.weight;
      if (roll < 0) return kind;
    }
    return kinds[kinds.length - 1];
  };
  // Grains and knots share the face, each kept `grainGap` from the others.
  const taken: { angle: number; width: number }[] = [];
  const clear = (angle: number, width: number, gap: number) =>
    taken.every((other) => {
      const apart = Math.abs(((angle - other.angle + 540) % 360) - 180);
      return apart >= (width + other.width) / 2 + gap;
    });
  const place = (width: number, near?: { angle: number; width: number }) => {
    for (let tries = 0; tries < 40; tries++) {
      // Near another mark: just past its edge, on either side.
      const angle = near
        ? near.angle +
          (rng.chance(0.5) ? 1 : -1) *
            ((near.width + width) / 2 + rng.range(generator.nearGap.min, generator.nearGap.max))
        : rng.range(0, 360);
      const at = Math.round(((angle % 360) + 360) % 360);
      if (!clear(at, width, near ? 0 : generator.grainGap)) continue;
      taken.push({ angle: at, width });
      return at;
    }
    return undefined;
  };
  const knots: RivingLog['knots'] = [];
  for (let index = rng.int(generator.knots.min, generator.knots.max); index > 0; index--) {
    const width = Math.round(rng.range(generator.knotWidth.min, generator.knotWidth.max));
    const angle = place(width);
    if (angle !== undefined) knots.push({ angle, width });
  }
  const grains: RivingLog['grains'] = [];
  const add = (kinds: Riving['grainKinds'], near?: { angle: number; width: number }) => {
    const kind = pickKind(kinds);
    if (!kind) return undefined;
    const width = Math.round(rng.range(kind.width.min, kind.width.max));
    const angle = (near ? place(width, near) : undefined) ?? place(width);
    if (angle === undefined) return undefined;
    const grain = { kind: kind.id, angle, width };
    grains.push(grain);
    return grain;
  };
  const bad = rules.grainKinds.filter((kind) => kind.multiplier < 1);
  const good = rules.grainKinds.filter((kind) => kind.multiplier > 1);
  const bads = Array.from({ length: rng.int(generator.bad.min, generator.bad.max) }, () =>
    add(bad),
  );
  // The hard case: the first good grain just past the first bad one's edge.
  const near = rng.chance(generator.nearChance) ? bads[0] : undefined;
  const goods = rng.int(generator.good.min, generator.good.max);
  for (let index = 0; index < goods; index++) add(good, index === 0 ? near : undefined);
  return {
    id: `log_${String(seed)}`,
    radius: Math.round(rng.range(generator.radius.min, generator.radius.max) * 100) / 100,
    height: Math.round(rng.range(generator.height.min, generator.height.max) * 100) / 100,
    rings: rng.int(generator.rings.min, generator.rings.max),
    checks,
    grains,
    knots,
  };
}
