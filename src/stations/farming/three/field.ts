import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundTextures } from '../../../app/ground';
import { Rng, type GrowthStage } from '../../../core';
import type { Crop, Farming } from '../../../data';
import type { PlotSpot } from '../logic/layout';
import type { SoilState } from '../logic/watering';

/**
 * The farm's field, built in code (only looks): raised beds of tilled soil in wooden frames, the
 * soil darkening as it's watered and turning to glossy mud past its band, and the crops in them
 * at their growth stage (woad's blue-green rosettes with yellow flowers when ripe, sunflowers'
 * stalks with their heads). Metres, y up, the ground at y = 0. Every repeat is instanced: all the
 * leaves on the field are one draw, all the stalks another.
 */

export const COLORS = {
  sky: 0xbfdcec,
  ground: 0x6f8d4a,
  board: 0x8a6038,
  mound: 0x4a3220,
  puddle: 0x3a2616,
  fence: 0x9a7448,
} as const;

/** What a plot shows: its soil, and the crop in it (if any) and how far it's grown. */
export interface PlotLook {
  /** The gauge's level (0 to 1) and what that is against the crop's band. */
  moisture: number;
  soil: SoilState | 'none';
  /** The top of the band (where the soil is at its darkest before mud). */
  wetAt: number;
  crop: Crop | undefined;
  growth: number;
  stage: GrowthStage;
  /** 0 to 1 just after it went in or came out (a little pop), else 1. */
  pop: number;
}

/** Leaves on one rosette plant; on a stalk, two. */
const ROSETTE_LEAVES = 6;
const STALK_LEAVES = 2;
/** Florets in one woad flower head. */
const FLORETS = 5;

interface PlotParts {
  soil: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  puddle: THREE.Mesh;
  /** Where each plant stands in the plot, from its middle (seeded). */
  plants: { x: number; z: number; turn: number; lean: number }[];
}

export class Field {
  readonly group = new THREE.Group();
  readonly #looks: Farming['looks'];
  readonly #plots: PlotParts[] = [];
  readonly #spots: PlotSpot[];
  readonly #furrowed: THREE.BufferGeometry;
  readonly #flat: THREE.BufferGeometry;
  readonly #mounds: THREE.InstancedMesh;
  readonly #leaves: THREE.InstancedMesh;
  readonly #stems: THREE.InstancedMesh;
  readonly #petals: THREE.InstancedMesh;
  readonly #disks: THREE.InstancedMesh;
  readonly #florets: THREE.InstancedMesh;
  readonly #colors: { dry: THREE.Color; wet: THREE.Color; mud: THREE.Color };
  readonly #matrix = new THREE.Matrix4();
  readonly #color = new THREE.Color();
  /** The soil's textured (the high tier): its colours are lifted, as the map darkens them. */
  #mapped = false;

