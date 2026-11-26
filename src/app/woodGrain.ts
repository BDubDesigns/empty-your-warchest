import * as THREE from 'three';
import { Rng } from '../core';

/**
 * Wood drawn in code, so it fits whatever log the rules make: the end grain (growth rings round
 * the pith, wobbling as real ones do, dark latewood at the end of each year, paler sapwood near
 * the bark, faint rays out from the pith, a fine speckle) and the split face (the same rings seen
 * from the side, as streaks running up the log). Only looks: nothing here touches the rules.
 */

const TAU = Math.PI * 2;

/** Colours (0–255 RGB) of the wood, from the pith out. */
const WOOD = {
  early: [228, 196, 146],
  late: [160, 110, 62],
  heart: [214, 170, 116],
  sap: [236, 212, 166],
  innerBark: [96, 64, 38],
  pith: [130, 88, 50],
} as const;
type Rgb = readonly [number, number, number];

/** Where sapwood starts and the bark's inner layer starts, as shares of the radius. */
const SAPWOOD = 0.8;
const INNER_BARK = 0.965;

/** A cheap repeatable hash of two integers to 0–1, for the speckle. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A wobble round the log: a few waves of decreasing size, so rings are never quite circles. */
function wobble(rng: Rng, waves: number, size: number) {
  const parts = Array.from({ length: waves }, (_, index) => ({
    k: index + 1,
    amplitude: (size * rng.range(0.5, 1)) / (index + 1),
    phase: rng.range(0, TAU),
  }));
  return (angle: number) =>
    parts.reduce((sum, part) => sum + part.amplitude * Math.sin(part.k * angle + part.phase), 0);
}

/**
 * Where each year's ring falls, from the pith (0) to the bark (1): years vary in width (good years
 * and bad), and narrow toward the bark as the tree slowed. Returns the year (with its fraction) at
 * a share of the radius.
 */
function ringYears(rng: Rng, rings: number): (r: number) => number {
  const widths = Array.from(
    { length: rings },
    (_, year) => rng.range(0.45, 1.55) * (1.25 - (0.5 * year) / rings),
  );
  const total = widths.reduce((sum, width) => sum + width, 0);
  const edges = [0];
  for (const width of widths) edges.push((edges[edges.length - 1] ?? 0) + width / total);
  const steps = 1024;
  const table = Array.from({ length: steps + 1 }, (_, step) => {
    const r = step / steps;
    let year = 0;
    while (year < rings - 1 && (edges[year + 1] ?? 1) <= r) year++;
    const from = edges[year] ?? 0;
    const to = edges[year + 1] ?? 1;
    return year + (r - from) / Math.max(to - from, 1e-6);
  });
  return (r) => {
    const at = Math.min(Math.max(r, 0), 1) * steps;
    const low = Math.floor(at);
    const a = table[low] ?? 0;
    const b = table[Math.min(low + 1, steps)] ?? a;
    return a + (b - a) * (at - low);
  };
}

/** How dark a point in a year's ring is (0 earlywood … 1 latewood), from its place in the year. */
function latewood(year: number): number {
  const t = year - Math.floor(year);
  // Light most of the year, darkening fast at its end, then a sharp edge to the next year.
  if (t < 0.55) return 0;
  const d = (t - 0.55) / 0.45;
  return d * d * (3 - 2 * d);
}

