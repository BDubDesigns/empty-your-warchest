import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundMesh, wornGround } from '../../app/ground';
import { loadModel } from '../../app/models';
import { scatter, type Placement } from '../../app/scatter';
import { textureBytes } from '../../bench/logic/stats';
import { Rng } from '../../core';
import type { GraphicsTier } from '../../core/graphics';
import {
  layoutCastle,
  middleOf,
  segmentDistance,
  type Castle,
  type CastleLayout,
  type CastlePart,
  type CastlePartKind,
  type CastlePiece,
  type LaidWall,
  type Vec2,
} from '../../data';
import {
  battlement,
  gatehouseBlock,
  merlon as merlonShape,
  solidTower,
  towerWedge,
  wallSlice,
  type Shape,
} from './chunks';
import { archPath, bell, block, slab, stepsShape, tidy, type Skin } from './stonework';

// The castle in three.js, built from its layout (src/data/castle.ts through castleLayout.ts): the
// kit's pieces where the layout puts them, and the stonework the kits don't have (walls, towers,
// the gatehouse, merlons, stairs) drawn in code in the kits' own materials. What never comes apart
// (the keep's lower storeys, the stairs, the props) is merged into one mesh per material. What can
// (the layout's parts: wall and tower chunks, the gatehouse's and the keep's blocks, battlements,
// merlons, roofs, the gate, the bell) is drawn on its own, the parts of a shape as instances of
// it, so the siege can hide any one and put a physics body in its place. The scene round it (sky, haze, sun, meadow, road, trees) is the
// siege's look. Only looks: the layout says where everything is, and this draws it there.

/** A merged mesh's worth: the shapes in one material. */
class Batch {
  readonly #parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry): void {
    const list = this.#parts.get(material) ?? [];
    list.push(geometry);
    this.#parts.set(material, list);
  }

  /** One mesh per material, casting and taking shadows. */
  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [material, geometries] of this.#parts) {
      // (null if their attributes differ, whatever its types say.)
      const merged = mergeGeometries(geometries) as THREE.BufferGeometry | null;
      if (!merged) throw new Error(`Castle pieces in ${material.name} don't merge`);
      for (const geometry of geometries) geometry.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** One mesh of a kit piece: its shape, material and place in the piece. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

/**
 * How a part that can come apart is drawn: its own group of meshes, or one instance (`index`) in
 * each of its kind's instanced meshes. The siege hides it here when it turns it into a body.
 */
export type CastlePartLook =
  | { kind: CastlePartKind; object: THREE.Object3D }
  | { kind: CastlePartKind; instances: THREE.InstancedMesh[]; index: number };

export interface CastleScene {
  scene: THREE.Scene;
  layout: CastleLayout;
  /** How each of the layout's parts is drawn, by its id. */
  parts: Map<string, CastlePartLook>;
  /** Each spear rack the siege may use, drawn on its own (by its prop id), so it can hide it. */
  racks: Map<string, THREE.Object3D>;
  /** The castle's merged meshes (not the ground or trees). */
  castle: THREE.Group;
  /**
   * Rough GPU memory (MB) for the scene's textures (with mipmaps, and the shadow map) and its
   * geometry; the castle's own share apart. Call it once the textures have loaded.
   */
  measure(): {
    textureMB: number;
    castleTextureMB: number;
    geometryMB: number;
    textures: number;
    castleTriangles: number;
    castleMeshes: number;
  };
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Things fixed to the stonework, drawn without shadows. */
const decorKinds = new Set<CastlePartKind>(['slit', 'doorway', 'vine']);

/** A shape's meshes merged by material: one instanced mesh (one draw) per material. */
function byMaterial(shape: Shape): Shape {
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const { material, geometry } of shape) {
    groups.set(material, [...(groups.get(material) ?? []), geometry]);
  }
  return [...groups].map(([material, geometries]) => {
    const merged = mergeGeometries(geometries) as THREE.BufferGeometry | null;
    if (!merged) throw new Error(`A castle shape's pieces in ${material.name} don't merge`);
    for (const geometry of geometries) geometry.dispose();
    return { material, geometry: merged };
  });
}

/**
 * The parts drawn as instances of their shape; the rest (gates, roofs, the bell, a building's
 * blocks) on their own.
 */
const instancedKinds = new Set<CastlePartKind>([
  'wallChunk',
  'battlement',
  'towerChunk',
  'gatehouseChunk',
  'merlon',
  'towerRoof',
  'slit',
  'doorway',
  'vine',
]);
const DEG = Math.PI / 180;
/** How far inside a building's faces its dark inside starts (m): what its windows look into. */
const INSIDE_INSET = 0.35;

const textureKeys = ['map', 'alphaMap'] as const;

