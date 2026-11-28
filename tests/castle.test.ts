import { describe, expect, it } from 'vitest';
import {
  castleProblems,
  layoutCastle,
  segmentHitsBox,
  insidePolygon,
  GameDataError,
  castleBreakableKinds,
  gatehouseEdges,
  gatehouseRows,
  castleSchema,
  type GameDataInput,
} from '../src/data';
import { data, dataWith, editableRawData } from './helpers';

const castle = data.castle;

/** The real castle with one change, its problems (parsed alone, so they come back, not a throw). */
function problemsWith(edit: (castle: GameDataInput['castle']) => void): string[] {
  const raw = editableRawData();
  edit(raw.castle);
  return castleProblems(castleSchema.parse(raw.castle)).map((problem) => problem.message);
}

describe('the castle', () => {
  it('holds together as shipped', () => {
    expect(castleProblems(castle)).toEqual([]);
  });

  it('closes its wall in one ring through every tower', () => {
    const layout = layoutCastle(castle);
    expect(layout.ring).toHaveLength(castle.towers.length);
    expect(new Set(layout.ring)).toEqual(new Set(castle.towers.map((tower) => tower.id)));
    expect(layout.walls).toHaveLength(castle.walls.length);
  });

  it('runs each wall between its towers, its walk on top and its merlons along it', () => {
    const layout = layoutCastle(castle);
    for (const wall of layout.walls) {
      expect(wall.clear[0]).toBeGreaterThan(0);
      expect(wall.clear[1]).toBeLessThan(wall.length);
      // The stonework runs into the towers past where the wall shows.
      expect(wall.body[0]).toBeLessThanOrEqual(wall.clear[0]);
      expect(wall.body[1]).toBeGreaterThanOrEqual(wall.clear[1]);
      expect(wall.walk.from[1]).toBe(castle.wall.height);
      expect(wall.walk.width).toBeCloseTo(castle.wall.thickness - castle.wall.parapet.thickness);
      expect(wall.merlons.length).toBeGreaterThan(2);
      for (const at of wall.merlons) {
        expect(at - castle.wall.merlon.width / 2).toBeGreaterThanOrEqual(wall.clear[0] - 1e-9);
        expect(at + castle.wall.merlon.width / 2).toBeLessThanOrEqual(wall.clear[1] + 1e-9);
      }
      // Out of the castle is away from the courtyard.
      const middle: [number, number] = [
        wall.origin[0] + wall.dir[0] * (wall.length / 2) + wall.out[0],
        wall.origin[1] + wall.dir[1] * (wall.length / 2) + wall.out[1],
      ];
      expect(insidePolygon(middle, layout.outline)).toBe(false);
    }
  });

  it('puts the captain at windows in the keep, the bell and spear racks in the courtyard', () => {
    const layout = layoutCastle(castle);
    const { captainWindows, spearRacks, bell, lookouts } = layout.anchors;
    expect(captainWindows).toHaveLength(castle.anchors.captainWindows.length);
    const keep = layout.buildings.find((building) => building.id === 'keep');
    expect(keep).toBeDefined();
    for (const window of captainWindows) {
      const [x, y, z] = window.at;
      // In the keep's outer face, between its ground and its eaves.
      const onX =
        Math.abs(x - (keep?.min[0] ?? 0)) < 1e-9 || Math.abs(x - (keep?.max[0] ?? 0)) < 1e-9;
      const onZ =
        Math.abs(z - (keep?.min[1] ?? 0)) < 1e-9 || Math.abs(z - (keep?.max[1] ?? 0)) < 1e-9;
      expect(onX || onZ).toBe(true);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(keep?.height ?? 0);
    }
    expect(spearRacks.length).toBeGreaterThan(1);
    for (const point of [...spearRacks.map((rack) => rack.at), bell.at]) {
      expect(insidePolygon([point[0], point[2]], layout.outline)).toBe(true);
    }
    // Lookouts stand on their towers' tops.
    expect(lookouts).toHaveLength(castle.anchors.lookouts.length);
    for (const lookout of lookouts) {
      const tower = castle.towers.find((candidate) => candidate.id === lookout.tower);
      expect(lookout.at[1]).toBe(tower?.height);
    }
  });

  it('fails on a lookout off its tower or on a roofed one, and a rack that is not a prop', () => {
    expect(
      problemsWith((raw) => {
        raw.anchors.lookouts = [{ id: 'far', tower: 'south_west', at: [9, 0] }];
      }),
    ).toContain('Stand inside the tower’s parapet');
    expect(
      problemsWith((raw) => {
        raw.anchors.lookouts = [{ id: 'roofed', tower: 'north_west', at: [0, 0] }];
      }),
    ).toContain('A lookout stands on a tower with battlements');
    expect(
      problemsWith((raw) => {
        raw.anchors.spearRacks = ['nowhere'];
      }),
    ).toContain('Unknown prop "nowhere"');
  });

  it('takes a guard up a stair from the ground to the walk', () => {
    const layout = layoutCastle(castle);
    const climb = layout.anchors.guardPaths.find((path) => path.id === 'west_climb');
    expect(climb?.points.map((point) => point.level)).toEqual(['ground', 'ground', 'walk', 'walk']);
    const [, bottom, top] = climb?.points ?? [];
    expect(bottom?.stair).toBe('west_stair');
    expect(top?.at[1]).toBe(castle.wall.height);
    expect(top?.wall).toBe('west');
  });

  it('builds the walls and round towers of chunks, each named once', () => {
    const { parts, walls } = layoutCastle(castle);
    expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
    const of = (owner: string, kind: string) =>
      parts.filter((part) => part.owner === owner && part.kind === kind);
    const rows = castle.wall.chunks.rows;
    for (const wall of walls) {
      const solid = castle.walls.find((candidate) => candidate.id === wall.id)?.solid;
      // Columns from tower to tower, each stacked `rows` high, a battlement on each.
      const covered = wall.columns.reduce((sum, column) => sum + column.length, 0);
      expect(covered).toBeCloseTo(wall.clear[1] - wall.clear[0]);
      expect(of(wall.id, 'wallChunk')).toHaveLength(solid ? 0 : wall.columns.length * rows);
      expect(of(wall.id, 'battlement')).toHaveLength(wall.columns.length);
      expect(wall.merlons).toHaveLength(wall.columns.length * 2);
      const stacked = of(wall.id, 'wallChunk').reduce((sum, part) => sum + part.size[1], 0);
      if (!solid) expect(stacked).toBeCloseTo(castle.wall.height * wall.columns.length);
    }
    const { sectors, rows: towerRows } = castle.towerChunks;
    for (const tower of castle.towers) {
      const chunked = tower.shape === 'round' && !tower.solid;
      expect(of(tower.id, 'towerChunk')).toHaveLength(chunked ? sectors * towerRows : 0);
      expect(of(tower.id, 'gate')).toHaveLength(tower.gate ? 1 : 0);
      expect(of(tower.id, 'towerRoof')).toHaveLength(
        tower.shape === 'round' && tower.top === 'roof' ? 1 : 0,
      );
      // A solid tower's merlons still come off one by one.
      if (!chunked && tower.top === 'battlements') {
        expect(of(tower.id, 'merlon').length).toBeGreaterThan(4);
      }
    }
    expect(of('keep', 'roof')).toHaveLength(1);
    expect(of(castle.bell.id, 'bell')).toHaveLength(1);
  });

  it('builds the gatehouse of blocks: two piers and the stonework over the gate, in rows', () => {
    const { parts } = layoutCastle(castle);
    const gatehouse = castle.towers.find((tower) => tower.gate);
    if (!gatehouse?.gate) throw new Error('No gatehouse');
    const blocks = parts.filter(
      (part) => part.kind === 'gatehouseChunk' && part.owner === gatehouse.id,
    );
    const { rows, deep } = castle.gatehouseChunks;
    // Each pier in every row; over the gate, every row but the bottom one.
    expect(blocks).toHaveLength(2 * rows * deep + (rows - 1) * deep);
    // The bottom row is as high as the gate, and the rows stack to the gatehouse's height.
    expect(gatehouseRows(castle, gatehouse)[1]).toBe(gatehouse.gate.height);
    expect(gatehouseRows(castle, gatehouse).at(-1)).toBeCloseTo(gatehouse.height);
    const volume = blocks.reduce(
      (sum, part) => sum + part.size[0] * part.size[1] * part.size[2],
      0,
    );
    const depth = (gatehouse.depth ?? gatehouse.size) * 2;
    const whole = gatehouse.size * 2 * gatehouse.height * depth;
    expect(volume).toBeCloseTo(whole - gatehouse.gate.width * gatehouse.gate.height * depth);
    const ids = new Set(blocks.map((part) => part.id));
    for (const part of blocks) {
      // Bottom blocks stand on the ground; the lowest over the gate is held between the piers.
      const over = Math.abs(part.at[0] - gatehouse.at[0]) < 1e-6;
      expect(part.on).toHaveLength(part.row === 0 ? 0 : over && part.row === 1 ? 2 : 1);
      for (const under of part.on ?? []) expect(ids.has(under)).toBe(true);
    }
    // Its merlons stand on its top row, and the parapet runs round its four edges on them.
    const merlons = parts.filter((part) => part.kind === 'merlon' && part.owner === gatehouse.id);
    for (const merlon of merlons) {
      const under = blocks.find((part) => part.id === merlon.on?.[0]);
      expect(under?.row).toBe(rows - 1);
    }
    const top = blocks.filter((part) => part.row === rows - 1);
    const parapet = top.flatMap((part) => gatehouseEdges(castle, part));
    const run = parapet.reduce((sum, edge) => sum + edge.length, 0);
    const out = castle.details.corbel.out;
    const thick = castle.wall.parapet.thickness;
    expect(run).toBeCloseTo(2 * (gatehouse.size * 2 + out * 2) + 2 * (depth + out * 2 - thick * 2));
  });

  it('builds the keep’s top storey of blocks, its roof on them', () => {
    const { parts, buildings } = layoutCastle(castle);
    const keep = castle.buildings.find((building) => building.id === 'keep');
    if (!keep?.chunks) throw new Error('The keep has no blocks');
    const blocks = parts.filter((part) => part.kind === 'storeyChunk' && part.owner === 'keep');
    expect(blocks).toHaveLength(keep.chunks.across.length * keep.chunks.deep.length);
    const top = (keep.storeys - keep.chunks.storeys) * castle.storey;
    expect(buildings.find((building) => building.id === 'keep')?.solidHeight).toBe(top);
    for (const part of blocks) expect(part.at[1]).toBe(top);
    const area = blocks.reduce((sum, part) => sum + part.size[0] * part.size[2], 0);
    expect(area).toBe(keep.modules[0] * keep.modules[1] * castle.module ** 2);
    const roof = parts.find((part) => part.kind === 'roof' && part.owner === 'keep');
    expect([...(roof?.on ?? [])].sort()).toEqual(blocks.map((part) => part.id).sort());
  });

  it('fixes slits, doorways and ivy to the chunk they are on', () => {
    const { parts } = layoutCastle(castle);
    const ids = new Set(parts.map((part) => part.id));
    const fixed = parts.filter((part) => ['slit', 'doorway', 'vine'].includes(part.kind));
    expect(fixed.length).toBeGreaterThan(0);
    for (const part of fixed) {
      if (part.of !== undefined) expect(ids.has(part.of)).toBe(true);
      // Only what's on solid stonework has no chunk.
      const tower = castle.towers.find((candidate) => candidate.id === part.owner);
      const wall = castle.walls.find((candidate) => candidate.id === part.owner);
      if (tower && !tower.solid) expect(part.of).toBeDefined();
      if (wall && !wall.solid) expect(part.of).toBeDefined();
    }
  });

  it('keeps the breakable chunks to a count physics can carry', () => {
    const { parts } = layoutCastle(castle);
    const breakable = parts.filter((part) => castleBreakableKinds.includes(part.kind));
    // Every one becomes a physics body in the siege; the budget phone handled about 200.
    expect(breakable.length).toBeLessThanOrEqual(250);
  });

  it('keeps every vantage point outside the walls', () => {
    const layout = layoutCastle(castle);
    for (const vantage of castle.vantages) {
      expect(insidePolygon([vantage.at[0], vantage.at[2]], layout.outline)).toBe(false);
    }
  });

  it('tells a segment through a box from one beside it', () => {
    expect(segmentHitsBox([-5, 0], [5, 0], [-1, -1], [1, 1])).toBe(true);
    expect(segmentHitsBox([-5, 2], [5, 2], [-1, -1], [1, 1])).toBe(false);
    expect(segmentHitsBox([0, -5], [0, -2], [-1, -1], [1, 1])).toBe(false);
  });
});

