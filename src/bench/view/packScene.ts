import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BlobShadows } from '../../app/blobShadows';
import { groundMesh } from '../../app/ground';
import { matte } from '../../app/models';
import { scatter } from '../../app/scatter';
import { benchRoles, type BenchData, type BenchPack, type BenchRole } from '../../data/bench';
import { buildGuard } from '../../stations/siege/three/figures';
import { makeTextures } from '../../stations/siege/three/looks';
import type { BodyPose } from '../logic/collapse';
import {
  layoutScene,
  type Placed,
  type PlacedCharacter,
  type SceneLayout,
  type Size,
} from '../logic/layout';
import { textureBytes } from '../logic/stats';
import type { RunSettings } from '../logic/plan';

// One stress-test scene in three.js: a pack's pieces loaded (fresh every run, so each run pays its
// own loading and uploading), measured, and put where the layout says. The renderer settings and
// lights are the siege's. A batched pack is drawn the cheap way: what stands merged into a mesh per
// material per building, what falls drawn as instances that follow their physics bodies.

/** A model laid along x, its outside facing +z, standing on y = 0 about its middle. */
interface Shape {
  model: THREE.Object3D;
  size: Size;
}

interface Character {
  model: THREE.Object3D;
  height: number;
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
}

interface Library {
  roles: Partial<Record<BenchRole, Shape>>;
  props: Shape[];
  trees: THREE.Object3D[];
  characters: Character[];
}

export interface SceneCharacter {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  placed: PlacedCharacter;
}

export interface PackScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  layout: SceneLayout;
  /** Puts falling piece `index` (in the layout's collapse order) where its body is. */
  setFalling(index: number, pose: BodyPose): void;
  /** Once a frame, after the falling pieces have been moved. */
  fallingMoved(): void;
  /** Once a frame, after the people have moved: their blob shadows follow them. */
  peopleMoved(): void;
  characters: SceneCharacter[];
  counts: {
    pieces: number;
    /** Meshes drawn for the pieces (a merged or instanced one counts once). */
    meshes: number;
    bodies: number;
    characters: number;
    trees: number;
  };
  /**
   * Rough GPU memory (MB) for the scene's textures (with mipmaps) and geometry. Call it once the
   * textures have loaded.
   */
  measure(): { textureMB: number; geometryMB: number; textureCount: number };
  /** Frees everything this scene made (not the ground's shared textures). */
  dispose(): void;
}

/** A shape's meshes, each with its place in the shape. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

function partsOf(shape: Shape): Part[] {
  const parts: Part[] = [];
  shape.model.updateMatrixWorld(true);
  shape.model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const list = child.material as THREE.Material | THREE.Material[];
    const material = Array.isArray(list) ? list[0] : list;
    if (!material) return;
    parts.push({
      geometry: child.geometry as THREE.BufferGeometry,
      material,
      matrix: child.matrixWorld.clone(),
    });
  });
  return parts;
}

/** Wraps `parts` turned by `turn` so they stand on y = 0 about their middle, and measures them. */
function shapeOf(parts: THREE.Object3D[], turn: number): Shape {
  const turned = new THREE.Group();
  turned.rotation.y = turn;
  turned.add(...parts);
  const model = new THREE.Group();
  model.add(turned);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  turned.position.set(-center.x, -box.min.y, -center.z);
  return { model, size: [size.x, size.y, size.z] };
}

function loaderFor(pack: BenchPack): GLTFLoader {
  const manager = new THREE.LoadingManager();
  const textures = pack.textures;
  if (textures) {
    manager.setURLModifier((url) =>
      url.includes(textures.from) ? url.replace(textures.from, textures.to) : url,
    );
  }
  return new GLTFLoader(manager);
}

