import * as THREE from 'three';

// The castle's own stonework, which the kits don't have: wall blocks, round towers, a gate's arch,
// merlons, steps. Plain shapes, textured in the world's metres with the kits' own colour maps (see
// `skinUv`), so a wall's bricks run on from one block to the next and match the kit's pieces. Every
// shape here has the attributes the kit's pieces have (position, normal, uv) and an index, so they
// all merge into one mesh per material.

/** How a shape wears its material's texture: one repeat every `tile` m, or a trim sheet's band. */
export interface Skin {
  tile: number;
  /** A strip of the texture (v from, v to): the shape's height is stretched over it. */
  band?: readonly [number, number] | undefined;
}

/** Only position, normal and uv, indexed: what every merged piece has. */
export function tidy(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const position = geometry.getAttribute('position');
  out.setAttribute('position', position.clone());
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normal) out.setAttribute('normal', normal.clone());
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  out.setAttribute(
    'uv',
    uv ? uv.clone() : new THREE.BufferAttribute(new Float32Array(position.count * 2), 2),
  );
  const index = geometry.getIndex();
  if (index) {
    out.setIndex(index.clone());
  } else {
    out.setIndex(Array.from({ length: position.count }, (_, i) => i));
  }
  if (!normal) out.computeVertexNormals();
  return out;
}

/**
 * Textures a shape already where it stands in the world: each face by the way it faces (a wall's
 * face across and up, a top across x and z), so the pattern is the same size everywhere and runs
 * on across neighbouring shapes. A band (a trim sheet's strip) is stretched over the shape's height.
 */
