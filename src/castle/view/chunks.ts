import * as THREE from 'three';
import type { Castle, CastlePart } from '../../data';
import { block, drum, wedge, type Skin } from './stonework';

// The shapes the castle's stonework is built of, wall and tower alike: a slice of wall (its body,
// and its foot, trim band and walk where the slice reaches them), a battlement, a wedge of a
// round tower. Each is made once per shape and drawn as instances where the layout puts the parts
// of that shape (or, for stonework that never comes apart, merged with the rest of the castle).
// Every shape stands on its own origin: a wall slice's foot middle (x along the wall, z out of the
// castle), a tower wedge's tower middle at the row's foot.

/** The castle's materials for its stonework. */
export interface StoneSkins {
  skins: Record<keyof Castle['skins'], { material: THREE.Material; skin: Skin }>;
}

/** A shape: its meshes, each a geometry in a material. */
export type Shape = { material: THREE.Material; geometry: THREE.BufferGeometry }[];

/**
 * A slice of curtain wall `length` long from `y0` to `y1` up, its middle at the origin: the body,
 * and whatever of the foot, the trim band and the walk falls in it (cut to it), placed by `matrix`.
 */
export function wallSlice(
  castle: Castle,
  { skins }: StoneSkins,
  length: number,
  y0: number,
  y1: number,
  matrix: THREE.Matrix4,
): Shape {
  const w = castle.wall;
  const cap = castle.details.cap;
  const shape: Shape = [];
  const put = (
    key: keyof Castle['skins'],
    size: [number, number, number],
    at: [number, number, number],
  ) => {
    const place = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(...at));
    shape.push({ material: skins[key].material, geometry: block(size, place, skins[key].skin) });
  };
  put('wall', [length, y1 - y0, w.thickness], [0, 0, 0]);
  if (y0 === 0) {
    const foot = w.thickness + w.plinth.out * 2;
    put('wall', [length, Math.min(w.plinth.height, y1), foot], [0, 0, 0]);
    if (w.plinth.height < y1) {
      put('trim', [length, cap.height * 1.5, foot + cap.out], [0, w.plinth.height, 0]);
    }
  }
  const course = w.height - w.course.height;
  if (course >= y0 && course < y1) {
    put('trim', [length, w.course.height, w.thickness + w.course.out * 2], [0, course - y0, 0]);
  }
  if (y1 >= w.height) {
    put(
      'walk',
      [length, 0.04, w.thickness - w.parapet.thickness],
      [0, w.height - y0, -w.parapet.thickness / 2],
    );
  }
  return shape;
}

/** A battlement `length` long: a stretch of parapet with two merlons on it, capped. */
export function battlement(castle: Castle, { skins }: StoneSkins, length: number): Shape {
  const w = castle.wall;
  const shape: Shape = [];
  const at = (x: number, y: number) => new THREE.Matrix4().makeTranslation(x, y, 0);
  shape.push({
    material: skins.wall.material,
    geometry: block([length, w.parapet.height, w.parapet.thickness], at(0, 0), skins.wall.skin),
  });
  for (const x of [-length / 4, length / 4]) {
    shape.push(...merlon(castle, { skins }, at(x, w.parapet.height)));
  }
  return shape;
}

/** A merlon and its capstone, standing on the origin (or placed by `matrix`). */
export function merlon(castle: Castle, { skins }: StoneSkins, matrix = new THREE.Matrix4()): Shape {
  const w = castle.wall;
  const cap = castle.details.cap;
  const size: [number, number, number] = [w.merlon.width, w.merlon.height, w.parapet.thickness];
  return [
    { material: skins.wall.material, geometry: block(size, matrix, skins.wall.skin) },
    {
      material: skins.cap.material,
      geometry: block(
        [size[0] + cap.out * 2, cap.height, size[2] + cap.out * 2],
        matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, w.merlon.height, 0)),
        skins.cap.skin,
      ),
    },
  ];
}

/**
 * A row of a round tower that comes apart: one wedge of it, as the layout's `part` says (its
 * size: radius, height, angle), with the tower's foot, trim band and crown where the row reaches
 * them. On the top row of a tower with battlements, the wedge's stretch of parapet and its share
 * of the merlons; under a roof, a closed stretch the roof sits on.
 */