function clip(gltf: GLTF, name: string, url: string): THREE.AnimationClip {
  const found = gltf.animations.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${url} has no "${name}" animation`);
  return found;
}

function named(gltf: GLTF, node: string, url: string): THREE.Object3D {
  const found = gltf.scene.getObjectByName(node);
  if (!found) throw new Error(`${url} has no node "${node}"`);
  return found;
}

async function modelLibrary(pack: BenchPack): Promise<Library> {
  const loader = loaderFor(pack);
  const files = new Map<string, Promise<GLTF>>();
  const load = (url: string) => {
    let file = files.get(url);
    if (!file) {
      file = loader.loadAsync(url);
      files.set(url, file);
    }
    return file;
  };
  const piecesUrl = pack.pieces ?? '';
  const [pieces, animations, trees, characters] = await Promise.all([
    load(piecesUrl),
    pack.animations ? load(pack.animations) : Promise.resolve(undefined),
    Promise.all(pack.trees.map((tree) => load(tree.url))),
    Promise.all(pack.characters.map((character) => load(character.url))),
  ]);
  matte(pieces.scene);
  const roles: Partial<Record<BenchRole, Shape>> = {};
  for (const role of benchRoles) {
    const piece = pack.roles[role];
    if (!piece) continue;
    roles[role] = shapeOf(
      piece.nodes.map((node) => named(pieces, node, piecesUrl).clone()),
      piece.turn,
    );
  }
  const props = pack.props.map((prop) =>
    shapeOf(
      prop.nodes.map((node) => named(pieces, node, piecesUrl).clone()),
      prop.turn,
    ),
  );
  return {
    roles,
    props,
    trees: pack.trees.map((tree, index) => {
      const file = trees[index];
      if (!file) throw new Error(`No tree ${tree.url}`);
      return tree.node ? named(file, tree.node, tree.url) : file.scene;
    }),
    characters: pack.characters.map((character, index) => {
      const file = characters[index];
      if (!file) throw new Error(`No character ${character.url}`);
      matte(file.scene);
      const clips = file.animations.length > 0 ? file : animations;
      if (!clips) throw new Error(`${character.url} has no animations`);
      file.scene.updateMatrixWorld(true);
      const height = new THREE.Box3().setFromObject(file.scene).getSize(new THREE.Vector3()).y;
      return {
        model: file.scene,
        height,
        idle: clip(clips, character.idle, character.url),
        walk: clip(clips, character.walk, character.url),
      };
    }),
  };
}

/** The boxes pack: the siege's block materials and box guards, as main ships them. */
async function boxLibrary(pack: BenchPack, data: BenchData): Promise<Library> {
  const looks = data.boxes;
  const textures = makeTextures();
  const lambert = (color: number, map?: THREE.Texture) =>
    new THREE.MeshLambertMaterial({ color, ...(map ? { map } : {}) });
  const stone = lambert(looks.stone, textures.stone[0]);
  const wood = lambert(looks.wood, textures.wood[0]);
  const roof = lambert(looks.roof);
  const box = (width: number, height: number, depth: number, material: THREE.Material): Shape =>
    shapeOf([new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)], 0);
  const cone = (): Shape => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT2, 1.6, 4), roof);
    mesh.rotation.y = Math.PI / 4;
    return shapeOf([mesh], 0);
  };
  const stoneWall = box(2, 3, looks.wallDepth, stone);
  const woodWall = box(2, 3, looks.wallDepth * 0.6, wood);
  const roles: Partial<Record<BenchRole, Shape>> = {
    wall: stoneWall,
    wallWindow: stoneWall,
    gate: woodWall,
    corner: box(0.8, 3, 0.8, stone),
    towerWall: stoneWall,
    towerRoof: cone(),
    houseWall: woodWall,
    houseWindow: woodWall,
    houseDoor: woodWall,
    houseRoof: cone(),
    chimney: box(0.6, 1.5, 0.6, stone),
    crate: box(1, 1, 1, wood),
  };
  const loader = loaderFor(pack);
  const trees = await Promise.all(pack.trees.map((tree) => loader.loadAsync(tree.url)));
  // The siege's guards are moved in code; here each gets a little clip on a mixer like the others'.
  const [width, height, depth] = looks.guard;
  const guard = buildGuard([width, height, depth]).root;
  guard.name = 'guard';
  guard.position.y = height / 2;
  const holder = new THREE.Group();
  holder.add(guard);
  const sway = (name: string, seconds: number, bob: number, lean: number) => {
    const times = [0, seconds / 4, seconds / 2, (seconds * 3) / 4, seconds];
    const up = (share: number) => height / 2 + bob * Math.abs(Math.sin(share * Math.PI * 2));
    const turn = (share: number) =>
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        lean * Math.sin(share * Math.PI * 2),
      );
    return new THREE.AnimationClip(name, seconds, [
      new THREE.VectorKeyframeTrack(
        'guard.position',
        times,
        times.flatMap((time) => [0, up(time / seconds), 0]),
      ),
      new THREE.QuaternionKeyframeTrack(
        'guard.quaternion',
        times,
        times.flatMap((time) => turn(time / seconds).toArray()),
      ),
    ]);
  };
  return {
    roles,
    props: [],
    trees: trees.map((tree) => tree.scene),
    characters: [
      {
        model: holder,
        height,
        idle: sway('idle', 2.4, 0.01, 0.02),
        walk: sway('walk', 0.9, 0.06, 0.08),
      },
    ],
  };
}

/** Lambert copies of every standard material, with only their colour maps: the siege's look. */
function makeMatte(root: THREE.Object3D): void {
  const copies = new Map<THREE.Material, THREE.Material>();
  const swap = (material: THREE.Material): THREE.Material => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;
    let copy = copies.get(material);
    if (!copy) {
      copy = new THREE.MeshLambertMaterial({
        color: material.color,
        map: material.map,
        side: material.side,
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
      });
      copies.set(material, copy);
    }
    return copy;
  };
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.Material | THREE.Material[];
    child.material = Array.isArray(material) ? material.map(swap) : swap(material);
  });
}

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'lightMap',
] as const;

function texturesOf(material: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  const record = material as unknown as Record<string, unknown>;
  for (const key of TEXTURE_KEYS) {
    const value = record[key];
    if (value instanceof THREE.Texture) found.push(value as THREE.Texture);
  }
  return found;
}

function imageSize(texture: THREE.Texture): [number, number] {
  const image = texture.image as { width?: number; height?: number } | null;
  return [image?.width ?? 0, image?.height ?? 0];
}

/** Builds `run`'s scene for `pack`. */
export async function buildPackScene(
  pack: BenchPack,
  data: BenchData,
  run: RunSettings,
): Promise<PackScene> {
  const library = pack.kind === 'boxes' ? await boxLibrary(pack, data) : await modelLibrary(pack);
  const { layout: places, renderer: look } = data;
  const sizes = {
    roles: Object.fromEntries(
      Object.entries(library.roles).map(([role, shape]) => [role, shape.size]),
    ) as Partial<Record<BenchRole, Size>>,
    props: library.props.map((prop) => prop.size),
  };
  const layout = layoutScene({
    pack,
    layout: places,
    sizes,
    bodies: data.collapse.bodies,
    copies: run.scale,
    treeModels: library.trees.length,
    characterModels: library.characters.length,
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(look.sky);
  scene.fog = new THREE.Fog(look.sky, look.fogNear, look.fogFar);
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x4a5a32, look.hemisphereIntensity));
  const sun = new THREE.DirectionalLight(0xfff0d8, look.sunIntensity);
  const [fx, fz] = places.fort.at;
  sun.position.set(fx + look.sunFrom[0], look.sunFrom[1], fz + look.sunFrom[2]);
  sun.target.position.set(fx, 0, fz);
  sun.castShadow = run.shadows === 'on';
  sun.shadow.mapSize.set(look.shadowMapSize, look.shadowMapSize);
  const shadow = sun.shadow.camera;
  shadow.left = -look.shadowHalfWidth;
  shadow.right = look.shadowHalfWidth;
  shadow.top = look.shadowHalfHeight;
  shadow.bottom = -look.shadowHalfHeight;
  shadow.near = 1;
  shadow.far = look.shadowFar;
  sun.shadow.bias = look.shadowBias;
  scene.add(sun, sun.target);

  const ground = groundMesh('meadowGrass', places.ground.size, places.ground.size);
  ground.position.set(places.ground.at[0], 0, places.ground.at[1]);
  scene.add(ground);

  const pieces = new THREE.Group();
  const shapeFor = (placed: Placed): Shape => {
    const shape =
      'role' in placed.piece ? library.roles[placed.piece.role] : library.props[placed.piece.prop];
    if (!shape) throw new Error(`${pack.name} has nothing to draw for a piece`);
    return shape;
  };
  const up = new THREE.Vector3(0, 1, 0);
  /** A falling piece's matrix from its body's pose (about its middle). */
  const middleMatrix = (placed: Placed, pose: BodyPose, out: THREE.Matrix4) =>
    out
      .compose(
        new THREE.Vector3(pose.x, pose.y, pose.z),
        new THREE.Quaternion(pose.qx, pose.qy, pose.qz, pose.qw),
        new THREE.Vector3(placed.scale, placed.scale, placed.scale),
      )
      .multiply(new THREE.Matrix4().makeTranslation(0, -shapeFor(placed).size[1] / 2, 0));
  const restingPose = (placed: Placed): BodyPose => {
    const turn = new THREE.Quaternion().setFromAxisAngle(up, placed.turn);
    return {
      x: placed.x,
      y: placed.y + placed.size[1] / 2,
      z: placed.z,
      qx: turn.x,
      qy: turn.y,
      qz: turn.z,
      qw: turn.w,
    };
  };
  const fallingPlaced = layout.pieces.filter((placed) => placed.collapse);
  let setFalling: (index: number, pose: BodyPose) => void;
  let fallingMoved: () => void = () => undefined;
  if (pack.batched) {
    // Falling pieces: one instanced mesh per part of each shape, every copy of it an instance.
    const kinds = new Map<Shape, { parts: Part[]; meshes: THREE.InstancedMesh[]; count: number }>();
    const slots = fallingPlaced.map((placed) => {
      const shape = shapeFor(placed);
      let kind = kinds.get(shape);
      if (!kind) {
        kind = { parts: partsOf(shape), meshes: [], count: 0 };
        kinds.set(shape, kind);
      }
      return { kind, slot: kind.count++ };
    });
    for (const kind of kinds.values()) {
      kind.meshes = kind.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, kind.count);
        // The instances move about: don't cull by where they started.
        mesh.frustumCulled = false;
        pieces.add(mesh);
        return mesh;
      });
    }
    const dirty = new Set<THREE.InstancedMesh>();
    const middle = new THREE.Matrix4();
    const each = new THREE.Matrix4();
    setFalling = (index, pose) => {
      const placed = fallingPlaced[index];
      const at = slots[index];
      if (!placed || !at) return;
      middleMatrix(placed, pose, middle);
      at.kind.meshes.forEach((mesh, part) => {
        const matrix = at.kind.parts[part]?.matrix;
        if (!matrix) return;
        mesh.setMatrixAt(at.slot, each.multiplyMatrices(middle, matrix));
        dirty.add(mesh);
      });
    };
    fallingMoved = () => {
      for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
      dirty.clear();
    };
    // Standing pieces: merged into one mesh per material for each building of each copy.
    const buildings = new Map<string, Map<THREE.Material, THREE.BufferGeometry[]>>();
    const placing = new THREE.Matrix4();
    for (const placed of layout.pieces) {
      if (placed.collapse) continue;
      const key = `${String(placed.copy)}:${placed.group}`;
      let building = buildings.get(key);
      if (!building) {
        building = new Map();
        buildings.set(key, building);
      }
      placing.compose(
        new THREE.Vector3(placed.x, placed.y, placed.z),
        new THREE.Quaternion().setFromAxisAngle(up, placed.turn),
        new THREE.Vector3(placed.scale, placed.scale, placed.scale),
      );
      for (const part of partsOf(shapeFor(placed))) {
        const geometry = part.geometry.clone().applyMatrix4(placing.clone().multiply(part.matrix));
        const list = building.get(part.material) ?? [];
        list.push(geometry);
        building.set(part.material, list);
      }
    }
    for (const building of buildings.values()) {
      for (const [material, geometries] of building) {
        // (null if their attributes differ, whatever its types say.)
        const merged = mergeGeometries(geometries) as THREE.BufferGeometry | null;
        if (merged) {
          pieces.add(new THREE.Mesh(merged, material));
          for (const geometry of geometries) geometry.dispose();
        } else {
          // Parts that can't be merged (their attributes differ) are drawn one by one.
          for (const geometry of geometries) pieces.add(new THREE.Mesh(geometry, material));
        }
      }
    }
  } else {
    const pivots: THREE.Object3D[] = [];
    for (const placed of layout.pieces) {
      const shape = shapeFor(placed);
      const copy = shape.model.clone();
      if (placed.collapse) {
        // About its middle, so the physics body's pose is the pivot's.
        const pivot = new THREE.Group();
        copy.position.y = -shape.size[1] / 2;
        pivot.add(copy);
        pivot.scale.setScalar(placed.scale);
        pieces.add(pivot);
        pivots.push(pivot);
      } else {
        copy.scale.setScalar(placed.scale);
        copy.position.set(placed.x, placed.y, placed.z);
        copy.rotation.y = placed.turn;
        pieces.add(copy);
      }
    }
    setFalling = (index, pose) => {
      const pivot = pivots[index];
      if (!pivot) return;
      pivot.position.set(pose.x, pose.y, pose.z);
      pivot.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    };
  }
  fallingPlaced.forEach((placed, index) => {
    setFalling(index, restingPose(placed));
  });
  fallingMoved();
  let meshes = 0;
  pieces.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = child.receiveShadow = true;
      meshes++;
    }
  });
  scene.add(pieces);

  library.trees.forEach((tree, model) => {
    const placements = layout.trees.filter((placed) => placed.model === model);
    const trees = scatter(tree, placements);
    trees.traverse((child) => {
      child.castShadow = false;
    });
    scene.add(trees);
  });

  const people = new THREE.Group();
  const characters: SceneCharacter[] = layout.characters.map((placed) => {
    const character = library.characters[placed.model];
    if (!character) throw new Error(`${pack.name} has no character ${String(placed.model)}`);
    const model = SkeletonUtils.clone(character.model);
    model.scale.setScalar(places.characters.height / Math.max(character.height, 1e-6));
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const root = new THREE.Group();
    root.add(model);
    root.position.set(placed.from[0], 0, placed.from[1]);
    root.rotation.y = placed.turn;
    people.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(placed.walk ? character.walk : character.idle);
    action.play();
    mixer.setTime(placed.phase * action.getClip().duration);
    return { root, mixer, placed };
  });
  scene.add(people);

  // The cheapest shadows: a soft blob under each person, all one instanced mesh.
  let peopleMoved: () => void = () => undefined;
  if (run.shadows === 'blob' && characters.length > 0) {
    const blobs = new BlobShadows(characters.length, data.blob.opacity);
    const width = data.blob.width;
    peopleMoved = () => {
      characters.forEach((character, index) => {
        blobs.place(index, character.root.position.x, character.root.position.z, width);
      });
      blobs.commit();
    };
    peopleMoved();
    scene.add(blobs.mesh);
  }

  if (run.matte || pack.matte) makeMatte(scene);

  // What it holds, for the results and for freeing it after.
  const groundMaterial = ground.material;
  const holdings = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const instanced: THREE.InstancedMesh[] = [];
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      geometries.add(child.geometry as THREE.BufferGeometry);
      if (child instanceof THREE.InstancedMesh) instanced.push(child as THREE.InstancedMesh);
      const list = child.material as THREE.Material | THREE.Material[];
      for (const material of Array.isArray(list) ? list : [list]) {
        materials.add(material);
        for (const texture of texturesOf(material)) textures.add(texture);
      }
    });
    return { geometries, materials, textures, instanced };
  };
  const MB = 1024 * 1024;

  return {
    scene,
    sun,
    layout,
    setFalling,
    fallingMoved,
    peopleMoved,
    characters,
    counts: {
      pieces: layout.pieces.length,
      meshes,
      bodies: fallingPlaced.length,
      characters: characters.length,
      trees: layout.trees.length,
    },
    measure() {
      const { geometries, textures, instanced } = holdings();
      let textureTotal = 0;
      for (const texture of textures) {
        const [width, height] = imageSize(texture);
        const mipmaps = texture.generateMipmaps && texture.minFilter !== THREE.LinearFilter;
        textureTotal += textureBytes(width, height, { mipmaps });
      }
      if (run.shadows === 'on') {
        textureTotal += textureBytes(look.shadowMapSize, look.shadowMapSize, { mipmaps: false });
      }
      let geometryTotal = 0;
      for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes)) {
          if ('array' in attribute) geometryTotal += attribute.array.byteLength;
        }
        geometryTotal += geometry.index?.array.byteLength ?? 0;
      }
      for (const mesh of instanced) geometryTotal += mesh.instanceMatrix.array.byteLength;
      return {
        textureMB: Math.round((textureTotal / MB) * 10) / 10,
        geometryMB: Math.round((geometryTotal / MB) * 10) / 10,
        textureCount: textures.size,
      };
    },
    dispose() {
      const { geometries, materials, instanced } = holdings();
      for (const character of characters) character.mixer.stopAllAction();
      for (const mesh of instanced) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        // The ground's textures are shared with the game's own screens: leave them be.
        if (material !== groundMaterial) {
          for (const texture of texturesOf(material)) texture.dispose();
        }
        material.dispose();
      }
    },
  };
}
