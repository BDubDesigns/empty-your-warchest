import * as THREE from 'three';
import {
  Brush,
  Evaluator,
  HOLLOW_INTERSECTION,
  HOLLOW_SUBTRACTION,
  INTERSECTION,
} from 'three-bvh-csg';

/** Upper face of the notch, degrees above level: steep, like a downward strike leaves. */
const UPPER_SLOPE = 42;
/** Lower face of the notch, degrees below level. */
const LOWER_SLOPE = 12;
/** How far the notch goes into the trunk, as a share of the radius: first chop, and when it falls. */
const FIRST_DEPTH = 0.22;
const FULL_DEPTH = 0.78;
/** The trunk is measured this far below and above the cut, in rings of this many rays. */
const SHELL_BELOW = 0.4;
const SHELL_ABOVE = 0.55;
const SHELL_LEVELS = 8;
const SHELL_RAYS = 32;

let rings: THREE.CanvasTexture | undefined;

/** Light inner wood with growth rings, centred at uv (0.5, 0.5); the trunk's edge is at radius 0.5. */
function ringTexture(): THREE.CanvasTexture {
  if (rings) return rings;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#e9c891';
    g.fillRect(0, 0, size, size);
    const center = size / 2;
    for (let radius = 6; radius < center; radius += 7 + (radius % 5)) {
      g.strokeStyle = radius % 3 === 0 ? 'rgba(150, 100, 50, 0.55)' : 'rgba(170, 120, 65, 0.35)';
      g.lineWidth = 1.5 + (radius % 2);
      g.beginPath();
      g.ellipse(center, center, radius, radius * 0.96, 0.3, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#9c6a3a';
    g.beginPath();
    g.arc(center, center, 4, 0, Math.PI * 2);
    g.fill();
  }
  rings = new THREE.CanvasTexture(canvas);
  rings.colorSpace = THREE.SRGBColorSpace;
  return rings;
}

let woodMaterial: THREE.Material | undefined;

/** The freshly cut wood on the notch and the break, seen from either side. */
function cutWood(): THREE.Material {
  woodMaterial ??= new THREE.MeshLambertMaterial({ map: ringTexture(), side: THREE.DoubleSide });
  return woodMaterial;
}

/** Faces of the measured trunk shell: they shape the cut wood but are never drawn. */
const hidden = new THREE.MeshBasicMaterial({ visible: false });

interface Piece {
  mesh: THREE.Mesh;
  /** The bark as loaded, in the mesh's own space, ready for CSG. */
  bark: Brush;
  /** The bark with the current notch, once carved. */
  carved?: Brush;
  /** Size of the model's vertex colours (0 if none); the cutting shapes must carry them too. */
  colorSize: number;
  /** One per piece: an evaluator keeps the attribute layout it first saw. */
  evaluator: Evaluator;
}

/**
 * Carves the chopped tree for real: a wedge comes out of the bark on the struck side, deeper with
 * every chop, showing cut wood with rings. When it falls the trunk breaks at the notch and leaves
 * a notched stump behind. Works on whatever tree model is loaded: the bark meshes lose what's
 * inside the wedge, and the cut wood is shaped from a shell measured around the real trunk (so
 * models that aren't perfectly closed still get clean cut faces).
 */
export class TrunkCarver {
  /** Distance from the trunk's centre line to its bark, toward `cut`, at the cut height. */
  readonly surface: number;
  /** How far the notch currently goes in from the bark. */
  depth = 0;
  /** Milliseconds the slowest carve took, for the performance log. */
  slowestMs = 0;
  readonly #pieces: Piece[] = [];
  readonly #evaluator = new Evaluator();
  readonly #tree: THREE.Object3D;
  readonly #base: THREE.Vector3;
  readonly #cut: THREE.Vector3;
  readonly #height: number;
  readonly #shell: Brush;
  /** The notch's cut wood (world space), and the mesh showing it. */
  #walls?: THREE.BufferGeometry;
  readonly #wallMesh: THREE.Mesh;
  readonly #added: THREE.Mesh[] = [];

  /**
   * @param tree the tree's root, upright and placed in the scene
   * @param base where the trunk's centre line meets the ground
   * @param cut level direction out of the trunk on the struck side
   * @param height how high the notch is cut
   * @param fallback bark distance to use if the model can't be measured
   */
  constructor(
    tree: THREE.Object3D,
    base: THREE.Vector3,
    cut: THREE.Vector3,
    height: number,
    fallback: number,
  ) {
    this.#tree = tree;
    this.#base = base.clone();
    this.#cut = cut.clone().setY(0).normalize();
    this.#height = height;
    this.#evaluator.useGroups = true;
    this.#evaluator.attributes = ['position', 'uv', 'normal'];
    tree.updateMatrixWorld(true);
    tree.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child as THREE.Mesh;
      if (!isBark(mesh.material)) return;
      const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      const colorSize = color?.itemSize ?? 0;
      const evaluator = new Evaluator();
      evaluator.useGroups = true;
      evaluator.attributes =
        colorSize > 0 ? ['position', 'uv', 'normal', 'color'] : ['position', 'uv', 'normal'];
      this.#pieces.push({ mesh, bark: barkBrush(mesh), colorSize, evaluator });
    });
    this.surface = this.#distanceAt(this.#cut, base.y + height) ?? fallback;
    this.#shell = new Brush(this.#measureShell(fallback), hidden);
    this.#wallMesh = new THREE.Mesh(new THREE.BufferGeometry(), cutWood());
    this.#attach(this.#wallMesh, tree);
  }

  /** Cuts the notch to match `share` of the chop points (0–1). */
  carve(share: number): void {
    const started = performance.now();
    this.depth = this.surface * (FIRST_DEPTH + (FULL_DEPTH - FIRST_DEPTH) * Math.min(share, 1));
    const wedge = this.#wedge();
    for (const piece of this.#pieces) {
      const brush = this.#cutter(wedge, piece);
      const result = piece.evaluator.evaluate(piece.bark, brush, HOLLOW_SUBTRACTION);
      brush.geometry.dispose();
      this.#use(piece, plain(result, piece.bark.material as THREE.Material));
    }
    // The cut wood: the wedge's faces where they pass through the trunk.
    const walls = this.#evaluator.evaluate(new Brush(wedge, cutWood()), this.#shell, INTERSECTION);
    this.#walls?.dispose();
    this.#walls = plain(walls, cutWood());
    walls.geometry.dispose();
    this.#wallMesh.geometry = this.#walls;
    wedge.dispose();
    this.slowestMs = Math.max(this.slowestMs, performance.now() - started);
  }

  /**
   * Breaks the trunk at the notch's point. Each bark mesh keeps only what is above the break; the
   * part below, the lower notch face and the cut across the trunk become the stump (added to the
   * tree's root, which stays put). The upper notch face and the cut go with `top`, which falls.
   */
  split(top: THREE.Object3D): void {
    const started = performance.now();
    const below = this.#below();
    const stumpParent = this.#tree;
    for (const piece of this.#pieces) {
      const brush = this.#cutter(below, piece);
      const bark = piece.bark.material as THREE.Material;
      const [stump, upper] = piece.evaluator.evaluate(
        piece.carved ?? piece.bark,
        brush,
        [HOLLOW_INTERSECTION, HOLLOW_SUBTRACTION],
        [new Brush(), new Brush()],
      );
      brush.geometry.dispose();
      if (!stump || !upper) continue;
      this.#use(piece, plain(upper, bark));
      piece.mesh.updateMatrixWorld();
      this.#attach(new THREE.Mesh(plain(stump, bark), bark), stumpParent, piece.mesh.matrixWorld);
      stump.geometry.dispose();
      upper.geometry.dispose();
    }
    // The cut across the trunk: the break plane inside the trunk, minus the notch's opening.
    const inside = this.#evaluator.evaluate(new Brush(below, cutWood()), this.#shell, INTERSECTION);
    let face = plain(inside, cutWood());
    inside.geometry.dispose();
    if (this.#walls) {
      const wedge = this.#wedge();
      const open = this.#evaluator.evaluate(
        new Brush(face, cutWood()),
        new Brush(wedge, hidden),
        HOLLOW_SUBTRACTION,
      );
      face.dispose();
      wedge.dispose();
      face = plain(open, cutWood());
      open.geometry.dispose();
    }
    this.#attach(new THREE.Mesh(face, cutWood()), stumpParent);
    this.#attach(new THREE.Mesh(face.clone(), cutWood()), top);
    if (this.#walls) {
      // The notch's point is the break, so its lower face stays with the stump, its upper face falls.
      const [lower, upper] = splitAt(this.#walls, this.#base.y + this.#height);
      this.#wallMesh.visible = false;
      this.#attach(new THREE.Mesh(lower, cutWood()), stumpParent);
      this.#attach(new THREE.Mesh(upper, cutWood()), top);
    }
    below.dispose();
    this.slowestMs = Math.max(this.slowestMs, performance.now() - started);
  }

  /** Frees the geometry made here and removes the meshes added to the tree. */
  dispose(): void {
    for (const piece of this.#pieces) {
      piece.carved?.geometry.dispose();
      piece.bark.geometry.dispose();
    }
    for (const mesh of this.#added) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.#walls?.dispose();
    this.#shell.geometry.dispose();
  }

  /** Shows `geometry` (the piece's bark, in its own space) and keeps it for the next cut. */
  #use(piece: Piece, geometry: THREE.BufferGeometry): void {
    piece.carved?.geometry.dispose();
    const material = piece.bark.material as THREE.Material;
    piece.carved = new Brush(geometry, material);
    piece.mesh.geometry = geometry;
    piece.mesh.material = material;
  }

  /** Adds `mesh` (its geometry in world space, or in `from`'s space) under `parent`. */
  #attach(mesh: THREE.Mesh, parent: THREE.Object3D, from?: THREE.Matrix4): void {
    parent.updateMatrixWorld(true);
    const local = parent.matrixWorld.clone().invert();
    if (from) local.multiply(from);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    this.#added.push(mesh);
  }

  /** A cutting shape (world space) moved into `piece`'s space, with the attributes it needs. */
  #cutter(shape: THREE.BufferGeometry, piece: Piece): Brush {
    const geometry = shape.clone().applyMatrix4(piece.mesh.matrixWorld.clone().invert());
    if (piece.colorSize > 0) {
      const white = new Float32Array(geometry.getAttribute('position').count * piece.colorSize);
      geometry.setAttribute('color', new THREE.BufferAttribute(white.fill(1), piece.colorSize));
    }
    return new Brush(geometry, cutWood());
  }

  /** How far the bark is from the centre line in `direction` at world height `y`. */
  #distanceAt(direction: THREE.Vector3, y: number): number | undefined {
    const from = this.#base.clone().addScaledVector(direction, 3).setY(y);
    const ray = new THREE.Raycaster(from, direction.clone().negate(), 0, 3);
    const hit = ray.intersectObjects(
      this.#pieces.map((piece) => piece.mesh),
      false,
    )[0];
    return hit ? Math.max(3 - hit.distance, 0.03) : undefined;
  }

  /**
   * A closed shell hugging the real bark around the cut: rings of rays cast in from outside at a
   * few heights, joined up and capped. It stands in for the inside of the trunk.
   */
  #measureShell(fallback: number): THREE.BufferGeometry {
    const ringsOf: THREE.Vector3[][] = [];
    for (let level = 0; level < SHELL_LEVELS; level++) {
      const y =
        this.#base.y +
        this.#height -
        SHELL_BELOW +
        ((SHELL_BELOW + SHELL_ABOVE) * level) / (SHELL_LEVELS - 1);
      const ring: THREE.Vector3[] = [];
      let last = this.surface || fallback;
      for (let i = 0; i < SHELL_RAYS; i++) {
        const angle = (i / SHELL_RAYS) * Math.PI * 2;
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        last = this.#distanceAt(direction, y) ?? last;
        // A hair outside the bark, so no gap shows between the bark's edge and the cut wood.
        ring.push(
          this.#base
            .clone()
            .addScaledVector(direction, last * 1.02)
            .setY(y),
        );
      }
      ringsOf.push(ring);
    }
    const corners: THREE.Vector3[] = [];
    for (let level = 0; level < SHELL_LEVELS - 1; level++) {
      const lower = ringsOf[level];
      const upper = ringsOf[level + 1];
      if (!lower || !upper) continue;
      for (let i = 0; i < SHELL_RAYS; i++) {
        const j = (i + 1) % SHELL_RAYS;
        const [a, b, c, d] = [lower[i], lower[j], upper[j], upper[i]];
        if (a && b && c && d) corners.push(a, d, c, a, c, b);
      }
    }
    const cap = (ring: THREE.Vector3[] | undefined, facingUp: boolean) => {
      if (!ring) return;
      const center = ring.reduce((sum, corner) => sum.add(corner), new THREE.Vector3());
      center.divideScalar(ring.length);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (!a || !b) continue;
        if (facingUp) corners.push(center, b, a);
        else corners.push(center, a, b);
      }
    };
    cap(ringsOf[0], false);
    cap(ringsOf[SHELL_LEVELS - 1], true);
    return this.#withRings(corners);
  }

  /** A long triangular prism, its point `depth` in from the bark, its mouth outside the trunk. */
  #wedge(): THREE.BufferGeometry {
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(up, this.#cut).normalize();
    const point = this.#base
      .clone()
      .addScaledVector(this.#cut, this.surface - this.depth)
      .setY(this.#base.y + this.#height);
    const reach = this.depth + this.surface + 0.5;
    const top = point
      .clone()
      .addScaledVector(this.#cut, reach)
      .addScaledVector(up, reach * Math.tan((UPPER_SLOPE * Math.PI) / 180));
    const bottom = point
      .clone()
      .addScaledVector(this.#cut, reach)
      .addScaledVector(up, -reach * Math.tan((LOWER_SLOPE * Math.PI) / 180));
    const width = this.surface * 3 + 1;
    const end = (corner: THREE.Vector3, side: number) =>
      corner.clone().addScaledVector(across, side * width);
    const [p0, p1, p2] = [point, top, bottom].map((corner) => end(corner, -1));
    const [q0, q1, q2] = [point, top, bottom].map((corner) => end(corner, 1));
    if (!p0 || !p1 || !p2 || !q0 || !q1 || !q2) throw new Error('Wedge corners missing');
    // Outward-facing triangles of a closed prism.
    const triangles = [
      [p0, p2, p1],
      [q0, q1, q2],
      [p0, p1, q1],
      [p0, q1, q0],
      [p1, p2, q2],
      [p1, q2, q1],
      [p2, p0, q0],
      [p2, q0, q2],
    ];
    return this.#withRings(triangles.flat());
  }

  /** A closed box filling everything below the break (the notch's point). */
  #below(): THREE.BufferGeometry {
    const size = this.surface * 6 + 2;
    const top = this.#base.y + this.#height;
    const bottom = this.#base.y - 1;
    const box = new THREE.BoxGeometry(size, top - bottom, size);
    box.translate(this.#base.x, (top + bottom) / 2, this.#base.z);
    const flat = box.toNonIndexed();
    box.dispose();
    const position = flat.getAttribute('position');
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i++) {
      corners.push(new THREE.Vector3().fromBufferAttribute(position, i));
    }
    flat.dispose();
    return this.#withRings(corners);
  }

  /** Geometry from triangle corners, with flat normals and uvs that put rings round the trunk. */
  #withRings(corners: THREE.Vector3[]): THREE.BufferGeometry {
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(up, this.#cut).normalize();
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const uv = corners.flatMap((corner) => {
      const offset = corner.clone().sub(this.#base);
      return [
        0.5 + offset.dot(across) / (2 * this.surface),
        0.5 + offset.dot(this.#cut) / (2 * this.surface),
      ];
    });
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
}

function isBark(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((one) => /bark/i.test(one.name));
}

/** The mesh's geometry with just the attributes CSG needs (a blank uv if it had none). */
function barkBrush(mesh: THREE.Mesh): Brush {
  const source = mesh.geometry;
  const geometry = new THREE.BufferGeometry();
  const position = source.getAttribute('position');
  geometry.setAttribute('position', position.clone());
  const normal = source.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normal) geometry.setAttribute('normal', normal.clone());
  const color = source.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (color) geometry.setAttribute('color', color.clone());
  const uv = source.getAttribute('uv') as THREE.BufferAttribute | undefined;
  geometry.setAttribute(
    'uv',
    uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2),
  );
  const index = source.getIndex();
  if (index) geometry.setIndex(index.clone());
  if (!normal) geometry.computeVertexNormals();
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return new Brush(geometry, material);
}

/**
 * The triangles of a CSG result drawn with `material`, as plain geometry: no groups, no index. Feeding
 * grouped results back into the evaluator trips it up, and the hidden shell faces are dropped.
 */
function plain(result: Brush, material: THREE.Material): THREE.BufferGeometry {
  const source = result.geometry;
  const materials = Array.isArray(result.material) ? result.material : [result.material];
  const index = source.getIndex();
  const total = index ? index.count : source.getAttribute('position').count;
  const groups =
    source.groups.length > 0 ? source.groups : [{ start: 0, count: total, materialIndex: 0 }];
  const corners: number[] = [];
  for (const group of groups) {
    if (materials[group.materialIndex ?? 0] !== material) continue;
    const end = Math.min(group.start + group.count, total);
    for (let i = group.start; i < end; i++) corners.push(index ? index.getX(i) : i);
  }
  return pick(source, corners);
}

/** Splits plain triangles into those below and above height `y` (by each triangle's middle). */
function splitAt(
  geometry: THREE.BufferGeometry,
  y: number,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const position = geometry.getAttribute('position');
  const lower: number[] = [];
  const upper: number[] = [];
  for (let i = 0; i + 2 < position.count; i += 3) {
    const middle = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    (middle < y ? lower : upper).push(i, i + 1, i + 2);
  }
  return [pick(geometry, lower), pick(geometry, upper)];
}

/** New geometry holding the listed vertices of `source`, in order (every three make a triangle). */
function pick(source: THREE.BufferGeometry, vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const { itemSize } = attribute;
    const array = new Float32Array(vertices.length * itemSize);
    vertices.forEach((vertex, i) => {
      array[i * itemSize] = attribute.getX(vertex);
      if (itemSize > 1) array[i * itemSize + 1] = attribute.getY(vertex);
      if (itemSize > 2) array[i * itemSize + 2] = attribute.getZ(vertex);
      if (itemSize > 3) array[i * itemSize + 3] = attribute.getW(vertex);
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  return geometry;
}