export function towerWedge(castle: Castle, { skins }: StoneSkins, part: CastlePart): Shape {
  const tower = castle.towers.find((candidate) => candidate.id === part.owner);
  if (!tower) throw new Error(`No tower "${part.owner}"`);
  const w = castle.wall;
  const { cap, corbel, towerSides } = castle.details;
  const [radius, height, angle] = part.size;
  const y0 = part.at[1];
  const y1 = y0 + height;
  const top = part.row !== undefined && part.rows !== undefined && part.row === part.rows - 1;
  const sides = Math.max(2, Math.round((towerSides * angle) / (Math.PI * 2)));
  const shape: Shape = [];
  const add = (key: keyof Castle['skins'], geometry: THREE.BufferGeometry) => {
    shape.push({ material: skins[key].material, geometry });
  };
  const ring = (key: keyof Castle['skins'], outer: number, y: number, h: number, inner = 0) => {
    add(key, wedge(inner, outer, y - y0, h, angle, sides, skins[key].skin));
  };
  ring('tower', radius, y0, height);
  if (y0 === 0) {
    ring('tower', radius + w.plinth.out, 0, Math.min(w.plinth.height, y1));
    ring('trim', radius + w.plinth.out + cap.out, w.plinth.height, cap.height * 1.5);
  }
  const course = w.height - w.course.height;
  if (course >= y0 && course < y1) ring('trim', radius + w.course.out, course, w.course.height);
  if (top) {
    const h = tower.height;
    const rim = radius + corbel.out;
    ring('trim', rim, h - corbel.height, corbel.height);
    if (tower.top === 'roof') {
      ring('tower', rim, h, w.parapet.height);
    } else {
      const inner = rim - w.parapet.thickness;
      ring('tower', rim, h, w.parapet.height, inner);
      ring('cap', rim, h + w.parapet.height, 0.02, inner);
      ring('walk', inner, h, 0.04);
      // Its share of the merlons round the top, evenly.
      const middle = rim - w.parapet.thickness / 2;
      const all = Math.floor((Math.PI * 2 * middle) / (w.merlon.width + w.merlon.gap));
      const each = Math.max(1, Math.round(all / castle.towerChunks.sectors));
      for (let i = 0; i < each; i++) {
        const turn = (angle * (i + 0.5)) / each;
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(
            Math.sin(turn) * middle,
            h + w.parapet.height - y0,
            Math.cos(turn) * middle,
          ),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
          new THREE.Vector3(1, 1, 1),
        );
        shape.push(...merlon(castle, { skins }, matrix));
      }
    }
  }
  return shape;
}

/** A whole round tower's drum and rings that never comes apart (a solid one), at (x, z). */
export function solidTower(
  castle: Castle,
  { skins }: StoneSkins,
  x: number,
  z: number,
  radius: number,
  height: number,
  top: 'roof' | 'battlements',
): Shape {
  const w = castle.wall;
  const { cap, corbel, towerSides } = castle.details;
  const shape: Shape = [];
  const add = (key: keyof Castle['skins'], geometry: THREE.BufferGeometry) => {
    shape.push({ material: skins[key].material, geometry });
  };
  const sides = towerSides;
  add('tower', drum(x, z, 0, radius, height, sides, skins.tower.skin));
  add('tower', drum(x, z, 0, radius + w.plinth.out, w.plinth.height, sides, skins.tower.skin));
  add(
    'trim',
    drum(
      x,
      z,
      w.plinth.height,
      radius + w.plinth.out + cap.out,
      cap.height * 1.5,
      sides,
      skins.trim.skin,
    ),
  );
  add(
    'trim',
    drum(
      x,
      z,
      w.height - w.course.height,
      radius + w.course.out,
      w.course.height,
      sides,
      skins.trim.skin,
    ),
  );
  const rim = radius + corbel.out;
  add('trim', drum(x, z, height - corbel.height, rim, corbel.height, sides, skins.trim.skin));
  if (top === 'roof') {
    add('tower', drum(x, z, height, rim, w.parapet.height, sides, skins.tower.skin));
  } else {
    const inner = rim - w.parapet.thickness;
    const at = (geometry: THREE.BufferGeometry) => geometry.translate(x, 0, z);
    add(
      'tower',
      at(wedge(inner, rim, height, w.parapet.height, Math.PI * 2, sides, skins.tower.skin)),
    );
    add('walk', at(wedge(0, inner, height, 0.04, Math.PI * 2, sides, skins.walk.skin)));
  }
  return shape;
}
