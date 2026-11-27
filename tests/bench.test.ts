import { beforeAll, describe, expect, it } from 'vitest';
import { CollapseSim, type BodyPose } from '../src/bench/logic/collapse';
import { cameraAt, layoutScene, walkerAt, type Size } from '../src/bench/logic/layout';
import { pixelRatioFor, pixelRatioLabel, runAllPlan } from '../src/bench/logic/plan';
import {
  resultColumns,
  resultsText,
  summaryColumns,
  summaryTitle,
  type ResultRow,
} from '../src/bench/logic/results';
import { frameStats, percentile, textureBytes, timingStats } from '../src/bench/logic/stats';
import {
  bench,
  benchRoles,
  loadBenchData,
  type BenchData,
  type BenchRole,
} from '../src/data/bench';
import { loadPhysics, type Physics } from '../src/stations/siege/logic/physics';

let data: BenchData;
let physics: Physics;

beforeAll(async () => {
  data = loadBenchData();
  physics = await loadPhysics();
});

/** Every role a module wide and storey high (a pack's own units, here 1 m per module unit). */
const sizes = {
  roles: Object.fromEntries(benchRoles.map((role) => [role, [1, 1.5, 0.2] as Size])) as Record<
    BenchRole,
    Size
  >,
  props: Array.from({ length: 6 }, (): Size => [1, 0.5, 1]),
};

