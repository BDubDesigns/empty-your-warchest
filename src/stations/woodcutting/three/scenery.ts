import * as THREE from 'three';
import { groundMesh } from '../../../app/ground';
import { scatter, type Placement } from '../../../app/scatter';
import { barkTextures, barkUvs, drawEndGrain } from '../../../app/woodGrain';
import { Rng } from '../../../core';
import type { SceneryPlantKind, WoodcuttingScenery } from '../../../data';

/**
 * Everything outside the woodcutting fence, built from data: grass thick by the fence and thinning
 * out, undergrowth, a wall of forest that can't be chopped, and the woodcutter's track, woodpile
 * and chopping block. Only looks: none of it is in the rules, nothing here can be knocked or
 * counts for wood. Laid out once (the same every round); the forest is rebuilt when the tree style
 * changes.
 */

/** The clearing's size (clearing units) and how it maps into the world. */
export interface SceneryFrame {
  width: number;
  height: number;
  /** World units per clearing unit. */
  scale: number;
}

/** A point outside the fence, in clearing units. */
interface Spot {
  x: number;
  y: number;
}

/** A forest tree: where, how tall (world units), its turn, and which of the models it is. */
interface ForestSpot extends Spot {
  height: number;
  turn: number;
  model: number;
}

const TAU = Math.PI * 2;
/** Plants keep this far (clearing units) off the fence line, so they don't grow through it. */
const FENCE_CLEAR = 4;
/** Colour of the split logs' ends and the bark's tint on the woodpile and block. */
const BARK_TINT = 0xd9c2a6;

export class Scenery {
  readonly group = new THREE.Group();
  /** Where the forest's treetops are (world), for birds to burst from. */
  treetops: THREE.Vector3[] = [];
  readonly #data: WoodcuttingScenery;
  readonly #frame: SceneryFrame;
  #forest = new THREE.Group();
  #forestSpots: ForestSpot[] = [];