function mix(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The wood's colour at `r` (share of the radius) for a year position `year`. */
function woodAt(r: number, year: number): [number, number, number] {
  if (r > INNER_BARK) return [...WOOD.innerBark];
  // Heartwood warms toward the pith; the edge to the sapwood fades over a few percent.
  const sapBlend = Math.min(Math.max((r - SAPWOOD + 0.03) / 0.06, 0), 1);
  const early = mix(mix(WOOD.heart, WOOD.early, Math.min(r / SAPWOOD, 1)), WOOD.sap, sapBlend);
  return mix(early, WOOD.late, latewood(year) * (1 - sapBlend * 0.35));
}

/**
 * The tree a log came from, the same for its end grain and its split face: where the pith sits
 * (a little off centre, as in most trees, so rings bunch on one side), how its rings wobble, and
 * how wide each year grew.
 */
function treeOf(rings: number, seed: number) {
  const rng = new Rng(seed);
  const pith = { x: rng.range(-0.06, 0.06), y: rng.range(-0.06, 0.06) };
  const around = wobble(rng, 6, 0.035);
  const local = wobble(rng, 4, 0.5);
  const years = ringYears(rng, rings);
  return { rng, pith, around, local, years };
}

/**
 * A log's end grain, `size` pixels square, the face filling the circle: `rings` years from the
 * pith to the bark. The same seed draws the same wood.
 */
export function drawEndGrain(size: number, rings: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const { rng, pith, around, local, years } = treeOf(rings, seed);
  const rays = Math.round(rng.range(70, 110));
  const raySeed = rng.range(0, TAU);
  const image = context.createImageData(size, size);
  const half = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - half) / half;
      const y = (half - py - 0.5) / half;
      const edge = Math.hypot(x, y);
      if (edge > 1.01) continue;
      // Distance from the (off-centre) pith, scaled so the bark is still at the edge.
      const dx = x - pith.x * (1 - edge);
      const dy = y - pith.y * (1 - edge);
      const angle = Math.atan2(dy, dx);
      const r = Math.min(Math.hypot(dx, dy), 1);
      const warped =
        r * (1 + around(angle) * Math.min(r * 2, 1)) + around(angle * 3 + r * 9) * 0.006;
      const year = years(warped) + local(angle + warped * 4) * 0.12;
      let [red, green, blue] = woodAt(edge, year);
      if (r < 0.025) [red, green, blue] = [...WOOD.pith];
      // Rays: faint pale lines out from the pith.
      const ray = Math.abs(Math.sin(angle * rays * 0.5 + raySeed + Math.sin(angle * 7) * 2));
      const lift = edge < INNER_BARK ? ray ** 60 * 14 : 0;
      // Speckle and a faint darkening toward the bark (sawn ends weather at the edge).
      const grain = (hash(px, py, seed) - 0.5) * 16;
      const dusk = edge > 0.9 ? (edge - 0.9) * 60 : 0;
      const at = (py * size + px) * 4;
      image.data[at] = red + lift + grain - dusk;
      image.data[at + 1] = green + lift + grain - dusk;
      image.data[at + 2] = blue + lift * 0.8 + grain - dusk;
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * The split face of a log: from the pith (left) to the bark (right), the log's height going up.
 * Each year shows as a streak running up the log, wavering a little; fine long grain over it.
 */
export function drawSplitGrain(
  width: number,
  height: number,
  rings: number,
  seed: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const { rng, years } = treeOf(rings, seed);
  const sway = wobble(rng, 4, 0.08);
  const fibres = Array.from({ length: width }, (_, column) => (hash(column, 0, seed) - 0.5) * 18);
  const image = context.createImageData(width, height);
  for (let py = 0; py < height; py++) {
    const v = py / height;
    for (let px = 0; px < width; px++) {
      const r = (px + 0.5) / width;
      const year = years(r) + sway(v * TAU + r * 3) * (0.4 + r) * 0.3;
      const [red, green, blue] = woodAt(r, year);
      const fibre = (fibres[px] ?? 0) + (hash(px, py >> 3, seed) - 0.5) * 8;
      const at = (py * width + px) * 4;
      image.data[at] = red + fibre;
      image.data[at + 1] = green + fibre;
      image.data[at + 2] = blue + fibre * 0.8;
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A stave's length in world units: the same wherever one is drawn (split off at the workbench,
 * hardened at the fire pit), so the stations agree.
 */
export const STAVE_LENGTH = 1.05;

/** World units one tile of the bark texture covers, round the log and up it. */
export const BARK_TILE = 1.4;

let bark: { map: THREE.Texture; normalMap: THREE.Texture } | undefined;

/** The bark textures (loaded once, shared by every log and the block), tiling both ways. */
export function barkTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  if (bark) return bark;
  const loader = new THREE.TextureLoader();
  const load = (path: string, color: boolean) => {
    const texture = loader.load(path);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  bark = {
    map: load('textures/wood/bark.jpg', true),
    normalMap: load('textures/wood/bark_normal.jpg', false),
  };
  return bark;
}

/**
 * Sets a cylinder side's UVs to world units over the bark tile, so the bark is the same size on
 * every piece and lines up across the wedges of a split log (`thetaStart` and `thetaLength` as
 * the geometry was made).
 */
export function barkUvs(
  geometry: THREE.BufferGeometry,
  radius: number,
  height: number,
  thetaStart: number,
  thetaLength: number,
): void {
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index++) {
    const around = (thetaStart + uv.getX(index) * thetaLength) * radius;
    uv.setXY(index, around / BARK_TILE, (uv.getY(index) * height) / BARK_TILE);
  }
  uv.needsUpdate = true;
}