function pack(id: string) {
  const found = data.packs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No pack ${id}`);
  return found;
}

describe('bench data', () => {
  it('validates, with a pack for every run and Run all under 8 minutes', () => {
    expect(data.packs.map((candidate) => candidate.id)).toEqual([
      'boxes',
      'kenney',
      'village',
      'village-lite',
      'village-lite-1024',
      'village-heavy',
    ]);
    // 20 s a run, and allow 6 s each to load and warm up (on a PC, it's 1 to 3 s).
    expect(data.runAll.length * (data.seconds + 6)).toBeLessThan(8 * 60);
  });

  it('fails loudly on a run of a pack that does not exist', () => {
    const broken = { ...bench, runAll: [{ pack: 'nope', scale: 1 }] };
    expect(() => loadBenchData(broken)).toThrow(/Unknown pack "nope"/);
  });

  it('needs a models pack to name the pieces its buildings use', () => {
    const village = bench.packs[2];
    if (!village) throw new Error('No village pack');
    const roles: Partial<typeof village.roles> = { ...village.roles };
    delete roles.wall;
    const broken = {
      ...bench,
      packs: [{ ...village, roles }],
      runAll: [{ pack: 'village', scale: 1 }],
    };
    expect(() => loadBenchData(broken)).toThrow(/Missing the "wall" piece/);
  });
});

describe('stats', () => {
  it('interpolates percentiles', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 1)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('turns frame times into frame rates, the slow frames counted in the lows', () => {
    const frames = [...Array<number>(98).fill(16.667), 50, 100];
    const stats = frameStats(frames);
    expect(stats.frames).toBe(100);
    expect(stats.medianFps).toBeCloseTo(60, 0);
    expect(stats.worstMs).toBe(100);
    // The slowest 1% is the one 100 ms frame.
    expect(stats.low1Fps).toBe(10);
    expect(stats.p5Fps).toBeLessThanOrEqual(stats.medianFps);
    expect(frameStats([]).frames).toBe(0);
  });

  it('sums timings and texture memory', () => {
    expect(timingStats([1, 2, 3, 4, 5])).toEqual({ median: 3, p95: 4.8, max: 5 });
    expect(textureBytes(1024, 1024, { mipmaps: false })).toBe(4 * 1024 * 1024);
    expect(textureBytes(1024, 1024)).toBe(Math.round((16 * 1024 * 1024) / 3));
  });
});

describe('layout', () => {
  it('builds the same scene every time, with exactly the collapse’s bodies a copy', () => {
    const input = {
      pack: pack('village'),
      layout: data.layout,
      sizes,
      bodies: data.collapse.bodies,
      copies: 1,
      treeModels: 3,
      characterModels: 4,
    };
    const scene = layoutScene(input);
    expect(layoutScene(input)).toEqual(scene);
    expect(scene.pieces.filter((piece) => piece.collapse)).toHaveLength(data.collapse.bodies);
    const people = data.layout.characters;
    expect(scene.characters).toHaveLength(people.walks.length + people.idles.length);
    expect(scene.characters.length).toBeGreaterThanOrEqual(10);
    expect(scene.characters.length).toBeLessThanOrEqual(15);
    expect(scene.trees).toHaveLength(data.layout.trees.count);
    // Each building's pieces are filed under it, so a batched pack can merge them.
    const groups = new Set(scene.pieces.map((piece) => piece.group));
    expect([...groups].sort()).toEqual(
      ['crates', 'fort', 'house-0', 'house-1', 'house-2', 'props', 'tower'].filter(
        (group) => group !== 'props' || input.pack.props.length > 0,
      ),
    );
    expect(
      scene.pieces
        .filter((piece) => piece.group.startsWith('house'))
        .every((piece) => !piece.collapse),
    ).toBe(true);
  });

  it('copies everything for 2× and 4×, each copy in its own place', () => {
    const at = (copies: number) =>
      layoutScene({
        pack: pack('boxes'),
        layout: data.layout,
        sizes,
        bodies: data.collapse.bodies,
        copies,
        treeModels: 1,
        characterModels: 1,
      });
    const one = at(1);
    const four = at(4);
    expect(four.pieces).toHaveLength(one.pieces.length * 4);
    expect(four.characters).toHaveLength(one.characters.length * 4);
    expect(four.pieces.filter((piece) => piece.collapse)).toHaveLength(data.collapse.bodies * 4);
    const [, second] = data.layout.copies;
    const firstWall = one.pieces[0];
    const copied = four.pieces.find((piece) => piece.copy === 1);
    expect(copied?.x).toBeCloseTo((firstWall?.x ?? 0) + (second?.[0] ?? 0));
  });

  it('sizes every wall a module wide and stacks the storeys', () => {
    const scene = layoutScene({
      pack: pack('village'),
      layout: data.layout,
      sizes,
      bodies: data.collapse.bodies,
      copies: 1,
      treeModels: 1,
      characterModels: 1,
    });
    const walls = scene.pieces.filter(
      (piece) => 'role' in piece.piece && piece.piece.role === 'wall',
    );
    for (const wall of walls) expect(wall.size[0]).toBeCloseTo(data.layout.module);
    const storeys = new Set(walls.map((wall) => Math.round(wall.y * 100) / 100));
    expect(storeys.size).toBe(pack('village').fort.storeys);
  });
});

describe('walkers and the camera', () => {
  it('walks back and forth along its beat', () => {
    const walker = {
      model: 0,
      copy: 0,
      walk: true,
      from: [0, 0] as const,
      to: [10, 0] as const,
      turn: 0,
      phase: 0,
    };
    expect(walkerAt(walker, 1, 5).x).toBeCloseTo(5);
    expect(walkerAt(walker, 1, 5).turn).toBeCloseTo(Math.PI / 2);
    expect(walkerAt(walker, 1, 15).x).toBeCloseTo(5);
    expect(walkerAt(walker, 1, 15).turn).toBeCloseTo(-Math.PI / 2);
    expect(walkerAt({ ...walker, walk: false }, 1, 5)).toEqual({ x: 0, z: 0, turn: 0 });
  });

  it('passes through every camera key at its time, and holds still between equal keys', () => {
    for (const key of data.camera) {
      const view = cameraAt(data.camera, key.at);
      key.from.forEach((value, axis) => {
        expect(view.from[axis]).toBeCloseTo(value);
      });
    }
    const hold = cameraAt(data.camera, 19);
    expect(hold.from).toEqual([0, 1.8, 16]);
  });
});

describe('plan', () => {
  it('runs every run at the chosen pixel ratio', () => {
    const plan = runAllPlan(data, 1.5);
    expect(plan).toHaveLength(data.runAll.length);
    expect(plan.every((run) => run.pixelRatio === 1.5)).toBe(true);
  });

  it("caps the game's pixel ratio as the siege does", () => {
    expect(pixelRatioFor('game', 3, 2)).toBe(2);
    expect(pixelRatioFor('device', 3, 2)).toBe(3);
    expect(pixelRatioFor(1.5, 3, 2)).toBe(1.5);
    expect(pixelRatioLabel('device', 2.625, 2)).toBe('Device (2.63)');
  });
});

describe('collapse', () => {
  it('stands still until the collapse, then falls the same way every time', () => {
    const scene = layoutScene({
      pack: pack('boxes'),
      layout: data.layout,
      sizes,
      bodies: data.collapse.bodies,
      copies: 1,
      treeModels: 1,
      characterModels: 1,
    });
    const falling = scene.pieces.filter((piece) => piece.collapse);
    const run = () => {
      const sim = new CollapseSim(physics, falling, data.collapse, [data.collapse.blastAt]);
      const pose: BodyPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
      for (let step = 0; step < 30; step++) sim.step(data.collapse.timestep);
      const before = sim.pose(0, { ...pose });
      sim.collapse(data.layout.seed);
      for (let step = 0; step < 120; step++) sim.step(data.collapse.timestep);
      const after = sim.pose(0, { ...pose });
      const moving = sim.moving();
      sim.free();
      return { before, after, moving };
    };
    const first = run();
    expect(first.before.y).toBeCloseTo((falling[0]?.y ?? 0) + (falling[0]?.size[1] ?? 0) / 2);
    expect(first.after).not.toEqual(first.before);
    expect(first.moving).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  });
});

describe('results', () => {
  const row = (run: number, note = ''): ResultRow => ({
    run: String(run),
    pack: 'Village optimised',
    scale: '2×',
    shadows: 'blob',
    pixelRatio: '2',
    note,
    fps: '58.3',
    p5: '51',
    low1: '40.2',
    worstMs: '61.7',
    cpuMs: '6.41',
    physicsMs: '0.8',
    calls: '214',
    trisK: '310',
    textureMB: '38.5',
    loadS: '3.4',
  });

  it('copies as tab-separated text: the device line, the headings, a line a run', () => {
    const text = resultsText('build abc · GPU: Mali-G57', [row(1), row(2, 'two\tlines\nhere')]);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('build abc · GPU: Mali-G57');
    expect(lines[1]?.split('\t')).toEqual(resultColumns.map((column) => column.label));
    expect(lines[2]?.split('\t')).toEqual(resultColumns.map((column) => row(1)[column.key]));
    // A tab or line break inside a cell can't split it.
    expect(lines[3]?.split('\t')).toHaveLength(resultColumns.length);
    expect(lines[3]).toContain('two lines here');
  });

  it('sums each run up as a title line and the numbers that matter', () => {
    expect(summaryTitle(row(14, 'blob shadows'))).toBe(
      '14 · Village optimised 2× · shadows blob · blob shadows',
    );
    expect(summaryTitle(row(1))).toBe('1 · Village optimised 2× · shadows blob');
    expect(summaryColumns.map((column) => column.key)).toEqual([
      'fps',
      'low1',
      'worstMs',
      'cpuMs',
      'calls',
      'textureMB',
      'loadS',
    ]);
  });
});