function texturesOf(material: THREE.Material): THREE.Texture[] {
  const record = material as unknown as Record<string, unknown>;
  return textureKeys
    .map((key) => record[key])
    .filter((value): value is THREE.Texture => value instanceof THREE.Texture);
}

/** Turned `turn` radians about y, at `at`. */
function placed(at: readonly [number, number, number], turn: number, scale?: THREE.Vector3) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(at[0], at[1], at[2]),
    new THREE.Quaternion().setFromAxisAngle(UP, turn),
    scale ?? new THREE.Vector3(1, 1, 1),
  );
}

/** A box's place on a wall: `distance` along it, `sideways` out of the castle, `y` up. */
function onWall(wall: LaidWall, distance: number, sideways: number, y: number): THREE.Matrix4 {
  const x = wall.origin[0] + wall.dir[0] * distance + wall.out[0] * sideways;
  const z = wall.origin[1] + wall.dir[1] * distance + wall.out[1] * sideways;
  // Local z out of the castle, local x along the wall.
  return placed([x, y, z], Math.atan2(wall.out[0], wall.out[1]));
}

/** Builds the castle's scene at `tier`: its kit and textures loaded, then laid out and merged. */
export async function buildCastleScene(
  castle: Castle,
  tier: GraphicsTier,
  anisotropy: number,
): Promise<CastleScene> {
  const look = castle.tiers[tier];
  const manager = new THREE.LoadingManager();
  // The kit's images are named tex/<name>: each from the folder of the size this tier gives it.
  manager.setURLModifier((url) => {
    const match = /\/tex\/([^/?#]+)$/.exec(url);
    const image = match?.[1];
    if (!image) return url;
    const size = look.textureSizes[image] ?? look.textureSize;
    return url.replace(/\/tex\/[^/?#]+$/, `/tex-${String(size)}/${image}`);
  });
  const [kit, tree] = await Promise.all([
    new GLTFLoader(manager).loadAsync(castle.kit),
    loadModel(look.trees.model),
  ]);
  const layout = layoutCastle(castle);

  // The kit's materials, matte (Lambert, colour map only), by name.
  const materials = new Map<string, THREE.Material>();
  kit.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const source of [child.material as THREE.Material | THREE.Material[]].flat()) {
      if (materials.has(source.name) || !(source instanceof THREE.MeshStandardMaterial)) continue;
      if (source.map) source.map.anisotropy = anisotropy;
      materials.set(
        source.name,
        new THREE.MeshLambertMaterial({
          name: source.name,
          color: source.color,
          map: source.map,
          side: source.side,
          alphaTest: source.alphaTest,
        }),
      );
      source.dispose();
    }
  });
  const material = (name: string): THREE.Material => {
    const found = materials.get(name);
    if (!found) throw new Error(`The castle kit has no material "${name}"`);
    return found;
  };
  const colors = castle.colors;
  const own = {
    inside: new THREE.MeshBasicMaterial({
      name: 'inside',
      color: colors.inside,
      side: THREE.BackSide,
    }),
    dark: new THREE.MeshBasicMaterial({ name: 'dark', color: colors.inside }),
    bell: new THREE.MeshLambertMaterial({
      name: 'bell',
      color: colors.bell,
      side: THREE.DoubleSide,
    }),
  };
  const skins = Object.fromEntries(
    Object.entries(castle.skins).map(([key, skin]) => [
      key,
      { material: material(skin.material), skin: { tile: skin.tile, band: skin.band } },
    ]),
  ) as Record<keyof Castle['skins'], { material: THREE.Material; skin: Skin }>;

  // The kit's pieces, each as its parts.
  const pieces = new Map<string, Part[]>();
  const partsOf = (node: string): Part[] => {
    const cached = pieces.get(node);
    if (cached) return cached;
    const root = kit.scene.getObjectByName(node);
    if (!root) throw new Error(`The castle kit has no piece "${node}"`);
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const parts: Part[] = [];
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const list = child.material as THREE.Material | THREE.Material[];
      const source = Array.isArray(list) ? list[0] : list;
      if (!source) return;
      parts.push({
        geometry: tidy(child.geometry as THREE.BufferGeometry),
        material: material(source.name),
        matrix: inverse.clone().multiply(child.matrixWorld),
      });
    });
    pieces.set(node, parts);
    return parts;
  };
  /** A piece's bounds once turned (but not moved or scaled). */
  const boundsOf = (node: string, turn: number): THREE.Box3 => {
    const box = new THREE.Box3();
    const turning = placed([0, 0, 0], turn);
    for (const part of partsOf(node)) {
      part.geometry.computeBoundingBox();
      const own = part.geometry.boundingBox?.clone();
      if (own) box.union(own.applyMatrix4(turning.clone().multiply(part.matrix)));
    }
    return box;
  };

  const batch = new Batch();
  /** Where shapes go: the castle's one merged batch, or a part's own while it's being built. */
  let target = batch;
  const looks = new Map<string, CastlePartLook>();
  const partGroups = new THREE.Group();
  partGroups.name = 'parts';
  /** Builds a part that can come apart in its own meshes (see `CastlePart`). */
  const apart = (id: string, build: () => void) => {
    const part = layout.parts.find((candidate) => candidate.id === id);
    if (!part) throw new Error(`No castle part "${id}"`);
    const saved = target;
    target = new Batch();
    build();
    const group = target.build();
    target = saved;
    group.name = id;
    partGroups.add(group);
    looks.set(id, { kind: part.kind, object: group });
  };
  const put = (node: string, matrix: THREE.Matrix4) => {
    for (const part of partsOf(node)) {
      target.add(
        part.material,
        part.geometry.clone().applyMatrix4(matrix.clone().multiply(part.matrix)),
      );
    }
  };
  /** A data piece (with its own turn and offset) at `at`, turned `turn` radians. */
  const putPiece = (piece: CastlePiece, at: readonly [number, number, number], turn: number) => {
    const angle = turn + piece.turn * DEG;
    const offset = new THREE.Vector3(...piece.offset).applyAxisAngle(UP, angle);
    put(piece.node, placed([at[0] + offset.x, at[1] + offset.y, at[2] + offset.z], angle));
  };
  const stone = (key: keyof Castle['skins'], geometry: THREE.BufferGeometry) => {
    target.add(skins[key].material, geometry);
  };
  const skinOf = (key: keyof Castle['skins']) => skins[key].skin;

  const { wall: w, details } = castle;
  const { corbel: CORBEL, cap: CAP } = details;
  const [cx, cz] = middleOf(castle);

  // Curtain walls: the stretches run into the towers are merged (they never come apart), and a
  // solid wall's whole length; the rest is chunks, drawn below as instances.
  const stoneSkins = { skins };
  const merge = (shape: Shape) => {
    for (const { material, geometry } of shape) target.add(material, geometry);
  };
  for (const wall of layout.walls) {
    const solid = castle.walls.find((candidate) => candidate.id === wall.id)?.solid ?? false;
    const stretches: [number, number][] = solid
      ? [[wall.body[0], wall.body[1]]]
      : [
          [wall.body[0], wall.clear[0]],
          [wall.clear[1], wall.body[1]],
        ];
    const parapetAt = w.thickness / 2 - w.parapet.thickness / 2;
    for (const [a, b] of stretches) {
      if (b - a <= 0) continue;
      merge(wallSlice(castle, stoneSkins, b - a, 0, w.height, onWall(wall, (a + b) / 2, 0, 0)));
      // The parapet into the towers (a battlement stands on each column between them).
      if (!solid) {
        stone(
          'wall',
          block(
            [b - a, w.parapet.height, w.parapet.thickness],
            onWall(wall, (a + b) / 2, parapetAt, w.height),
            skinOf('wall'),
          ),
        );
      }
    }
  }

  // Towers and the gatehouse.
  for (const tower of castle.towers) {
    const [x, z] = tower.at;
    const h = tower.height;
    if (tower.shape === 'round') {
      if (tower.solid) {
        merge(solidTower(castle, stoneSkins, x, z, tower.size, h, tower.top));
      }
    } else {
      const sx = tower.size;
      const sz = tower.depth ?? tower.size;
      const tower_ = skinOf('tower');
      if (tower.gate && !tower.solid) {
        // A gatehouse that comes apart is all blocks (drawn below, as instances): only the
        // passage's floor is left.
        stone(
          'courtyard',
          block([tower.gate.width, 0.03, sz * 2], placed([x, 0, z], 0), skinOf('courtyard')),
        );
        continue;
      }
      if (tower.gate) {
        const { width, height } = tower.gate;
        const face = new THREE.Shape();
        face.moveTo(-sx, 0);
        face.lineTo(sx, 0);
        face.lineTo(sx, h);
        face.lineTo(-sx, h);
        face.lineTo(-sx, 0);
        const hole = new THREE.Path();
        archPath(hole, 0, width, height);
        face.holes.push(hole);
        stone('tower', slab(face, sz * 2, placed([x, 0, z - sz], 0), tower_));
        // A ring of trim stone round the arch, front and back, standing proud of the face.
        const trimWidth = details.archTrim.width;
        for (const [faceZ, turn] of [
          [z + sz, 0],
          [z - sz, Math.PI],
        ] as const) {
          const ringShape = new THREE.Shape();
          archPath(ringShape, 0, width + trimWidth * 2, height + trimWidth);
          const inner = new THREE.Path();
          archPath(inner, 0, width, height);
          ringShape.holes.push(inner);
          stone(
            'trim',
            slab(
              ringShape,
              details.archTrim.proud,
              placed([x, 0, faceZ], turn),
              skinOf('trim'),
              14,
            ),
          );
        }
        stone('courtyard', block([width, 0.03, sz * 2], placed([x, 0, z], 0), skinOf('courtyard')));
        // The foot, either side of the gate.
        const footWidth = sx - width / 2 + w.plinth.out;
        for (const sign of [-1, 1]) {
          const mid = x + sign * (width / 2 + footWidth / 2);
          stone(
            'tower',
            block(
              [footWidth, w.plinth.height, sz * 2 + w.plinth.out * 2],
              placed([mid, 0, z], 0),
              tower_,
            ),
          );
          stone(
            'trim',
            block(
              [footWidth, CAP.height * 1.5, sz * 2 + w.plinth.out * 2 + CAP.out],
              placed([mid, w.plinth.height, z], 0),
              skinOf('trim'),
            ),
          );
        }
      } else {
        stone('tower', block([sx * 2, h, sz * 2], placed([x, 0, z], 0), tower_));
        stone(
          'tower',
          block(
            [sx * 2 + w.plinth.out * 2, w.plinth.height, sz * 2 + w.plinth.out * 2],
            placed([x, 0, z], 0),
            tower_,
          ),
        );
      }
      stone(
        'trim',
        block(
          [sx * 2 + w.course.out * 2, w.course.height, sz * 2 + w.course.out * 2],
          placed([x, w.height - w.course.height, z], 0),
          skinOf('trim'),
        ),
      );
      // The top: corbels round it carrying a parapet that stands out over them, merlons on that.
      stone('walk', block([sx * 2, 0.04, sz * 2], placed([x, h, z], 0), skinOf('walk')));
      const edges: { along: number; half: number; turn: number; out: Vec2 }[] = [
        { along: sx * 2, half: sz, turn: 0, out: [0, 1] },
        { along: sx * 2, half: sz, turn: Math.PI, out: [0, -1] },
        { along: sz * 2, half: sx, turn: Math.PI / 2, out: [1, 0] },
        { along: sz * 2, half: sx, turn: -Math.PI / 2, out: [-1, 0] },
      ];
      for (const edge of edges) {
        const length = edge.along + CORBEL.out * 2;
        const at = (inset: number): [number, number] => [
          x + edge.out[0] * (edge.half + CORBEL.out - inset),
          z + edge.out[1] * (edge.half + CORBEL.out - inset),
        ];
        const [kx, kz] = at(CORBEL.out / 2);
        stone(
          'trim',
          block(
            [length, CORBEL.height, CORBEL.out],
            placed([kx, h - CORBEL.height, kz], edge.turn),
            skinOf('trim'),
          ),
        );
        const [px, pz] = at(w.parapet.thickness / 2);
        stone(
          'tower',
          block(
            [length, w.parapet.height, w.parapet.thickness],
            placed([px, h, pz], edge.turn),
            tower_,
          ),
        );
      }
    }
  }

  // Buildings.
  for (const [index, building] of layout.buildings.entries()) {
    const data = castle.buildings[index];
    if (!data) continue;
    // What never comes apart: its storeys up to `solidHeight` (all of it, without blocks).
    const solid = building.solidHeight;
    const whole = solid >= building.height;
    const blocks = layout.parts.filter(
      (part) => part.kind === 'storeyChunk' && part.owner === building.id,
    );
    for (const piece of building.pieces) {
      if (piece.storey * castle.storey < solid) put(piece.node, placed(piece.at, piece.turn));
    }
    const width = building.max[0] - building.min[0];
    const depth = building.max[1] - building.min[1];
    const mid: [number, number] = [
      (building.min[0] + building.max[0]) / 2,
      (building.min[1] + building.max[1]) / 2,
    ];
    // Dark inside, seen through the open windows (and from above, once its top is gone).
    target.add(
      own.inside,
      block(
        [width - INSIDE_INSET * 2, solid, depth - INSIDE_INSET * 2],
        placed([mid[0], 0, mid[1]], 0),
        { tile: 1 },
      ),
    );
    if (!whole) {
      target.add(
        own.dark,
        block([width - 0.1, 0.04, depth - 0.1], placed([mid[0], solid - 0.04, mid[1]], 0), {
          tile: 1,
        }),
      );
    }
    const corners = [
      building.min,
      building.max,
      [building.min[0], building.max[1]],
      [building.max[0], building.min[1]],
    ] as Vec2[];
    for (const [qx, qz] of corners) {
      stone(
        'tower',
        block(
          [castle.quoin, whole ? solid + 0.12 : solid, castle.quoin],
          placed([qx, 0, qz], 0),
          skinOf('tower'),
        ),
      );
    }
    // Its storeys that come apart, block by block: each with its stretch of the walls, the dark
    // inside it (showing where a neighbour's gone), and its corner's stones.
    for (const part of blocks) {
      apart(part.id, () => {
        const [bx, by, bz] = part.at;
        const [lengthX, tall, lengthZ] = part.size;
        const x0 = bx - lengthX / 2;
        const x1 = bx + lengthX / 2;
        const z0 = bz - lengthZ / 2;
        const z1 = bz + lengthZ / 2;
        const eps = 1e-6;
        for (const piece of building.pieces) {
          const [px, pz] = piece.middle;
          if (Math.abs(piece.storey * castle.storey - by) > eps) continue;
          if (px < x0 - eps || px > x1 + eps || pz < z0 - eps || pz > z1 + eps) continue;
          put(piece.node, placed(piece.at, piece.turn));
        }
        const inset = (at: number, face: number) => (Math.abs(at - face) < eps ? INSIDE_INSET : 0);
        const dx0 = x0 + inset(x0, building.min[0]);
        const dx1 = x1 - inset(x1, building.max[0]);
        const dz0 = z0 + inset(z0, building.min[1]);
        const dz1 = z1 - inset(z1, building.max[1]);
        target.add(
          own.dark,
          block([dx1 - dx0, tall, dz1 - dz0], placed([(dx0 + dx1) / 2, by, (dz0 + dz1) / 2], 0), {
            tile: 1,
          }),
        );
        const last = by + tall >= building.height - eps;
        for (const [qx, qz] of corners) {
          if (qx < x0 - eps || qx > x1 + eps || qz < z0 - eps || qz > z1 + eps) continue;
          stone(
            'tower',
            block(
              [castle.quoin, last ? tall + 0.12 : tall, castle.quoin],
              placed([qx, by, qz], 0),
              skinOf('tower'),
            ),
          );
        }
      });
    }
    // The roof (a part that can come apart), stretched to the walls (and its overhang), its pitch
    // kept across its span.
    apart(`${building.id}.roof.0`, () => {
      const roof = castle.roof;
      const turn = roof.piece.turn * DEG;
      const bounds = boundsOf(roof.piece.node, turn);
      const size = bounds.getSize(new THREE.Vector3());
      const scaleX = (width + roof.overhang * 2) / size.x;
      const scaleZ = (depth + roof.overhang * 2) / size.z;
      const span = Math.min(scaleX, scaleZ);
      const centre = bounds.getCenter(new THREE.Vector3());
      const roofScale = new THREE.Vector3(scaleX, span, scaleZ);
      const roofMatrix = new THREE.Matrix4()
        .makeTranslation(
          mid[0] - centre.x * scaleX,
          building.height + roof.piece.offset[1],
          mid[1] - centre.z * scaleZ,
        )
        .multiply(new THREE.Matrix4().makeScale(roofScale.x, roofScale.y, roofScale.z))
        .multiply(placed([0, 0, 0], turn));
      put(roof.piece.node, roofMatrix);
      // Gables close the roof's ends: across the shorter side.
      const ridgeAlongX = width >= depth;
      const gableBounds = boundsOf(roof.gable.node, 0);
      const gableWidth = gableBounds.max.x - gableBounds.min.x;
      const gableScale = (ridgeAlongX ? depth : width) / gableWidth;
      for (const sign of [-1, 1]) {
        const at: [number, number, number] = ridgeAlongX
          ? [
              sign > 0 ? building.max[0] : building.min[0],
              building.height + roof.gable.offset[1],
              mid[1],
            ]
          : [
              mid[0],
              building.height + roof.gable.offset[1],
              sign > 0 ? building.max[1] : building.min[1],
            ];
        const gableTurn = ridgeAlongX ? (sign * Math.PI) / 2 : sign > 0 ? 0 : Math.PI;
        put(
          roof.gable.node,
          placed(at, gableTurn, new THREE.Vector3(gableScale, gableScale, gableScale)),
        );
      }
    });
  }

  // Stairs up the inside of the walls.
  for (const stair of castle.stairs) {
    const wall = layout.walls.find((candidate) => candidate.id === stair.wall);
    if (!wall) continue;
    const sign = Math.sign(stair.run);
    const shape = stepsShape(Math.abs(stair.run), w.height, castle.stairRise);
    // Local x up the stair, y up, z (the extrusion) away from the wall or toward it.
    const xAxis = new THREE.Vector3(wall.dir[0] * sign, 0, wall.dir[1] * sign);
    const zAxis = new THREE.Vector3().crossVectors(xAxis, UP);
    const intoYard = zAxis.x * -wall.out[0] + zAxis.z * -wall.out[1] > 0;
    const lateral = intoYard ? -w.thickness / 2 : -(w.thickness / 2 + stair.width);
    const start = new THREE.Vector3(
      wall.origin[0] + wall.dir[0] * stair.start + wall.out[0] * lateral,
      0,
      wall.origin[1] + wall.dir[1] * stair.start + wall.out[1] * lateral,
    );
    const matrix = new THREE.Matrix4().makeBasis(xAxis, UP, zAxis).setPosition(start);
    stone('wall', slab(shape, stair.width, matrix, skinOf('wall'), 1));
  }

  // The alarm bell, on its timber frame: a part that can come apart.
  apart(`${castle.bell.id}.bell.0`, () => {
    const { at, turn, size, bell: across } = castle.bell;
    const frame = (dx: number, y: number) => {
      const v = new THREE.Vector3(dx, 0, 0).applyAxisAngle(UP, turn * DEG);
      return [at[0] + v.x, y, at[1] + v.z] as [number, number, number];
    };
    const [width, height] = size;
    for (const side of [-1, 1]) {
      stone(
        'timber',
        block(
          [0.26, height, 0.26],
          placed(frame((side * width) / 2, 0), turn * DEG),
          skinOf('timber'),
        ),
      );
      stone(
        'trim',
        block([0.6, 0.3, 0.6], placed(frame((side * width) / 2, 0), turn * DEG), skinOf('trim')),
      );
    }
    stone(
      'timber',
      block([width + 0.7, 0.3, 0.34], placed(frame(0, height), turn * DEG), skinOf('timber')),
    );
    // A little roof of two boards over the beam.
    for (const side of [-1, 1]) {
      const board = new THREE.Matrix4()
        .compose(
          new THREE.Vector3(...frame(0, height + 0.36)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(side * 0.5, turn * DEG, 0, 'YXZ')),
          new THREE.Vector3(1, 1, 1),
        )
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, side * 0.3));
      stone('timber', block([width + 0.8, 0.08, 0.66], board, skinOf('timber')));
    }
    const hanging = bell(across);
    hanging.translate(...frame(0, height - 0.02));
    target.add(own.bell, hanging);
  });

  // Props and dressing, and the ivy. The spear racks are each their own group: a siege keeps one
  // and breaks it.
  const racks = new Map<string, THREE.Object3D>();
  for (const prop of castle.props) {
    const rack = castle.anchors.spearRacks.includes(prop.id);
    const saved = target;
    if (rack) target = new Batch();
    for (const piece of castle.pieces[prop.piece] ?? []) {
      putPiece(piece, [prop.at[0], 0, prop.at[1]], prop.turn * DEG);
    }
    if (rack) {
      const group = target.build();
      group.name = prop.id;
      partGroups.add(group);
      racks.set(prop.id, group);
      target = saved;
    }
  }
  for (const dressing of castle.dressing) {
    for (const piece of castle.pieces[dressing.piece] ?? [])
      putPiece(piece, dressing.at, dressing.turn * DEG);
  }

  // The parts drawn as instances: chunks, battlements, merlons, tower roofs, and what's fixed to
  // them. Each shape is made once, from its first part; one draw per material draws them all.
  const roofPiece = castle.towerRoof.piece;
  const roofBounds = boundsOf(roofPiece.node, roofPiece.turn * DEG);
  const roofAcross = Math.max(
    roofBounds.max.x - roofBounds.min.x,
    roofBounds.max.z - roofBounds.min.z,
  );
  const roofCentre = roofBounds.getCenter(new THREE.Vector3());
  const kitShape = (node: string, turn = 0): Shape =>
    partsOf(node).map((part) => ({
      material: part.material,
      geometry: part.geometry.clone().applyMatrix4(placed([0, 0, 0], turn).multiply(part.matrix)),
    }));
  const shapeOf = (part: CastlePart): Shape => {
    switch (part.kind) {
      case 'wallChunk':
        return wallSlice(
          castle,
          stoneSkins,
          part.size[0],
          part.at[1],
          part.at[1] + part.size[1],
          new THREE.Matrix4(),
        );
      case 'battlement':
        return battlement(castle, stoneSkins, part.size[0]);
      case 'towerChunk':
        return towerWedge(castle, stoneSkins, part);
      case 'gatehouseChunk':
        return gatehouseBlock(castle, stoneSkins, part);
      case 'merlon':
        return merlonShape(castle, stoneSkins);
      case 'towerRoof':
        return kitShape(roofPiece.node, roofPiece.turn * DEG);
      case 'slit':
      case 'doorway':
        return [
          { material: own.dark, geometry: block(part.size, new THREE.Matrix4(), { tile: 1 }) },
        ];
      case 'vine':
        return kitShape(part.piece ?? '');
      default:
        throw new Error(`A castle ${part.kind} isn't drawn as instances`);
    }
  };
  /** Where an instance goes: its part's foot, turned; a tower roof scaled to its tower. */
  const matrixOf = (part: CastlePart): THREE.Matrix4 => {
    if (part.kind === 'towerRoof') {
      const scale = part.size[0] / roofAcross;
      return placed(
        [
          part.at[0] - roofCentre.x * scale,
          part.at[1] + roofPiece.offset[1],
          part.at[2] - roofCentre.z * scale,
        ],
        0,
        new THREE.Vector3(scale, scale, scale),
      );
    }
    // A wall's chunks and battlements share a shape, stretched along to each one's length.
    const made = madeFrom.get(part.shape);
    const stretch =
      (part.kind === 'wallChunk' || part.kind === 'battlement') && made
        ? new THREE.Vector3(part.size[0] / made.size[0], 1, 1)
        : undefined;
    return placed(part.at, part.turn, stretch);
  };
  /** The part each shape was made from. */
  const madeFrom = new Map<string, CastlePart>();
  const byShape = new Map<string, CastlePart[]>();
  for (const part of layout.parts) {
    if (!instancedKinds.has(part.kind)) continue;
    byShape.set(part.shape, [...(byShape.get(part.shape) ?? []), part]);
  }
  const each = new THREE.Matrix4();
  for (const [name, parts] of byShape) {
    const [first] = parts;
    if (!first) continue;
    // (Every shape stands on its own foot: its instances go where each part's foot is.)
    madeFrom.set(name, first);
    const meshes = byMaterial(shapeOf(first)).map(({ material, geometry }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
      mesh.name = name;
      // Slits, doorways and ivy are too thin to cast a shadow worth its draw.
      mesh.castShadow = !decorKinds.has(first.kind);
      mesh.receiveShadow = true;
      return mesh;
    });
    parts.forEach((part, index) => {
      const matrix = matrixOf(part);
      for (const mesh of meshes) mesh.setMatrixAt(index, each.copy(matrix));
      looks.set(part.id, { kind: part.kind, instances: meshes, index });
    });
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      partGroups.add(mesh);
    }
  }
  // Each gate's leaves, shut, set back in the passage, with iron straps across.
  for (const part of layout.parts.filter((candidate) => candidate.kind === 'gate')) {
    apart(part.id, () => {
      const [width, height, thickness] = part.size;
      const leaves = new THREE.Shape();
      archPath(leaves, 0, width, height);
      const [gx, , gz] = part.at;
      stone('timber', slab(leaves, thickness, placed([gx, 0, gz], part.turn), { tile: 1.5 }, 14));
      for (const y of details.straps) {
        if (y > height - width / 2) continue;
        target.add(
          own.dark,
          block([width - 0.1, 0.12, 0.06], placed([gx, y, gz + thickness + 0.03], part.turn), {
            tile: 1,
          }),
        );
      }
    });
  }

  const castleGroup = batch.build();
  castleGroup.name = 'castle';
  castleGroup.add(partGroups);
  // The kit's own copies are only patterns, now merged: free them.
  for (const parts of pieces.values()) for (const part of parts) part.geometry.dispose();
  kit.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
  });

  // The scene round it: the siege's sky, haze and light.
  const scene = new THREE.Scene();
  const view = castle.scene;
  scene.background = new THREE.Color(colors.sky);
  scene.fog = new THREE.Fog(colors.sky, view.fog[0], view.fog[1]);
  scene.add(new THREE.HemisphereLight(colors.skyLight, colors.groundLight, view.hemisphere));
  const sun = new THREE.DirectionalLight(colors.sun, view.sun.intensity);
  sun.position.set(cx + view.sun.from[0], view.sun.from[1], cz + view.sun.from[2]);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = look.shadows;
  const map = view.shadowMap;
  sun.shadow.mapSize.set(map.size, map.size);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = shadowCamera.bottom = -map.halfWidth;
  shadowCamera.right = shadowCamera.top = map.halfWidth;
  shadowCamera.near = 1;
  shadowCamera.far = map.far;
  sun.shadow.bias = map.bias;
  scene.add(sun, sun.target, castleGroup);

  const ground = groundMesh('meadowGrass', view.ground, view.ground);
  ground.position.set(cx, 0, cz);
  scene.add(ground);
  // The courtyard's floor, across the ring's bounds (the walls stand on its edges).
  const xs = layout.outline.map((point) => point[0]);
  const zs = layout.outline.map((point) => point[1]);
  const yardWidth = Math.max(...xs) - Math.min(...xs);
  const yardDepth = Math.max(...zs) - Math.min(...zs);
  const yard = groundMesh(view.yard, yardWidth, yardDepth);
  yard.position.set(
    (Math.max(...xs) + Math.min(...xs)) / 2,
    0.01,
    (Math.max(...zs) + Math.min(...zs)) / 2,
  );
  scene.add(yard);
  const grounds: THREE.Mesh[] = [ground, yard];
  const gate = castle.towers.find((tower) => tower.gate);
  if (gate) {
    const road = wornGround('troddenDirt', view.road.width, view.road.length, {
      cover: 0.6,
      round: true,
      seed: castle.vines.seed,
    });
    const depth = gate.depth ?? gate.size;
    road.position.set(gate.at[0], road.position.y, gate.at[1] + depth + view.road.length / 2 - 2);
    scene.add(road);
    grounds.push(road);
  }

  // Trees round it, clear of the castle and of each vantage point's view of it.
  const trees = view.trees;
  const treeRng = new Rng(trees.seed);
  const placements: Placement[] = [];
  let tries = 0;
  while (placements.length < look.trees.count && tries++ < look.trees.count * 50) {
    const angle = treeRng.range(0, Math.PI * 2);
    const distance = treeRng.range(trees.near, trees.far);
    const point: Vec2 = [cx + Math.sin(angle) * distance, cz + Math.cos(angle) * distance];
    const blocks = castle.vantages.some(
      (vantage) =>
        segmentDistance(point, [vantage.at[0], vantage.at[2]], [vantage.look[0], vantage.look[2]]) <
        14,
    );
    const onRoad =
      gate !== undefined && Math.abs(point[0] - gate.at[0]) < 12 && point[1] > gate.at[1];
    if (blocks || onRoad) continue;
    placements.push({
      x: point[0],
      z: point[1],
      height: treeRng.range(trees.height[0], trees.height[1]),
      turn: treeRng.range(0, Math.PI * 2),
    });
  }
  const treeGroup = scatter(tree, placements);
  treeGroup.traverse((child) => {
    child.castShadow = false;
  });
  scene.add(treeGroup);

  const ownedMaterials = new Set<THREE.Material>([...materials.values(), ...Object.values(own)]);
  const MB = 1024 * 1024;
  const round = (bytes: number) => Math.round((bytes / MB) * 10) / 10;
  return {
    scene,
    layout,
    parts: looks,
    racks,
    castle: castleGroup,
    measure() {
      const textures = new Set<THREE.Texture>();
      const castleTextures = new Set<THREE.Texture>();
      const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        geometries.add(child.geometry as THREE.BufferGeometry);
        for (const used of [child.material as THREE.Material | THREE.Material[]].flat()) {
          for (const texture of texturesOf(used)) {
            textures.add(texture);
            if (ownedMaterials.has(used)) castleTextures.add(texture);
          }
        }
      });
      const bytes = (set: Set<THREE.Texture>) => {
        let total = 0;
        for (const texture of set) {
          const image = texture.image as { width?: number; height?: number } | null;
          const mipmaps = texture.generateMipmaps && texture.minFilter !== THREE.LinearFilter;
          total += textureBytes(image?.width ?? 0, image?.height ?? 0, { mipmaps });
        }
        return total;
      };
      const shadow = look.shadows ? textureBytes(map.size, map.size, { mipmaps: false }) : 0;
      let geometryBytes = 0;
      for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes)) {
          if ('array' in attribute) geometryBytes += attribute.array.byteLength;
        }
        geometryBytes += geometry.index?.array.byteLength ?? 0;
      }
      let castleTriangles = 0;
      let castleMeshes = 0;
      castleGroup.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const copies = child instanceof THREE.InstancedMesh ? child.count : 1;
        castleTriangles +=
          (((child.geometry as THREE.BufferGeometry).index?.count ?? 0) / 3) * copies;
        castleMeshes++;
      });
      return {
        textureMB: round(bytes(textures) + shadow),
        castleTextureMB: round(bytes(castleTextures)),
        geometryMB: round(geometryBytes),
        textures: textures.size,
        castleTriangles,
        castleMeshes,
      };
    },
    dispose() {
      castleGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
        if (child instanceof THREE.InstancedMesh) child.dispose();
      });
      for (const used of ownedMaterials) {
        for (const texture of texturesOf(used)) texture.dispose();
        used.dispose();
      }
      // The grounds' and the trees' textures are shared with the game's screens: only their
      // own meshes and materials go (and a worn patch's own mask).
      for (const mesh of grounds) {
        mesh.geometry.dispose();
        const used = mesh.material as THREE.MeshLambertMaterial;
        used.alphaMap?.dispose();
        used.dispose();
      }
      treeGroup.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) {
          for (const used of [child.material as THREE.Material | THREE.Material[]].flat())
            used.dispose();
          child.dispose();
        }
      });
    },
  };
}