  /** The field for `spots` (the most plots it will have), its plants at most `plants` a plot. */
  constructor(looks: Farming['looks'], spots: readonly PlotSpot[], crops: readonly Crop[]) {
    this.#looks = looks;
    this.#spots = [...spots];
    const size = looks.plotSize;
    const height = looks.bedHeight;
    this.#colors = {
      dry: new THREE.Color(looks.soil.dry),
      wet: new THREE.Color(looks.soil.wet),
      mud: new THREE.Color(looks.soil.mud),
    };
    // The bed: a slab of soil, with furrows (ridges across it) on the high tier.
    const slab = new THREE.BoxGeometry(size, height, size);
    slab.translate(0, height / 2, 0);
    const ridges: THREE.BufferGeometry[] = [slab.clone()];
    const furrows = 4;
    for (let index = 0; index < furrows; index++) {
      const ridge = new THREE.CylinderGeometry(0.11, 0.11, size * 0.92, 10, 1);
      ridge.rotateZ(Math.PI / 2);
      ridge.scale(1, 0.5, 1);
      ridge.translate(0, height, -size / 2 + (size / furrows) * (index + 0.5));
      ridges.push(ridge);
    }
    this.#furrowed = merged(
      ridges.map((geometry) => geometry.toNonIndexed()),
      slab,
    );
    this.#flat = slab;
    // The soil's texture spans the bed in ground repeats, as the ground's does.
    const repeat = size / groundTextures('troddenDirt').tile;
    for (const geometry of [this.#furrowed, this.#flat]) {
      const uv = geometry.getAttribute('uv');
      for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, uv.getX(index) * repeat, uv.getY(index) * repeat);
      }
      uv.needsUpdate = true;
    }
    // The wooden frame round each bed: four boards a plot, one draw for the field.
    const board = new THREE.BoxGeometry(1, 1, 1);
    const boards = new THREE.InstancedMesh(
      board,
      new THREE.MeshLambertMaterial({ color: COLORS.board }),
      spots.length * 4,
    );
    const thick = 0.07;
    const tall = height + 0.05;
    spots.forEach((spot, index) => {
      const sides = [
        { x: 0, z: -size / 2, w: size + thick * 2, d: thick },
        { x: 0, z: size / 2, w: size + thick * 2, d: thick },
        { x: -size / 2, z: 0, w: thick, d: size },
        { x: size / 2, z: 0, w: thick, d: size },
      ];
      sides.forEach((side, sideIndex) => {
        this.#matrix.compose(
          new THREE.Vector3(spot.x + side.x, tall / 2, spot.z + side.z),
          new THREE.Quaternion(),
          new THREE.Vector3(side.w, tall, side.d),
        );
        boards.setMatrixAt(index * 4 + sideIndex, this.#matrix);
      });
    });
    boards.castShadow = boards.receiveShadow = true;
    this.group.add(boards);

    const rng = new Rng(`${String(looks.seed)}:plants`);
    const most = Math.max(...crops.map((crop) => crop.look.plants), 1);
    for (const spot of spots) {
      const material = new THREE.MeshLambertMaterial({ color: this.#colors.dry });
      const soil = new THREE.Mesh(this.#furrowed, material);
      soil.position.set(spot.x, 0, spot.z);
      soil.receiveShadow = true;
      // Mud: a glossy brown puddle on top, its size how far past the band it went.
      const puddle = new THREE.Mesh(
        puddleGeometry(size, new Rng(`${String(looks.seed)}:puddle:${String(spot.plot)}`)),
        new THREE.MeshPhongMaterial({
          color: COLORS.puddle,
          specular: 0xc8d0d8,
          shininess: 120,
          transparent: true,
          opacity: 0.85,
        }),
      );
      puddle.position.set(spot.x, height + 0.075, spot.z);
      puddle.visible = false;
      this.group.add(soil, puddle);
      const plants = Array.from({ length: most }, () => ({
        x: 0,
        z: 0,
        turn: rng.range(0, Math.PI * 2),
        lean: rng.range(-0.12, 0.12),
      }));
      this.#plots.push({ soil, material, puddle, plants });
    }

    // The plants, every plot's, one instanced draw a part.
    const slots = spots.length * most;
    const leaf = new THREE.SphereGeometry(0.5, 8, 4);
    leaf.scale(0.34, 0.07, 1);
    leaf.translate(0, 0, 0.5);
    this.#leaves = this.#instanced(leaf, slots * ROSETTE_LEAVES, true);
    const stem = new THREE.CylinderGeometry(0.5, 0.6, 1, 6);
    stem.translate(0, 0.5, 0);
    this.#stems = this.#instanced(stem, slots, true);
    // A sunflower head: a ring of petals round a dark middle, facing up along +y.
    const petals: THREE.BufferGeometry[] = [];
    for (let index = 0; index < 12; index++) {
      const petal = new THREE.SphereGeometry(0.5, 6, 3);
      petal.scale(0.09, 0.03, 0.2);
      petal.translate(0, 0, 0.16);
      petal.rotateY((index / 12) * Math.PI * 2);
      petals.push(petal.toNonIndexed());
    }
    this.#petals = this.#instanced(merged(petals, new THREE.BufferGeometry()), slots, false);
    const disk = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12);
    this.#disks = this.#instanced(disk, slots, false);
    // Woad's flowers: a tight clutch of yellow florets on a short stalk.
    const florets: THREE.BufferGeometry[] = [];
    const floretRng = new Rng(`${String(looks.seed)}:florets`);
    for (let index = 0; index < FLORETS; index++) {
      const floret = new THREE.IcosahedronGeometry(0.045, 0);
      floret.translate(
        floretRng.range(-0.05, 0.05),
        floretRng.range(0, 0.06),
        floretRng.range(-0.05, 0.05),
      );
      florets.push(floret.toNonIndexed());
    }
    this.#florets = this.#instanced(merged(florets, new THREE.BufferGeometry()), slots, false);
    // Freshly sown: little mounds of dark soil where each seed went in.
    const mound = new THREE.SphereGeometry(0.07, 7, 4);
    mound.scale(1, 0.45, 1);
    this.#mounds = new THREE.InstancedMesh(
      mound,
      new THREE.MeshLambertMaterial({ color: COLORS.mound }),
      slots,
    );
    this.#mounds.receiveShadow = true;
    this.group.add(this.#mounds);
  }

  /** The plots' spots on the field. */
  get spots(): readonly PlotSpot[] {
    return this.#spots;
  }

  /** The soil's top (m), where the can's stream lands and the plants stand. */
  get top(): number {
    return this.#looks.bedHeight + 0.04;
  }

  /** Furrows in the soil (the high tier) or a flat bed (low). */
  setFurrows(on: boolean): void {
    for (const plot of this.#plots) plot.soil.geometry = on ? this.#furrowed : this.#flat;
  }

  /** Tilled earth's texture on the soil (the high tier), or plain colour. */
  setSoilMap(on: boolean): void {
    this.#mapped = on;
    const map = on ? groundTextures('troddenDirt').map : null;
    for (const plot of this.#plots) {
      plot.material.map = map;
      plot.material.needsUpdate = true;
    }
  }

  /** Whether the plants cast shadows (the high tier). */
  setShadows(on: boolean): void {
    for (const mesh of [this.#leaves, this.#stems, this.#petals, this.#disks, this.#florets]) {
      mesh.castShadow = on;
    }
  }

  /**
   * Draws every plot as `looks` has them (one entry a plot, `undefined` for plots not open yet:
   * hidden). `time` (seconds) sways the ripe plants.
   */
  update(looks: readonly (PlotLook | undefined)[], time: number): void {
    const counts = { mounds: 0, leaves: 0, stems: 0, petals: 0, disks: 0, florets: 0 };
    this.#plots.forEach((parts, index) => {
      const look = looks[index];
      const spot = this.#spots[index];
      parts.soil.visible = Boolean(look);
      if (!look || !spot) {
        parts.puddle.visible = false;
        return;
      }
      this.#paintSoil(parts, look);
      const crop = look.crop;
      if (!crop) return;
      const placed = plantSpots(crop.look.plants, this.#looks.plotSize);
      placed.forEach((at, plantIndex) => {
        const plant = parts.plants[plantIndex];
        if (!plant) return;
        const base = new THREE.Vector3(spot.x + at.x, this.top - 0.04, spot.z + at.z);
        this.#drawPlant(crop, look, base, plant, time + index * 0.7 + plantIndex, counts);
      });
    });
    this.#mounds.count = counts.mounds;
    this.#leaves.count = counts.leaves;
    this.#stems.count = counts.stems;
    this.#petals.count = counts.petals;
    this.#disks.count = counts.disks;
    this.#florets.count = counts.florets;
    for (const mesh of [
      this.#mounds,
      this.#leaves,
      this.#stems,
      this.#petals,
      this.#disks,
      this.#florets,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Dry pale brown, darkening as it fills to the top of its band; past it, mud and a puddle. */
  #paintSoil(parts: PlotParts, look: PlotLook): void {
    const { dry, wet, mud } = this.#colors;
    const wetAt = Math.max(look.wetAt, 0.01);
    if (look.soil === 'mud') {
      const past = Math.min((look.moisture - wetAt) / Math.max(1 - wetAt, 0.01), 1);
      parts.material.color.copy(wet).lerp(mud, 0.5 + past * 0.5);
      parts.puddle.visible = true;
      const scale = 0.45 + past * 0.55;
      parts.puddle.scale.set(scale, 1, scale);
    } else {
      parts.material.color.copy(dry).lerp(wet, Math.min(look.moisture / wetAt, 1));
      parts.puddle.visible = false;
    }
    if (this.#mapped) parts.material.color.multiplyScalar(1.7);
  }

  #drawPlant(
    crop: Crop,
    look: PlotLook,
    base: THREE.Vector3,
    plant: { turn: number; lean: number },
    time: number,
    counts: Record<'mounds' | 'leaves' | 'stems' | 'petals' | 'disks' | 'florets', number>,
  ): void {
    const { stages } = this.#looks;
    const pop = popScale(look.pop);
    // The mound where the seed went in, until the sprout's up.
    if (look.growth < stages.young) {
      const fade = look.growth < stages.sprout ? 1 : 0.7;
      this.#set(this.#mounds, counts.mounds++, base, new THREE.Quaternion(), fade * pop);
    }
    if (look.stage === 'seed') return;
    const grown = Math.min(Math.max(look.growth, 0), 1);
    const size = (0.22 + 0.78 * grown) * pop;
    const ripe = look.stage === 'ripe';
    const sway = ripe ? Math.sin(time * 1.6) * 0.06 : 0;
    const leaf = new THREE.Color(crop.look.leaf);
    const up = new THREE.Vector3(0, 1, 0);
    if (crop.look.shape === 'rosette') {
      // Long leaves round the middle, rising as they grow.
      const length = crop.look.height * size;
      for (let index = 0; index < ROSETTE_LEAVES; index++) {
        const turn = plant.turn + (index / ROSETTE_LEAVES) * Math.PI * 2;
        const rise = 0.5 + grown * 0.45 + (index % 2) * 0.12;
        const quaternion = new THREE.Quaternion()
          .setFromAxisAngle(up, turn)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -rise));
        this.#set(this.#leaves, counts.leaves, base, quaternion, length, leaf);
        counts.leaves++;
      }
      // Ripe: a stalk of yellow flowers out of the middle.
      if (grown >= stages.grown) {
        const bloom = ripe ? 1 : (grown - stages.grown) / Math.max(1 - stages.grown, 0.01);
        const tall = crop.look.height * 1.15 * size;
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sway);
        this.#setScaled(this.#stems, counts.stems++, base, tilt, 0.012, tall, crop.look.stem);
        const top = new THREE.Vector3(0, tall, 0).applyQuaternion(tilt).add(base);
        const flower = new THREE.Color(ripe ? crop.look.flower : crop.look.stem);
        this.#set(this.#florets, counts.florets++, top, tilt, 0.4 + bloom * 0.8 * pop, flower);
      }
      return;
    }
    // A stalk: up it grows, two leaves halfway, and its head once it's grown.
    const tall = crop.look.height * size;
    const tilt = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), plant.lean * grown + sway)
      .multiply(new THREE.Quaternion().setFromAxisAngle(up, plant.turn));
    this.#setScaled(
      this.#stems,
      counts.stems++,
      base,
      tilt,
      0.022 + grown * 0.012,
      tall,
      crop.look.stem,
    );
    for (let index = 0; index < STALK_LEAVES; index++) {
      const at = new THREE.Vector3(0, tall * (0.35 + index * 0.18), 0)
        .applyQuaternion(tilt)
        .add(base);
      const quaternion = tilt
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(up, index * Math.PI + 0.4))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5));
      this.#set(this.#leaves, counts.leaves, at, quaternion, 0.26 * size, leaf);
      counts.leaves++;
    }
    if (grown >= stages.grown) {
      const bloom = ripe
        ? 1
        : 0.35 + (0.4 * (grown - stages.grown)) / Math.max(1 - stages.grown, 0.01);
      const top = new THREE.Vector3(0, tall, 0).applyQuaternion(tilt).add(base);
      // The head turns to face the sun and the camera: up and toward +z.
      const face = tilt
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.85));
      const head = bloom * pop * Math.max(size, 0.6);
      this.#set(this.#disks, counts.disks++, top, face, head, new THREE.Color(crop.look.centre));
      // Petals only open once it's ripe; till then, a green bud.
      if (ripe)
        this.#set(
          this.#petals,
          counts.petals++,
          top,
          face,
          head,
          new THREE.Color(crop.look.flower),
        );
      else this.#set(this.#petals, counts.petals++, top, face, head * 0.55, leaf);
    }
  }

  #set(
    mesh: THREE.InstancedMesh,
    index: number,
    at: THREE.Vector3,
    quaternion: THREE.Quaternion,
    scale: number,
    color?: THREE.Color,
  ): void {
    if (index >= mesh.instanceMatrix.count) return;
    this.#matrix.compose(at, quaternion, new THREE.Vector3(scale, scale, scale));
    mesh.setMatrixAt(index, this.#matrix);
    if (color && mesh.instanceColor) mesh.setColorAt(index, color);
  }

  #setScaled(
    mesh: THREE.InstancedMesh,
    index: number,
    at: THREE.Vector3,
    quaternion: THREE.Quaternion,
    radius: number,
    height: number,
    color: string,
  ): void {
    if (index >= mesh.instanceMatrix.count) return;
    this.#matrix.compose(at, quaternion, new THREE.Vector3(radius * 2, height, radius * 2));
    mesh.setMatrixAt(index, this.#matrix);
    mesh.setColorAt(index, this.#color.set(color));
  }

  #instanced(geometry: THREE.BufferGeometry, count: number, tinted: boolean): THREE.InstancedMesh {
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
    // Every instance takes its own colour (each crop's leaves, stems, petals).
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    if (!tinted) mesh.castShadow = false;
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
}

/** Where `count` plants stand in a plot `size` across, from its middle: a square, or a triangle. */
export function plantSpots(count: number, size: number): { x: number; z: number }[] {
  const step = size * 0.26;
  if (count === 4) {
    return [
      { x: -step, z: -step },
      { x: step, z: -step },
      { x: -step, z: step },
      { x: step, z: step },
    ];
  }
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + Math.PI;
    return { x: Math.sin(angle) * step * 1.1, z: Math.cos(angle) * step * 1.1 };
  });
}

/** A pop as something goes in or comes out: overshoots a touch, then settles at 1. */
function popScale(pop: number): number {
  if (pop >= 1) return 1;
  const t = Math.max(pop, 0);
  return 1 + Math.sin(t * Math.PI) * 0.25 - (1 - t) * 0.6;
}

/** A puddle's shape: a few overlapping flat blobs, lying flat. */
function puddleGeometry(size: number, rng: Rng): THREE.BufferGeometry {
  const blobs = Array.from({ length: 4 }, (_, index) => {
    const blob = new THREE.CircleGeometry(size * rng.range(0.16, 0.26), 14);
    blob.rotateX(-Math.PI / 2);
    const angle = (index / 4) * Math.PI * 2 + rng.range(0, 1);
    blob.translate(Math.sin(angle) * size * 0.14, index * 0.002, Math.cos(angle) * size * 0.14);
    return blob.toNonIndexed();
  });
  return merged(blobs, new THREE.CircleGeometry(size * 0.3));
}

/** Geometries merged into one (they must share their attributes), or `fallback` if they can't be. */
function merged(geometries: THREE.BufferGeometry[], fallback: THREE.BufferGeometry) {
  return (mergeGeometries(geometries) as THREE.BufferGeometry | null) ?? fallback;
}