export function skinUv(geometry: THREE.BufferGeometry, skin: Skin): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const height = Math.max(box.max.y - box.min.y, 1e-6);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const across = nx > nz ? z : x;
    let u: number;
    let v: number;
    if (ny > Math.max(nx, nz)) {
      u = x / skin.tile;
      v = skin.band ? (skin.band[0] + skin.band[1]) / 2 : z / skin.tile;
    } else {
      u = across / skin.tile;
      // The kits' maps are upright with v down the image.
      v = skin.band
        ? skin.band[1] - ((y - box.min.y) / height) * (skin.band[1] - skin.band[0])
        : -y / skin.tile;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** A box `size` (x, y, z) standing on y = 0 about its middle, placed by `matrix`, skinned. */
export function block(
  size: readonly [number, number, number],
  matrix: THREE.Matrix4,
  skin: Skin,
): THREE.BufferGeometry {
  const geometry = tidy(new THREE.BoxGeometry(size[0], size[1], size[2]));
  geometry.translate(0, size[1] / 2, 0);
  geometry.applyMatrix4(matrix);
  return skinUv(geometry, skin);
}

/**
 * A round tower's drum, `radius` round and `height` high from `y`, its middle at (x, z), with
 * `sides` sides: textured round its side by the distance round, so its stones aren't stretched.
 * `open` leaves its ends off; `inside` faces it inward (the parapet's inner face).
 */
export function drum(
  x: number,
  z: number,
  y: number,
  radius: number,
  height: number,
  sides: number,
  skin: Skin,
  { open = false, inside = false }: { open?: boolean; inside?: boolean } = {},
): THREE.BufferGeometry {
  const geometry = tidy(new THREE.CylinderGeometry(radius, radius, height, sides, 1, open));
  if (inside) {
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) {
      normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, a);
      }
    }
  }
  geometry.translate(x, y + height / 2, z);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const round = Math.PI * 2 * radius;
  for (let i = 0; i < position.count; i++) {
    const py = position.getY(i);
    if (Math.abs(normal.getY(i)) > 0.5) {
      uv.setXY(i, position.getX(i) / skin.tile, position.getZ(i) / skin.tile);
      continue;
    }
    // The cylinder's own u runs 0 to 1 round it.
    const share = uv.getX(i);
    const v = skin.band
      ? skin.band[1] - ((py - y) / height) * (skin.band[1] - skin.band[0])
      : -py / skin.tile;
    uv.setXY(i, (share * round) / skin.tile, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * A flat outline (in x, y) with holes, extruded `depth` along z (from 0), placed by `matrix` and
 * skinned: a gatehouse's face with its arch, a gate's leaves, a stair's side.
 */
export function slab(
  shape: THREE.Shape,
  depth: number,
  matrix: THREE.Matrix4,
  skin: Skin,
  curveSegments = 10,
): THREE.BufferGeometry {
  const extruded = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  const geometry = tidy(extruded);
  extruded.dispose();
  geometry.applyMatrix4(matrix);
  return skinUv(geometry, skin);
}

/** An arch's outline: straight sides `width` apart up to the spring, a half circle over them. */
export function archPath(path: THREE.Path, centre: number, width: number, height: number): void {
  const radius = width / 2;
  const spring = Math.max(height - radius, 0);
  path.moveTo(centre - radius, 0);
  path.lineTo(centre + radius, 0);
  path.lineTo(centre + radius, spring);
  path.absarc(centre, spring, radius, 0, Math.PI, false);
  path.lineTo(centre - radius, 0);
}

/** Steps rising `height` over `run` (along local x), `width` deep (local z), one every `rise`. */
export function stepsShape(run: number, height: number, rise: number): THREE.Shape {
  const count = Math.max(1, Math.ceil(height / rise));
  const step = height / count;
  const tread = run / count;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(run, 0);
  shape.lineTo(run, height);
  for (let i = count - 1; i >= 0; i--) {
    shape.lineTo(i * tread, (i + 1) * step);
    shape.lineTo(i * tread, i * step);
  }
  return shape;
}

/** A bell's outline turned round its axis, hanging from y = 0 down, `size` across its mouth. */
export function bell(size: number): THREE.BufferGeometry {
  const r = size / 2;
  const h = size * 1.05;
  const outline = [
    [0.0, 0],
    [0.28, 0],
    [0.34, -0.08],
    [0.42, -0.35],
    [0.52, -0.7],
    [0.72, -0.92],
    [1.0, -1.0],
    [0.92, -1.0],
  ].map(([u = 0, v = 0]) => new THREE.Vector2(u * r, v * h));
  return tidy(new THREE.LatheGeometry(outline, 14));
}

/**
 * A wedge of a round tower: between `inner` (0 for a solid one) and `outer` radius, from angle 0
 * to `angle` round the y axis (as three.js turns: angle 0 faces +z), `height` high from `y`, with
 * `sides` sides round its curve. Its curved faces are textured round by the distance round (like
 * `drum`), its flat ones across x and z or along their own width.
 */
export function wedge(
  inner: number,
  outer: number,
  y: number,
  height: number,
  angle: number,
  sides: number,
  skin: Skin,
): THREE.BufferGeometry {
  // The outline across (x, −z), extruded up: rotated so the extrusion runs along +y.
  const shape = new THREE.Shape();
  const at = (radius: number, turn: number) =>
    new THREE.Vector2(Math.sin(turn) * radius, -Math.cos(turn) * radius);
  const outerPoints = Array.from({ length: sides + 1 }, (_, i) => at(outer, (angle * i) / sides));
  const innerPoints =
    inner > 0
      ? Array.from({ length: sides + 1 }, (_, i) => at(inner, (angle * (sides - i)) / sides))
      : [new THREE.Vector2(0, 0)];
  const [first, ...rest] = [...outerPoints, ...innerPoints];
  if (!first) throw new Error('A wedge needs points');
  shape.moveTo(first.x, first.y);
  for (const point of rest) shape.lineTo(point.x, point.y);
  shape.closePath();
  const extruded = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  const geometry = tidy(extruded);
  extruded.dispose();
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const v = skin.band
      ? skin.band[1] - ((py - y) / height) * (skin.band[1] - skin.band[0])
      : -py / skin.tile;
    if (Math.abs(ny) > 0.5) {
      uv.setXY(i, px / skin.tile, skin.band ? (skin.band[0] + skin.band[1]) / 2 : pz / skin.tile);
      continue;
    }
    const radius = Math.hypot(px, pz);
    // Curved (its normal points out from the axis, or in) or a flat cut face along a radius.
    const radial = radius > 1e-6 ? Math.abs(nx * px + nz * pz) / radius : 0;
    const round = radial > 0.7 ? Math.atan2(px, pz) * radius : radius;
    uv.setXY(i, round / skin.tile, v);
  }
  uv.needsUpdate = true;
  return geometry;
}
