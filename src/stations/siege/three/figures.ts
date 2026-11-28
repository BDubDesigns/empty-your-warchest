import * as THREE from 'three';

// A placeholder guard built from boxes (the stress test's boxes pack draws it), sized from the
// rules' numbers, so what you see is where the rules have him.

const COLORS = {
  timber: 0x8a5a32,
  tunic: 0x3f5a7a,
  tunicDown: 0x6f6f6f,
  skin: 0xd6a77c,
  skinDown: 0x8f8f8f,
  helmet: 0x6a7075,
  leather: 0x4a3322,
};

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