describe('a castle that does not hold together', () => {
  it('fails the game data loudly', () => {
    expect(() =>
      dataWith((raw) => {
        raw.castle.walls = raw.castle.walls.slice(1);
      }),
    ).toThrow(GameDataError);
  });

  it('needs its walls to close a ring', () => {
    expect(problemsWith((c) => (c.walls = c.walls.slice(1)))[0]).toMatch(/joins 1 walls/);
  });

  it('needs walls to join known towers, straight along x or z', () => {
    expect(
      problemsWith((c) => {
        const wall = c.walls[0];
        if (wall) wall.to = 'nowhere';
      }),
    ).toContain('Unknown tower "nowhere"');
    expect(
      problemsWith((c) => {
        const tower = c.towers[1];
        if (tower) tower.at = [18, -14];
      }),
    ).toContain('A wall runs straight along x or z');
  });

  it('keeps towers on the grid and gates in square towers', () => {
    expect(
      problemsWith((c) => {
        const tower = c.towers[0];
        if (tower) tower.at = [-17, -16];
      }),
    ).toContain('Towers stand on the 2 m grid');
    expect(
      problemsWith((c) => {
        const tower = c.towers[0];
        if (tower) tower.gate = { width: 2, height: 3 };
      }),
    ).toContain('Only a square tower has a gate');
  });

  it('keeps buildings in the courtyard and their facades the right size', () => {
    expect(
      problemsWith((c) => {
        const keep = c.buildings[0];
        if (keep) keep.at = [0, -14];
      }),
    ).toContain('Building "keep" must stand in the courtyard, clear of the walls');
    expect(
      problemsWith((c) => {
        const keep = c.buildings[0];
        if (keep) keep.facades.front = ['t-d-t', '-w-w-', 'tw-wtt'];
      }),
    ).toContain('Give 5 modules, one letter each');
    expect(
      problemsWith((c) => {
        const keep = c.buildings[0];
        if (keep) keep.facades.front = ['t-d-t', '-wdw-', 'tw-wt'];
      }),
    ).toContain('Doors go on the ground floor');
  });

  it('puts the captain only at windows', () => {
    expect(
      problemsWith((c) => {
        c.anchors.captainWindows = [{ building: 'keep', side: 'front', storey: 0, module: 1 }];
      }),
    ).toContain('Not a window: front storey 0 module 1');
  });

  it("never lets a guard's way jump between the ground and the walk, or walk through walls", () => {
    expect(
      problemsWith((c) => {
        c.anchors.guardPaths = [
          { id: 'jump', loop: false, points: [{ ground: [-12, 9] }, { walk: 'west', at: 27 }] },
        ];
      }),
    ).toContain('Steps between the ground and the walk without a stair (point 0)');
    expect(
      problemsWith((c) => {
        c.anchors.guardPaths = [
          {
            id: 'corner',
            loop: false,
            points: [
              { walk: 'west', at: 27 },
              { walk: 'north', at: 6 },
            ],
          },
        ];
      }),
    ).toContain('Leaves wall "west"\'s walk for "north" (point 0)');
    expect(
      problemsWith((c) => {
        c.anchors.guardPaths = [
          { id: 'through', loop: false, points: [{ ground: [0, -2] }, { ground: [0, -13.3] }] },
        ];
      }),
    ).toContain('Walks through a building (point 0)');
  });

  it('needs columns long enough for their merlons, and a square tower with no gate solid', () => {
    expect(problemsWith((c) => (c.wall.chunks.length = 1.5))).toContain(
      'Wall "front_right"\'s columns are too short for two merlons',
    );
    expect(
      problemsWith((c) => {
        const gatehouse = c.towers.find((tower) => tower.id === 'gatehouse');
        if (gatehouse) delete gatehouse.gate;
      }),
    ).toContain(
      'A square tower without a gate is solid (only gatehouses and round towers come apart)',
    );
  });

  it('needs a building’s blocks to add up to its modules, in storeys it has', () => {
    const keep = (c: GameDataInput['castle']) => c.buildings.find((b) => b.id === 'keep');
    expect(
      problemsWith((c) => {
        const chunks = keep(c)?.chunks;
        if (chunks) chunks.across = [2, 2];
      }),
    ).toContain('Its blocks across must add up to 5 modules');
    expect(
      problemsWith((c) => {
        const chunks = keep(c)?.chunks;
        if (chunks) chunks.deep = [4, 1];
      }),
    ).toContain('Its blocks deep must add up to 4 modules');
    expect(
      problemsWith((c) => {
        const chunks = keep(c)?.chunks;
        if (chunks) chunks.storeys = 4;
      }),
    ).toContain('No more storeys come apart than it has');
  });

  it('keeps stairs within their wall, and vantage points outside the walls', () => {
    expect(
      problemsWith((c) => {
        const stair = c.stairs[0];
        if (stair) stair.run = 30;
      }),
    ).toContain('Stair "west_stair" must climb within wall "west"\'s span');
    expect(
      problemsWith((c) => {
        const vantage = c.vantages[0];
        if (vantage) vantage.at = [0, 20, 0];
      }),
    ).toContain('Vantage "hill" must be outside the walls');
  });
});
