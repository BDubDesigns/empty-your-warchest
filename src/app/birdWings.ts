import * as THREE from 'three';

/**
 * Code-built bird wings, shared by every station's birds (the woodcutting crash's flock and the
 * bird hunt's): one flat wing reaching out along +x from the body, which flies toward +z. Its root
 * runs from `front` ahead of the body's middle to `back` behind it; it sweeps back to its tip
 * `span` out and `sweep` behind. A `tipWidth` over 0 makes a broad wing (a crow's) rather than
 * a pointed one. Mirror it (scale.x = -1) for the other side.
 */
export interface WingShape {
  span: number;
  front: number;
  back: number;
  sweep: number;
  tipWidth?: number;
}

export function wingGeometry(shape: WingShape): THREE.BufferGeometry {
  const { span, front, back, sweep, tipWidth = 0 } = shape;
  const rootFront = [0, 0, front];
  const rootBack = [0, 0, -back];
  const tipBack = [span, 0, -sweep];
  const positions =
    tipWidth > 0
      ? [...rootFront, ...rootBack, ...tipBack, ...rootFront, ...tipBack, span, 0, tipWidth - sweep]
      : [...rootFront, ...rootBack, ...tipBack];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** How far the wings are raised (radians) `age` seconds in, beating `hz` times a second. */
export function flapAngle(age: number, hz: number, amplitude = 0.9): number {
  return Math.sin(age * hz * Math.PI * 2) * amplitude;
}
