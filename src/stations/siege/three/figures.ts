import * as THREE from 'three';
import type { SiegeWeapon } from '../../../data';

// The siege's placeholder figures, built from boxes: the ballista and a guard. Both are sized from
// the rules' numbers, so what you see is where the rules have them.

const COLORS = {
  timber: 0x8a5a32,
  timberDark: 0x5c3a1e,
  iron: 0x4d5257,
  rope: 0xd9c9a3,
  tunic: 0x3f5a7a,
  tunicDown: 0x6f6f6f,
  skin: 0xd6a77c,
  skinDown: 0x8f8f8f,
  helmet: 0x6a7075,
  leather: 0x4a3322,
};

const mesh = (geometry: THREE.BufferGeometry, color: number): THREE.Mesh => {
  const made = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
  made.castShadow = true;
  made.receiveShadow = true;
  return made;
};

/** The ballista as drawn: its carriage, the part that turns, and the part that tilts. */
export interface BallistaLook {
  root: THREE.Group;
  /** Turns left and right (yaw), at the pivot. */
  turn: THREE.Group;
  /** Tilts up and down, inside `turn`. */
  tilt: THREE.Group;
  /** The bolt lying in the groove, shown while it's loaded. */
  bolt: THREE.Group;
  /** The bow's two arms, swung back when it's drawn. */
  arms: THREE.Object3D[];
  wheels: THREE.Mesh[];
  wheelRadius: number;
}

/**
 * A ballista from boxes: a wheeled carriage `size` wide, high and long (the rules' size), a post up
 * to the pivot at `pivotHeight`, and on it the stock, `muzzle` long in front of the pivot, with a
 * bow across its front. `boltMesh` makes the bolt lying in the groove.
 */
export function buildBallista(rules: SiegeWeapon, boltMesh: () => THREE.Group): BallistaLook {
  const [width, height, length] = rules.size;
  const root = new THREE.Group();
  const wheelRadius = Math.min(height * 0.32, 0.4);
  const bed = mesh(new THREE.BoxGeometry(width * 0.8, height * 0.18, length), COLORS.timber);
  bed.position.y = wheelRadius + height * 0.09;
  root.add(bed);
  const wheels = [-1, 1].flatMap((side) =>
    [-1, 1].map((end) => {
      const wheel = mesh(
        new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.12, 14),
        COLORS.timberDark,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (width / 2 - 0.06), wheelRadius, end * length * 0.32);
      root.add(wheel);
      return wheel;
    }),
  );
  // The post the stock turns on, up to the pivot.
  const post = mesh(
    new THREE.BoxGeometry(0.22, rules.pivotHeight - bed.position.y, 0.22),
    COLORS.timberDark,
  );
  post.position.y = (rules.pivotHeight + bed.position.y) / 2;
  root.add(post);
  const turn = new THREE.Group();
  turn.position.y = rules.pivotHeight;
  root.add(turn);
  const tilt = new THREE.Group();
  turn.add(tilt);
  // The stock: from a little behind the pivot to the muzzle, along −z.
  const back = length * 0.45;
  const stock = mesh(new THREE.BoxGeometry(0.2, 0.16, rules.muzzle + back), COLORS.timber);
  stock.position.z = -(rules.muzzle - back) / 2;
  tilt.add(stock);
  const winch = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), COLORS.iron);
  winch.rotation.z = Math.PI / 2;
  winch.position.set(0, 0.04, back - 0.12);
  tilt.add(winch);
  // The bow across the front: two arms swept back, and the string.
  const front = -rules.muzzle * 0.78;
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1, 0.06, front);
    const arm = mesh(new THREE.BoxGeometry(width * 0.48, 0.08, 0.09), COLORS.timberDark);
    arm.position.x = side * width * 0.24;
    pivot.add(arm);
    pivot.rotation.y = side * 0.35;
    tilt.add(pivot);
    return pivot;
  });
  const string = mesh(new THREE.BoxGeometry(width * 0.95, 0.02, 0.02), COLORS.rope);
  string.position.set(0, 0.08, front + 0.42);
  tilt.add(string);
  const bolt = boltMesh();
  // The bolt's length runs along its local y, point first: lay it along −z, its point at the muzzle.
  bolt.rotation.x = -Math.PI / 2;
  bolt.position.set(0, 0.12, -rules.muzzle + 1);
  tilt.add(bolt);
  return { root, turn, tilt, bolt, arms, wheels, wheelRadius };
}

/** A guard as drawn: its figure, and its materials so it can grey out when it's down. */
export interface GuardLook {
  root: THREE.Group;
  tunic: THREE.MeshLambertMaterial;
  skin: THREE.MeshLambertMaterial;
}

/**
 * A guard from boxes, filling the rules' body `size` (width, height, depth) about its middle:
 * legs, a tunic, a helmeted head, and a spear held upright.
 */
export function buildGuard(size: readonly [number, number, number]): GuardLook {
  const [width, height, depth] = size;
  const root = new THREE.Group();
  const tunic = new THREE.MeshLambertMaterial({ color: COLORS.tunic });
  const skin = new THREE.MeshLambertMaterial({ color: COLORS.skin });
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, x = 0) => {
    const made = new THREE.Mesh(geometry, material);
    made.position.set(x, y - height / 2, 0);
    made.castShadow = true;
    root.add(made);
    return made;
  };
  const legs = height * 0.45;
  const body = height * 0.33;
  const head = height * 0.13;
  for (const side of [-1, 1]) {
    part(
      new THREE.BoxGeometry(width * 0.36, legs, depth * 0.8),
      new THREE.MeshLambertMaterial({ color: COLORS.leather }),
      legs / 2,
      side * width * 0.24,
    );
  }
  part(new THREE.BoxGeometry(width, body, depth), tunic, legs + body / 2);
  part(new THREE.BoxGeometry(head, head, head), skin, legs + body + head / 2);
  part(
    new THREE.BoxGeometry(head * 1.2, head * 0.45, head * 1.2),
    new THREE.MeshLambertMaterial({ color: COLORS.helmet }),
    height - head * 0.22,
  );
  const spear = part(
    new THREE.BoxGeometry(0.04, height * 1.05, 0.04),
    new THREE.MeshLambertMaterial({ color: COLORS.timber }),
    height * 0.55,
    width * 0.62,
  );
  spear.position.z = -depth * 0.2;
  return { root, tunic, skin };
}

/** Greys a guard out once it's down. */
export function greyGuard(look: GuardLook): void {
  look.tunic.color.setHex(COLORS.tunicDown);
  look.skin.color.setHex(COLORS.skinDown);
}
