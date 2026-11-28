import * as THREE from 'three';
import { Rng } from '../../../core';

/**
 * The fletcher's bench, built in code (only looks): a plank bench, an iron tar pot of black,
 * glossy pine tar, a wooden bucket heaped with feathers, and the jig that holds a shaft and turns
 * it, with an index pointer at the top. Metres, y up, the bench top at y = 0, the camera in front
 * (+z). Every repeat (planks, feathers) is cheap: the bucket's feathers are one instanced draw.
 */

/** Where things are on the bench. */
export const BENCH = {
  /** The bench top: across, deep, its front edge, and how far down the ground is. */
  width: 1.3,
  depth: 0.5,
  front: 0.2,
  groundY: -0.76,
  pot: { x: -0.145, z: -0.03, radius: 0.066, height: 0.1 },
  bucket: { x: 0.15, z: -0.06, radius: 0.07, height: 0.12 },
  /** The jig: where the shaft's back end sits in it, and the way the shaft points from there. */
  jig: { nock: new THREE.Vector3(0, 0.07, 0.12), along: new THREE.Vector3(0, 0.2, -1) },
} as const;

/** The tar's surface, inside the pot. */
export const TAR_Y = BENCH.pot.height * 0.86;

export const COLORS = {
  sky: 0xbfdcec,
  ground: 0x6f8d4a,
  bench: 0x9a6a3c,
  benchDark: 0x7a5230,
  iron: 0x34353a,
  tar: 0x0f0c0a,
  bucket: 0xb07c46,
  hoop: 0x4a4a50,
  shaft: 0xdcb884,
  point: 0x3e2a1a,
  mark: 0xffd23a,
  band: 0x46d25a,
  pointer: 0xd83b2c,
  vane: 0xf2ede2,
  cock: 0xc8402c,
} as const;

/** A mixed bag of feathers, as birds drop them: the bucket's, and the duster's. */
export const FEATHER_COLORS = [0xf2ede2, 0xc8402c, 0x3f7fd0, 0xe9b824, 0x2b2622, 0xd8cdb8];

/**
 * A fletching vane: a flat feather `length` long along +y (from 0) and `height` out along +z,
 * high at the back and sweeping down to the front, as trimmed fletching is.
 */
export function vaneGeometry(length: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(height * 0.55, 0);
  shape.quadraticCurveTo(height * 1.1, length * 0.2, height * 0.85, length * 0.45);
  shape.quadraticCurveTo(height * 0.45, length * 0.85, 0, length);
  shape.lineTo(0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  // Its height from x out to +z.
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

/** A loose feather (for the bucket's heap): a vane and its quill, standing along +y. */
function looseFeather(length: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(length * 0.22, length * 0.4, 0.004, length);
  shape.quadraticCurveTo(-length * 0.2, length * 0.45, 0, 0);
  return new THREE.ShapeGeometry(shape, 5);
}

export interface BenchParts {
  group: THREE.Group;
  /** The bucket's heap of feathers (its count is the tier's). */
  heap: THREE.InstancedMesh;
  /** The jig's index pointer at the top, shown while the feathers go on. */
  pointer: THREE.Object3D;
}

/** Builds the bench, the pot, the bucket and the jig. */
export function buildBench(heapMost: number): BenchParts {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: COLORS.bench, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: COLORS.benchDark, flatShading: true });
  // The top: three planks, each a shade apart.
  const planks = 3;
  const plankDepth = BENCH.depth / planks;
  for (let index = 0; index < planks; index++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(BENCH.width, 0.045, plankDepth - 0.006),
      index % 2 === 0 ? wood : dark,
    );
    plank.position.set(0, -0.0225, BENCH.front - plankDepth * (index + 0.5));
    group.add(plank);
  }
  // Legs, and a rail along the front.
  const legHeight = -BENCH.groundY - 0.045;
  for (const x of [-0.56, 0.56]) {
    for (const z of [BENCH.front - 0.05, BENCH.front - BENCH.depth + 0.05]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, legHeight, 0.06), dark);
      leg.position.set(x, BENCH.groundY + legHeight / 2, z);
      group.add(leg);
    }
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(BENCH.width - 0.1, 0.06, 0.03), dark);
  rail.position.set(0, -0.09, BENCH.front - 0.03);
  group.add(rail);

  group.add(buildPot(), buildBucket());
  const heap = buildHeap(heapMost);
  group.add(heap);
  const { jig, pointer } = buildJig(wood, dark);
  group.add(jig);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true;
  });
  heap.castShadow = false;
  return { group, heap, pointer };
}

