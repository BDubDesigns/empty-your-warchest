import * as THREE from 'three';
import { barkUvs } from '../../../app/woodGrain';
import type { Rng } from '../../../core';
import { logMaterials } from './scenery';

/**
 * The woodcutting cabin, built from separate parts so it can come apart when it's hit: a log wall
 * on each side, log gable ends, two roof halves, a stone chimney, a door, and a lit window. Sized
 * to the rules' cabin (its footprint and height), so what a falling tree touches is what counts.
 * Each part carries the box the wreck's physics uses for it; the boxes never overlap at the start
 * (wall logs cross at the corners, so their boxes stop short of each other), except the chimney's
 * stones through the roof, which the wreck keeps from colliding.
 */

export type CabinPartKind = 'log' | 'roof' | 'stone' | 'door';

export interface CabinPart {
  mesh: THREE.Mesh;
  kind: CabinPartKind;
  /** Half the size of the part's physics box, along the mesh's own axes. */
  half: THREE.Vector3;
  /** Relative weight: heavier parts shove lighter ones aside. */
  mass: number;
}

export interface CabinColors {
  roof: number;
  door: number;
  window: number;
  chimney: number;
}

const TAU = Math.PI * 2;
/** Log courses in each wall. */
const COURSES = 6;
/** Share of the cabin's height the walls take; the roof the rest. */
const WALL_SHARE = 0.55;
/** Roof board thickness and overhang (world units). */
const ROOF_THICKNESS = 0.07;
const ROOF_OVERHANG = 0.18;
/** Chimney stone size (world units), and how far the chimney stands above the ridge. */
const STONE = { width: 0.34, height: 0.26 };
const CHIMNEY_ABOVE = 0.3;
/** Gap left between physics boxes that would otherwise touch exactly. */
const SLACK = 0.01;

export class CabinModel {
  /** Placed on the cabin's spot by the view. */
  readonly group = new THREE.Group();
  /** Turned to face the clearing; holds the parts until the wreck takes them. */
  readonly body = new THREE.Group();
  readonly parts: CabinPart[] = [];
  /** The window, which shatters rather than falling. */
  readonly pane: THREE.Mesh;

  /** A cabin `long` × `short` (world units, long side along x, front toward +z), `height` tall. */
  constructor(long: number, short: number, height: number, colors: CabinColors, rng: Rng) {
    const wall = height * WALL_SHARE;
    const rise = height - wall;
    const course = wall / COURSES;
    const radius = course / 2;
    const logs = logMaterials();
    const addLog = (length: number, boxLength: number, at: THREE.Vector3, alongZ: boolean) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
      barkUvs(geometry, radius, length, rng.range(0, TAU), TAU);
      geometry.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, logs);
      mesh.position.copy(at);
      if (alongZ) mesh.rotation.y = Math.PI / 2;
      this.#add(mesh, 'log', new THREE.Vector3(boxLength / 2, radius, radius), length);
    };
    // The walls: front and back logs run the long way, the ends the short way, crossing at the
    // corners. Their boxes stop short of the crossing logs so they start apart.
    for (let index = 0; index < COURSES; index++) {
      const y = radius + index * course;
      for (const side of [-1, 1]) {
        const z = side * (short / 2 - radius);
        addLog(long + radius * 3, long - radius * 4 - SLACK, new THREE.Vector3(0, y, z), false);
        const x = side * (long / 2 - radius);
        addLog(short + radius * 3, short - radius * 4 - SLACK, new THREE.Vector3(x, y, 0), true);
      }
    }
    // The gable ends: shorter and shorter logs up to the ridge, each fitting under the roof.
    const slope = rise / (short / 2);
    for (let index = 0; wall + (index + 1) * course < height; index++) {
      const top = wall + (index + 1) * course;
      const half = (short / 2) * (1 - (top - wall) / rise) - SLACK * 2;
      if (half < radius * 2) break;
      for (const side of [-1, 1]) {
        const at = new THREE.Vector3(side * (long / 2 - radius), top - radius, 0);
        addLog(half * 2, half * 2, at, true);
      }
    }
    // The roof: two boards meeting at the ridge, lying on the slope just above the walls.
    const angle = Math.atan(slope);
    const span = Math.hypot(short / 2 + ROOF_OVERHANG, (short / 2 + ROOF_OVERHANG) * slope);
    const width = span - ROOF_THICKNESS;
    const roofMaterial = new THREE.MeshLambertMaterial({ color: colors.roof });
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(long + ROOF_OVERHANG * 2, ROOF_THICKNESS, width),
        roofMaterial,
      );
      // Down the slope from the ridge, then up off it by half the board's thickness.
      const down = new THREE.Vector3(0, -Math.sin(angle), side * Math.cos(angle));
      const normal = new THREE.Vector3(0, Math.cos(angle), side * Math.sin(angle));
      board.position
        .set(0, wall + rise + SLACK, 0)
        .addScaledVector(down, ROOF_THICKNESS + width / 2)
        .addScaledVector(normal, ROOF_THICKNESS / 2);
      board.rotation.x = side * angle;
      this.#add(
        board,
        'roof',
        new THREE.Vector3(long / 2 + ROOF_OVERHANG, ROOF_THICKNESS / 2, width / 2),
        4,
      );
    }
    // The chimney: a stack of stones inside the back wall, through the roof.
    const chimney = { x: long * 0.3, z: -short * 0.15 };
    const ridgeAt = wall + rise * (1 - Math.abs(chimney.z) / (short / 2));
    const stones = Math.ceil((ridgeAt + CHIMNEY_ABOVE) / STONE.height);
    for (let index = 0; index < stones; index++) {
      const shade = new THREE.Color(colors.chimney).multiplyScalar(rng.range(0.85, 1.1));
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(STONE.width, STONE.height - SLACK, STONE.width),
        new THREE.MeshLambertMaterial({ color: shade, flatShading: true }),
      );
      stone.position.set(
        chimney.x + rng.range(-0.015, 0.015),
        (index + 0.5) * STONE.height,
        chimney.z + rng.range(-0.015, 0.015),
      );
      this.#add(
        stone,
        'stone',
        new THREE.Vector3(STONE.width / 2, (STONE.height - SLACK) / 2, STONE.width / 2),
        1.5,
      );
    }
    // The door, just outside the front logs, and the lit window beside it.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(long * 0.16, wall * 0.75, 0.05),
      new THREE.MeshLambertMaterial({ color: colors.door }),
    );
    door.position.set(-long * 0.18, wall * 0.375, short / 2 + 0.03);
    this.#add(door, 'door', new THREE.Vector3(long * 0.08, wall * 0.375, 0.025), 1);
    this.pane = new THREE.Mesh(
      new THREE.BoxGeometry(long * 0.16, wall * 0.3, 0.04),
      new THREE.MeshBasicMaterial({ color: colors.window }),
    );
    this.pane.position.set(long * 0.2, wall * 0.55, short / 2 + 0.02);
    this.body.add(this.pane);
    this.group.add(this.body);
  }

  #add(mesh: THREE.Mesh, kind: CabinPartKind, half: THREE.Vector3, mass: number): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    this.parts.push({ mesh, kind, half, mass });
  }
}
