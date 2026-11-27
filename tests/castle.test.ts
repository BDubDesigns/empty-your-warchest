import { describe, expect, it } from 'vitest';
import {
  castleProblems,
  layoutCastle,
  segmentHitsBox,
  insidePolygon,
  GameDataError,
  castleBreakableKinds,
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

  it('puts the captain at windows in the keep, the bell and spear rack in the courtyard', () => {
    const layout = layoutCastle(castle);
    const { captainWindows, spearRack, bell } = layout.anchors;
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
    for (const point of [spearRack.at, bell.at]) {
      expect(insidePolygon([point[0], point[2]], layout.outline)).toBe(true);
    }
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
      if (tower && tower.shape === 'round' && !tower.solid) expect(part.of).toBeDefined();
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

  it('needs columns long enough for their merlons, and square towers solid', () => {
    expect(problemsWith((c) => (c.wall.chunks.length = 1.5))).toContain(
      'Wall "front_right"\'s columns are too short for two merlons',
    );
    expect(
      problemsWith((c) => {
        const gatehouse = c.towers.find((tower) => tower.id === 'gatehouse');
        if (gatehouse) gatehouse.solid = false;
      }),
    ).toContain('A square tower is solid (only round ones come apart yet)');
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