/** The tar pot: an iron pot, its rim rolled, full nearly to the top with glossy black tar. */
function buildPot(): THREE.Group {
  const { x, z, radius, height } = BENCH.pot;
  const pot = new THREE.Group();
  pot.position.set(x, 0, z);
  const iron = new THREE.MeshLambertMaterial({ color: COLORS.iron, flatShading: true });
  // A bellied profile, turned round.
  const profile = [
    new THREE.Vector2(radius * 0.7, 0),
    new THREE.Vector2(radius * 0.95, height * 0.2),
    new THREE.Vector2(radius * 1.02, height * 0.55),
    new THREE.Vector2(radius * 0.92, height * 0.92),
    new THREE.Vector2(radius * 0.98, height),
    new THREE.Vector2(radius * 0.9, height),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), iron);
  body.material.side = THREE.DoubleSide;
  const tar = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.93, 18),
    new THREE.MeshPhongMaterial({ color: COLORS.tar, shininess: 90, specular: 0x555555 }),
  );
  tar.rotation.x = -Math.PI / 2;
  tar.position.y = TAR_Y;
  // Tar dribbled down the side, from shafts lifted out.
  const drip = new THREE.MeshPhongMaterial({ color: COLORS.tar, shininess: 90 });
  for (const [angle, length] of [
    [0.4, 0.05],
    [1.1, 0.03],
    [2.6, 0.06],
  ] as const) {
    const run = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, length, 3, 6), drip);
    run.position.set(
      Math.sin(angle) * radius * 0.97,
      height - length / 2 - 0.01,
      Math.cos(angle) * radius * 0.97,
    );
    pot.add(run);
  }
  pot.add(body, tar);
  return pot;
}

/** The feather bucket: wooden staves bound with two iron hoops. */
function buildBucket(): THREE.Group {
  const { x, z, radius, height } = BENCH.bucket;
  const bucket = new THREE.Group();
  bucket.position.set(x, 0, z);
  const staves = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.86, height, 14, 1, true),
    new THREE.MeshLambertMaterial({
      color: COLORS.bucket,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  staves.position.y = height / 2;
  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.86, 14),
    new THREE.MeshLambertMaterial({ color: COLORS.benchDark }),
  );
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.004;
  const hoopMaterial = new THREE.MeshLambertMaterial({ color: COLORS.hoop });
  for (const share of [0.22, 0.8]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (0.88 + 0.12 * share) + 0.002, 0.004, 4, 20),
      hoopMaterial,
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = height * share;
    bucket.add(hoop);
  }
  bucket.add(staves, bottom);
  return bucket;
}

/** The bucket's heap: feathers of every colour poking up out of it at every angle. */
function buildHeap(most: number): THREE.InstancedMesh {
  const { x, z, radius, height } = BENCH.bucket;
  const heap = new THREE.InstancedMesh(
    looseFeather(0.11),
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    Math.max(most, 1),
  );
  const rng = new Rng(23);
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Euler();
  const color = new THREE.Color();
  for (let index = 0; index < most; index++) {
    const angle = rng.range(0, Math.PI * 2);
    const out = Math.sqrt(rng.range(0, 1)) * radius * 0.8;
    turn.set(rng.range(-0.9, 0.9), rng.range(0, Math.PI * 2), rng.range(-0.9, 0.9));
    matrix.compose(
      new THREE.Vector3(
        x + Math.cos(angle) * out,
        height * rng.range(0.55, 0.95),
        z + Math.sin(angle) * out,
      ),
      new THREE.Quaternion().setFromEuler(turn),
      new THREE.Vector3(1, rng.range(0.8, 1.25), 1),
    );
    heap.setMatrixAt(index, matrix);
    heap.setColorAt(index, color.setHex(FEATHER_COLORS[index % FEATHER_COLORS.length] ?? 0xffffff));
  }
  heap.count = most;
  return heap;
}

/**
 * The jig: two notched wooden blocks the shaft rests in, and the red index pointer over where its
 * back end turns, marking the top.
 */
function buildJig(
  wood: THREE.Material,
  dark: THREE.Material,
): { jig: THREE.Group; pointer: THREE.Object3D } {
  const jig = new THREE.Group();
  const { nock, along } = BENCH.jig;
  const way = along.clone().normalize();
  for (const share of [0.45, 0.85]) {
    const at = nock.clone().addScaledVector(way, share * 0.6);
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, at.y - 0.012, 0.03),
      share < 0.5 ? dark : wood,
    );
    block.position.set(at.x, (at.y - 0.012) / 2, at.z);
    jig.add(block);
  }
  // The base board.
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.36), dark);
  base.position.set(nock.x, 0.006, nock.z - 0.26);
  jig.add(base);
  const pointer = new THREE.Mesh(
    new THREE.ConeGeometry(0.007, 0.016, 4),
    new THREE.MeshBasicMaterial({ color: COLORS.pointer }),
  );
  pointer.rotation.x = Math.PI;
  pointer.visible = false;
  return { jig, pointer };
}
