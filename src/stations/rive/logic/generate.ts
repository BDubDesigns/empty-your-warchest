import { Rng } from '../../../core';
import type { Riving, RivingLog } from '../../../data';

/**
 * A random log from `seed`: its size, rings, checks and grains (kinds picked by their weights,
 * kept `grainGap` apart). The same seed always gives the same log.
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
  const grains: RivingLog['grains'] = [];
  const count = rng.int(generator.grains.min, generator.grains.max);
  for (let index = 0; index < count; index++) {
    const width = Math.round(rng.range(generator.grainWidth.min, generator.grainWidth.max));
    for (let tries = 0; tries < 40; tries++) {
      const angle = Math.round(rng.range(0, 360));
      const clear = grains.every((other) => {
        const gap = Math.abs(((angle - other.angle + 540) % 360) - 180);
        return gap >= (width + other.width) / 2 + generator.grainGap;
      });
      if (!clear) continue;
      grains.push({ kind: pickKind(), angle, width });
      break;
    }
  }
  return {
    id: `log_${String(seed)}`,
    radius: Math.round(rng.range(generator.radius.min, generator.radius.max) * 100) / 100,
    height: Math.round(rng.range(generator.height.min, generator.height.max) * 100) / 100,
    rings: rng.int(generator.rings.min, generator.rings.max),
    checks,
    grains,
  };
}
