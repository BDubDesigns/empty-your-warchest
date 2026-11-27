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
  segmentDistance,
  type Castle,
  type CastleLayout,
  type CastlePart,
  type CastlePartKind,
  type CastlePiece,
  type LaidWall,
  type Vec2,
} from '../../data';
import { archPath, bell, block, drum, slab, stepsShape, tidy, type Skin } from './stonework';

// The castle in three.js, built from its layout (src/data/castle.ts through castleLayout.ts): the
// kit's pieces where the layout puts them, and the stonework the kits don't have (walls, towers,
// the gatehouse, merlons, stairs) drawn in code in the kits' own materials. Everything that stands
// still is merged into one mesh per material, so the whole castle is about fifteen draws. The
// scene round it (sky, haze, sun, meadow, road, trees) is the siege's look. Only looks: the layout
// says where everything is, and this draws it there.

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
  /** The parts that can come apart, by their ids in `layout.parts` (wall sections aren't: they're merged). */
  parts: Map<string, CastlePartLook>;
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
const DEG = Math.PI / 180;

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
  const {
    towerSides: TOWER_SIDES,
    corbel: CORBEL,
    cap: CAP,
    slit: SLIT,
    doorway: DOORWAY,
  } = details;
  const [cx, cz] = layout.outline.reduce<Vec2>(
    (sum, point) => [
      sum[0] + point[0] / layout.outline.length,
      sum[1] + point[1] / layout.outline.length,
    ],
    [0, 0],
  );

  // Curtain walls.
  for (const wall of layout.walls) {
    const [b0, b1] = wall.body;
    const [c0, c1] = wall.clear;
    const bodyMid = (b0 + b1) / 2;
    const bodyLength = b1 - b0;
    const clearMid = (c0 + c1) / 2;
    const clearLength = c1 - c0;
    const parapetAt = w.thickness / 2 - w.parapet.thickness / 2;
    stone(
      'wall',
      block([bodyLength, w.height, w.thickness], onWall(wall, bodyMid, 0, 0), skinOf('wall')),
    );
    const footWidth = w.thickness + w.plinth.out * 2;
    stone(
      'wall',
      block([bodyLength, w.plinth.height, footWidth], onWall(wall, bodyMid, 0, 0), skinOf('wall')),
    );
    stone(
      'trim',
      block(
        [bodyLength, CAP.height * 1.5, footWidth + CAP.out],
        onWall(wall, bodyMid, 0, w.plinth.height),
        skinOf('trim'),
      ),
    );
    stone(
      'trim',
      block(
        [bodyLength, w.course.height, w.thickness + w.course.out * 2],
        onWall(wall, bodyMid, 0, w.height - w.course.height),
        skinOf('trim'),
      ),
    );
    stone(
      'walk',
      block(
        [clearLength, 0.04, wall.walk.width],
        onWall(wall, clearMid, -w.parapet.thickness / 2, w.height),
        skinOf('walk'),
      ),
    );
    stone(
      'wall',
      block(
        [bodyLength, w.parapet.height, w.parapet.thickness],
        onWall(wall, bodyMid, parapetAt, w.height),
        skinOf('wall'),
      ),
    );
  }

  // Towers and the gatehouse.
  for (const tower of castle.towers) {
    const [x, z] = tower.at;
    const h = tower.height;
    // Arrow slits look out, away from the courtyard; doorways open onto each wall's walk.
    const away = Math.atan2(x - cx, z - cz);
    const slitHeights = [w.height * 0.45, (w.height + h) / 2];
    const joined = layout.walls.filter((wall) => wall.from === tower.id || wall.to === tower.id);
    if (tower.shape === 'round') {
      const r = tower.size;
      const tower_ = skinOf('tower');
      stone('tower', drum(x, z, 0, r, h, TOWER_SIDES, tower_));
      stone('tower', drum(x, z, 0, r + w.plinth.out, w.plinth.height, TOWER_SIDES, tower_));
      stone(
        'trim',
        drum(
          x,
          z,
          w.plinth.height,
          r + w.plinth.out + CAP.out,
          CAP.height * 1.5,
          TOWER_SIDES,
          skinOf('trim'),
        ),
      );
      stone(
        'trim',
        drum(
          x,
          z,
          w.height - w.course.height,
          r + w.course.out,
          w.course.height,
          TOWER_SIDES,
          skinOf('trim'),
        ),
      );
      const rim = r + CORBEL.out;
      stone('trim', drum(x, z, h - CORBEL.height, rim, CORBEL.height, TOWER_SIDES, skinOf('trim')));
      if (tower.top === 'roof') {
        stone('tower', drum(x, z, h, rim, w.parapet.height, TOWER_SIDES, tower_));
      } else {
        const ring = { tile: tower_.tile };
        stone('tower', drum(x, z, h, rim, w.parapet.height, TOWER_SIDES, ring, { open: true }));
        stone(
          'tower',
          drum(x, z, h, rim - w.parapet.thickness, w.parapet.height, TOWER_SIDES, ring, {
            open: true,
            inside: true,
          }),
        );
        const top = new THREE.RingGeometry(rim - w.parapet.thickness, rim, TOWER_SIDES, 1);
        top.rotateX(-Math.PI / 2);
        top.translate(x, h + w.parapet.height, z);
        stone('cap', tidyTop(top, skinOf('cap')));
        const floor = new THREE.CircleGeometry(rim - w.parapet.thickness, TOWER_SIDES);
        floor.rotateX(-Math.PI / 2);
        floor.translate(x, h + 0.02, z);
        stone('walk', tidyTop(floor, skinOf('walk')));
      }
      for (const offset of [-0.7, 0.7]) {
        for (const y of slitHeights) {
          const angle = away + offset;
          const at: [number, number, number] = [
            x + Math.sin(angle) * (r - SLIT[2] / 2 + 0.04),
            y,
            z + Math.cos(angle) * (r - SLIT[2] / 2 + 0.04),
          ];
          target.add(own.dark, block(SLIT, placed(at, angle), { tile: 1 }));
        }
      }
      for (const wall of joined) {
        // Where the walk's middle line meets the tower's side.
        const toward = wall.from === tower.id ? wall.dir : ([-wall.dir[0], -wall.dir[1]] as Vec2);
        const lateral = -w.parapet.thickness / 2;
        const reach = Math.sqrt(Math.max(r * r - lateral * lateral, 0));
        const px = x + toward[0] * reach + wall.out[0] * lateral;
        const pz = z + toward[1] * reach + wall.out[1] * lateral;
        const angle = Math.atan2(px - x, pz - z);
        const at: [number, number, number] = [
          x + Math.sin(angle) * (r - 0.08),
          w.height,
          z + Math.cos(angle) * (r - 0.08),
        ];
        target.add(own.dark, block([DOORWAY[0], DOORWAY[1], 0.24], placed(at, angle), { tile: 1 }));
      }
    } else {
      const sx = tower.size;
      const sz = tower.depth ?? tower.size;
      const tower_ = skinOf('tower');
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
      // Arrow slits on the face that looks out, either side of the gate.
      const outFace =
        Math.abs(z - cz) >= Math.abs(x - cx)
          ? z > cz
            ? 0
            : Math.PI
          : x > cx
            ? Math.PI / 2
            : -Math.PI / 2;
      const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, outFace);
      const across = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, outFace);
      const depthOut = Math.abs(facing.z) > 0.5 ? sz : sx;
      const reach = (Math.abs(facing.z) > 0.5 ? sx : sz) * 0.55;
      for (const sideways of [-reach, reach]) {
        for (const y of slitHeights) {
          const at: [number, number, number] = [
            x + facing.x * (depthOut - SLIT[2] / 2 + 0.04) + across.x * sideways,
            y,
            z + facing.z * (depthOut - SLIT[2] / 2 + 0.04) + across.z * sideways,
          ];
          target.add(own.dark, block(SLIT, placed(at, outFace), { tile: 1 }));
        }
      }
      for (const wall of joined) {
        const toward = wall.from === tower.id ? wall.dir : ([-wall.dir[0], -wall.dir[1]] as Vec2);
        const faceDistance = Math.abs(toward[0]) > 0.5 ? sx : sz;
        const lateral = -w.parapet.thickness / 2;
        const at: [number, number, number] = [
          x + toward[0] * (faceDistance - 0.08) + wall.out[0] * lateral,
          w.height,
          z + toward[1] * (faceDistance - 0.08) + wall.out[1] * lateral,
        ];
        target.add(
          own.dark,
          block([DOORWAY[0], DOORWAY[1], 0.24], placed(at, Math.atan2(toward[0], toward[1])), {
            tile: 1,
          }),
        );
      }
    }
  }

  // Buildings.
  for (const [index, building] of layout.buildings.entries()) {
    const data = castle.buildings[index];
    if (!data) continue;
    for (const piece of building.pieces) put(piece.node, placed(piece.at, piece.turn));
    const width = building.max[0] - building.min[0];
    const depth = building.max[1] - building.min[1];
    const mid: [number, number] = [
      (building.min[0] + building.max[0]) / 2,
      (building.min[1] + building.max[1]) / 2,
    ];
    // Dark inside, seen through the open windows.
    target.add(
      own.inside,
      block([width - 0.7, building.height, depth - 0.7], placed([mid[0], 0, mid[1]], 0), {
        tile: 1,
      }),
    );
    for (const [qx, qz] of [
      building.min,
      building.max,
      [building.min[0], building.max[1]],
      [building.max[0], building.min[1]],
    ] as Vec2[]) {
      stone(
        'tower',
        block(
          [castle.quoin, building.height + 0.12, castle.quoin],
          placed([qx, 0, qz], 0),
          skinOf('tower'),
        ),
      );
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

  // Props and dressing, and the ivy.
  for (const prop of castle.props) {
    for (const piece of castle.pieces[prop.piece] ?? []) {
      putPiece(piece, [prop.at[0], 0, prop.at[1]], prop.turn * DEG);
    }
  }
  for (const dressing of castle.dressing) {
    for (const piece of castle.pieces[dressing.piece] ?? [])
      putPiece(piece, dressing.at, dressing.turn * DEG);
  }
  const rng = new Rng(castle.vines.seed);
  const vineFaces = [
    ...layout.walls.map((wall) => ({ kind: 'wall' as const, wall })),
    ...castle.towers
      .filter((tower) => tower.shape === 'round')
      .map((tower) => ({ kind: 'tower' as const, tower })),
  ];
  for (let i = 0; i < castle.vines.count; i++) {
    const face = vineFaces[Math.floor(rng.next() * vineFaces.length)];
    const pieceId = castle.vines.pieces[Math.floor(rng.next() * castle.vines.pieces.length)];
    const piece = pieceId ? castle.pieces[pieceId]?.[0] : undefined;
    if (!face || !piece) continue;
    const y = w.height - w.course.height - rng.range(0.1, 1.4);
    if (face.kind === 'wall') {
      const { wall } = face;
      const distance = rng.range(wall.clear[0] + 1, wall.clear[1] - 1);
      const matrix = onWall(wall, distance, w.thickness / 2 + 0.02, y);
      put(piece.node, matrix);
    } else {
      const { tower } = face;
      const angle = Math.atan2(tower.at[0] - cx, tower.at[1] - cz) + rng.range(-1.2, 1.2);
      const r = tower.size + 0.02;
      put(
        piece.node,
        placed(
          [
            tower.at[0] + Math.sin(angle) * r,
            y + rng.range(0, 2),
            tower.at[1] + Math.cos(angle) * r,
          ],
          angle,
        ),
      );
    }
  }

  // Merlons and tower roofs: each kind's copies as instances, one draw per material for them all.
  const instanced = (
    kind: CastlePartKind,
    shapes: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[],
    matrixOf: (part: CastlePart) => THREE.Matrix4,
  ) => {
    const parts = layout.parts.filter((part) => part.kind === kind);
    if (parts.length === 0) return;
    const meshes = shapes.map((shape) => {
      const mesh = new THREE.InstancedMesh(shape.geometry, shape.material, parts.length);
      mesh.name = kind;
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    });
    const each = new THREE.Matrix4();
    parts.forEach((part, index) => {
      const matrix = matrixOf(part);
      meshes.forEach((mesh, shape) => {
        const placing = shapes[shape];
        if (placing) mesh.setMatrixAt(index, each.multiplyMatrices(matrix, placing.matrix));
      });
      looks.set(part.id, { kind, instances: meshes, index });
    });
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      partGroups.add(mesh);
    }
  };
  const merlonSkin = skins.wall;
  const [mw, mh, mt] = [w.merlon.width, w.merlon.height, w.parapet.thickness];
  const identity = new THREE.Matrix4();
  instanced(
    'merlon',
    [
      {
        geometry: block([mw, mh, mt], identity, merlonSkin.skin),
        material: merlonSkin.material,
        matrix: identity,
      },
      {
        geometry: block(
          [mw + CAP.out * 2, CAP.height, mt + CAP.out * 2],
          new THREE.Matrix4().makeTranslation(0, mh, 0),
          skinOf('cap'),
        ),
        material: skins.cap.material,
        matrix: identity,
      },
    ],
    (part) => placed(part.at, part.turn),
  );
  // The tower roof piece, scaled to each tower (the part's size is the roof's width).
  {
    const roof = castle.towerRoof;
    const turn = roof.piece.turn * DEG;
    const bounds = boundsOf(roof.piece.node, turn);
    const across = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const centre = bounds.getCenter(new THREE.Vector3());
    instanced(
      'towerRoof',
      partsOf(roof.piece.node).map((part) => ({
        geometry: part.geometry.clone(),
        material: part.material,
        matrix: placed([0, 0, 0], turn).multiply(part.matrix),
      })),
      (part) => {
        const scale = part.size[0] / across;
        return placed(
          [
            part.at[0] - centre.x * scale,
            part.at[1] + roof.piece.offset[1],
            part.at[2] - centre.z * scale,
          ],
          0,
          new THREE.Vector3(scale, scale, scale),
        );
      },
    );
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

/** A flat, upward-facing shape's attributes tidied and its texture laid across x and z. */
function tidyTop(geometry: THREE.BufferGeometry, skin: Skin): THREE.BufferGeometry {
  const out = tidy(geometry);
  geometry.dispose();
  const position = out.getAttribute('position');
  const uv = out.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    uv.setXY(
      i,
      position.getX(i) / skin.tile,
      skin.band ? (skin.band[0] + skin.band[1]) / 2 : position.getZ(i) / skin.tile,
    );
  }
  return out;
}
