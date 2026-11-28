import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/data';
import { loadPhysics, type Physics } from '../src/stations/siege/logic/physics';
import { SiegeRound } from '../src/stations/siege/logic/round';
import { siegeWeapon, solveAim, type Vec3 } from '../src/stations/siege/logic/throw';
import { data, testLogger } from './helpers';

// What a big collapse costs the physics (the rules), with and without the cuts: landed spears
// stop being bodies (with continuous collision detection) once they've settled, and settled
// chunks are fixed where they lie. The same shots both ways: five barrages over the front wall,
// then the front wall's columns knocked out from under it, watched for four seconds. It prints the
// physics time per step (it varies with the machine, so it's not checked); what's checked is the
// work: what's still a body once it's all settled.

let physics: Physics;
beforeAll(async () => {
  physics = await loadPhysics();
});

const WEAPON = siegeWeapon(data.siege);

/** The data with the cuts on (as shipped) or off (nothing ever settles out of the physics). */
function game(cuts: boolean): GameData {
  if (cuts) return data;
  const off = structuredClone(data);
  off.siege.settle.spearSeconds = 1e9;
  off.siege.settle.partSeconds = 1e9;
  return off;
}

function collapse(cuts: boolean) {
  const { logger } = testLogger();
  const warchest = { spears: 1000 };
  const round = new SiegeRound(
    physics,
    game(cuts),
    {
      logger,
      feel: () => data.siege.feel,
      spears: () => warchest.spears,
      spend: (count) => {
        warchest.spears -= count;
      },
      finish: () => undefined,
      onEvent: () => undefined,
    },
    { aimed: 10, seed: 21 },
  );
  const steps: number[] = [];
  const step = () => {
    const from = performance.now();
    round.step();
    steps.push(performance.now() - from);
  };
  const shoot = (target: Vec3, mode: 'aimed' | 'barrage', watch: number) => {
    for (let i = 0; i < 600 && !round.canThrow; i++) step();
    round.throw(mode, solveAim(round.mount(), target, WEAPON, data.siege.physics.gravity));
    for (let i = 0; i < watch; i++) step();
  };
  // Barrages over the front: 150 spears landing in and round the castle.
  for (const x of [-10, -5, 0, 5, 10]) shoot({ x, y: 6, z: 17.5 }, 'barrage', 30);
  const before = steps.length;
  // The front walls' columns knocked out from under them, low on their faces.
  for (const x of [-6.2, -9.5, -12.8, 6.2, 9.5, 12.8]) {
    shoot({ x, y: 1.5, z: 17.5 }, 'aimed', 20);
    shoot({ x, y: 1.5, z: 17.5 }, 'aimed', 20);
  }
  for (let i = 0; i < 240; i++) step();
  const window = steps.slice(before);
  const sorted = [...window].sort((a, b) => a - b);
  const total = window.reduce((sum, ms) => sum + ms, 0);
  const result = {
    steps: window.length,
    totalMs: Math.round(total),
    meanMs: Math.round((total / window.length) * 100) / 100,
    p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 100) / 100,
    worstMs: Math.round((sorted.at(-1) ?? 0) * 100) / 100,
    spearsThrown: round.used,
    spearBodies: round.spearBodies,
    partsLoose: round.partsLoose,
    partsDown: round.partsDown,
    partsBroken: round.partsBroken,
  };
  round.dispose();
  return result;
}

describe('the cost of a big collapse', () => {
  it('drops settled spears and chunks out of the physics', { timeout: 120_000 }, () => {
    // Once each way to warm up, then measured.
    collapse(false);
    collapse(true);
    const off = collapse(false);
    const on = collapse(true);
    console.log('siege collapse, physics per step (ms):', JSON.stringify({ off, on }, null, 1));
    expect(on.partsBroken).toBeGreaterThan(5);
    expect(on.spearBodies).toBe(0);
    expect(on.partsLoose).toBe(0);
    expect(off.spearBodies).toBeGreaterThan(100);
  });
});