  constructor(
    data: WoodcuttingScenery,
    frame: SceneryFrame,
    plants: Record<SceneryPlantKind, THREE.Object3D>,
    axe: THREE.Object3D,
  ) {
    this.#data = data;
    this.#frame = frame;
    const rng = new Rng(data.seed);
    this.group.add(this.#track());
    const keepOut = this.#keepOut();
    for (const plant of data.plants) {
      const placements: Placement[] = [];
      for (let index = 0; index < plant.count; index++) {
        const spot = this.#outside(rng, FENCE_CLEAR, plant.reach, plant.bunch);
        if (keepOut(spot)) continue;
        placements.push({
          ...this.#world(spot),
          height: rng.range(plant.height.min, plant.height.max) * frame.scale,
          turn: rng.range(0, TAU),
        });
      }
      this.group.add(
        scatter(plants[plant.kind], placements, {
          ...plant,
          grass: plant.kind === 'grassTall' || plant.kind === 'grassShort',
        }),
      );
    }
    this.#placeForest(rng);
    this.group.add(this.#forest);
    this.group.add(this.#woodpile(rng));
    this.group.add(this.#block(axe));
  }

  /** (Re)builds the forest wall from these tree models (the round's tree style). */
  setForest(trees: readonly THREE.Object3D[]): void {
    this.group.remove(this.#forest);
    this.#forest = new THREE.Group();
    trees.forEach((source, model) => {
      const placements = this.#forestSpots
        .filter((spot) => spot.model % trees.length === model)
        .map((spot) => ({ ...this.#world(spot), height: spot.height, turn: spot.turn }));
      this.#forest.add(scatter(source, placements));
    });
    this.group.add(this.#forest);
  }

  /** How many triangles the scenery draws, for the log. */
  get triangles(): number {
    let total = 0;
    this.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = child.geometry as THREE.BufferGeometry;
      const count = geometry.index?.count ?? geometry.getAttribute('position').count;
      total += (count / 3) * (child instanceof THREE.InstancedMesh ? child.count : 1);
    });
    return Math.round(total);
  }

  #world(spot: Spot): { x: number; z: number } {
    const { width, height, scale } = this.#frame;
    return { x: (spot.x - width / 2) * scale, z: (spot.y - height / 2) * scale };
  }

  /**
   * A random spot `from` to `to` outside the fence: along a side (picked by the sides' weights,
   * unless `even`), then out from it, bunched toward it by `bunch`.
   */
  #outside(rng: Rng, from: number, to: number, bunch: number, near = from, even = false): Spot {
    const { width, height } = this.#frame;
    const sides = even ? { far: 1, near: 1, left: 1, right: 1 } : this.#data.sides;
    // Each side's share: its length times how thickly things grow there.
    const shares = [
      width * sides.far,
      height * sides.right,
      width * sides.near,
      height * sides.left,
    ];
    let pick = rng.range(
      0,
      shares.reduce((sum, share) => sum + share, 0),
    );
    let side = 0;
    while (side < 3 && pick >= (shares[side] ?? 0)) pick -= shares[side++] ?? 0;
    const along = rng.range(0, side % 2 === 0 ? width : height);
    const out = from + rng.range(0, 1) ** bunch * (to - from);
    if (side === 0) return { x: along, y: -out };
    if (side === 1) return { x: width + out, y: along };
    // The camera's side: things here may start further out (`near`).
    if (side === 2) return { x: along, y: height + out - from + near };
    return { x: -out, y: along };
  }

  /** The track, woodpile and block: plants don't grow on them. */
  #keepOut(): (spot: Spot) => boolean {
    const { track, woodpile, block } = this.#data;
    const { height } = this.#frame;
    return (spot) =>
      (Math.abs(spot.x - track.x) < track.width / 2 &&
        spot.y > height &&
        spot.y < height + track.length) ||
      Math.hypot(spot.x - woodpile.x, spot.y - woodpile.y) < woodpile.length * 0.7 ||
      Math.hypot(spot.x - block.x, spot.y - block.y) < block.radius * 1.6;
  }

  /** Where the forest's trees stand: spaced out, and held back on the camera's side. */
  #placeForest(rng: Rng): void {
    const { forest } = this.#data;
    const spots: ForestSpot[] = [];
    for (let attempt = 0; attempt < forest.trees * 30 && spots.length < forest.trees; attempt++) {
      const spot = this.#outside(rng, forest.gap, forest.gap + forest.depth, 1, forest.nearGap);
      if (spots.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < forest.spacing)) {
        continue;
      }
      spots.push({
        ...spot,
        height: rng.range(forest.height.min, forest.height.max) * this.#frame.scale,
        turn: rng.range(0, TAU),
        model: spots.length,
      });
    }
    this.#forestSpots = spots;
    this.treetops = spots.map((spot) => {
      const at = this.#world(spot);
      return new THREE.Vector3(at.x, spot.height * 0.85, at.z);
    });
  }

  /** The trodden track leading off from the fence on the camera's side. */
  #track(): THREE.Mesh {
    const { track } = this.#data;
    const { height, scale } = this.#frame;
    const mesh = groundMesh('troddenDirt', track.width * scale, track.length * scale);
    const at = this.#world({ x: track.x, y: height + track.length / 2 });
    mesh.position.set(at.x, 0.003, at.z);
    return mesh;
  }

  /** Logs stacked in rows beside the track, each row one log shorter, nested in the one below. */
  #woodpile(rng: Rng): THREE.Group {
    const { woodpile } = this.#data;
    const scale = this.#frame.scale;
    const radius = woodpile.radius * scale;
    const length = woodpile.length * scale;
    const group = new THREE.Group();
    const materials = logMaterials();
    for (let row = 0; row < woodpile.rows; row++) {
      const logs = woodpile.rows - row + 1;
      for (let index = 0; index < logs; index++) {
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 10, 1);
        barkUvs(geometry, radius, length, 0, TAU);
        const log = new THREE.Mesh(geometry, materials);
        log.rotation.x = Math.PI / 2;
        log.rotation.y = rng.range(0, TAU);
        log.position.set(
          (index - (logs - 1) / 2) * radius * 2.02 + rng.range(-0.01, 0.01),
          radius + row * radius * 1.74,
          rng.range(-0.04, 0.04),
        );
        log.castShadow = true;
        log.receiveShadow = true;
        group.add(log);
      }
    }
    const at = this.#world(woodpile);
    group.position.set(at.x, 0, at.z);
    return group;
  }

  /** A chopping block with the axe sunk into its top. */
  #block(axe: THREE.Object3D): THREE.Group {
    const { block } = this.#data;
    const scale = this.#frame.scale;
    const radius = block.radius * scale;
    const height = block.height * scale;
    const group = new THREE.Group();
    const geometry = new THREE.CylinderGeometry(radius, radius * 1.08, height, 16, 1);
    barkUvs(geometry, radius, height, 0, TAU);
    const stump = new THREE.Mesh(geometry, logMaterials());
    stump.position.y = height / 2;
    stump.castShadow = true;
    stump.receiveShadow = true;
    group.add(stump);
    // The axe, about two block heights long, its head buried in the top at a lean.
    const tool = axe.clone(true);
    const box = new THREE.Box3().setFromObject(tool);
    const size = box.getSize(new THREE.Vector3());
    const fit = (height * 2.2) / Math.max(size.x, size.y, size.z);
    tool.scale.setScalar(fit);
    const holder = new THREE.Group();
    tool.position.set(
      -((box.min.x + box.max.x) / 2) * fit,
      -box.max.y * fit + radius * 0.45,
      -((box.min.z + box.max.z) / 2) * fit,
    );
    holder.add(tool);
    holder.position.y = height;
    holder.rotation.set(0, 0.6, -0.35);
    group.add(holder);
    const at = this.#world(block);
    group.position.set(at.x, 0, at.z);
    return group;
  }
}

/** Bark round the side and end grain on both ends (a cylinder's three material groups). */
export function logMaterials(): THREE.Material[] {
  const bark = barkTextures();
  const side = new THREE.MeshLambertMaterial({
    color: BARK_TINT,
    map: bark.map,
    normalMap: bark.normalMap,
  });
  const end = new THREE.MeshLambertMaterial({ map: endGrain() });
  return [side, end, end];
}

let grain: THREE.CanvasTexture | undefined;

/** One end-grain picture shared by every log end out here. */
function endGrain(): THREE.CanvasTexture {
  if (!grain) {
    grain = new THREE.CanvasTexture(drawEndGrain(128, 16, 5));
    grain.colorSpace = THREE.SRGBColorSpace;
  }
  return grain;
}
