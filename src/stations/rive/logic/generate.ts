import { Rng } from '../../../core';
import type { Riving, RivingLog } from '../../../data';

/**
 * A random log from `seed`: its size, rings, checks, knots and grains (kinds picked by their
 * weights, kept `grainGap` apart). Most logs put a grain right beside a knot (the hard case);
 * the rest place everything freely. The same seed always gives the same log.
 */
export function generateLog(rules: Riving, seed: number): RivingLog {
  const rng = new Rng(seed);
  const { generator } = rules;
  const checks = Array.from({ length: rng.int(generator.checks.min, generator.checks.max) }, () =>
    Math.round(rng.range(0, 360)),
  );
  const total = rules.grainKinds.reduce((sum, kind) => sum + kind.weight, 0);
  const pickKind = () => {
    let roll = rng.range(0, total);
    for (const kind of rules.grainKinds) {
      roll -= kind.weight;
      if (roll < 0) return kind.id;
    }
    return rules.grainKinds[rules.grainKinds.length - 1]?.id ?? '';
  };
  // Grains and knots share the face, each kept `grainGap` from the others.
  const taken: { angle: number; width: number }[] = [];
  const clear = (angle: number, width: number, gap = generator.grainGap) =>
    taken.every((other) => {
      const apart = Math.abs(((angle - other.angle + 540) % 360) - 180);
      return apart >= (width + other.width) / 2 + gap;
    });
  const place = (width: number, near?: { angle: number; width: number }) => {
    for (let tries = 0; tries < 40; tries++) {
      // Near a knot: just past its edge, on either side.
      const angle = near
        ? near.angle +
          (rng.chance(0.5) ? 1 : -1) *
            ((near.width + width) / 2 +
              rng.range(generator.conflictGap.min, generator.conflictGap.max))
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
  const conflict = knots[0] && rng.chance(generator.conflictChance) ? knots[0] : undefined;
  for (let index = rng.int(generator.grains.min, generator.grains.max); index > 0; index--) {
    const width = Math.round(rng.range(generator.grainWidth.min, generator.grainWidth.max));
    // The hard case: the first grain right beside a knot.
    const angle = place(width, grains.length === 0 ? conflict : undefined) ?? place(width);
    if (angle !== undefined) grains.push({ kind: pickKind(), angle, width });
  }
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
