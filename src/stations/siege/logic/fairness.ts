import {
  GameDataError,
  type GameData,
  type Siege,
  type SiegeFort,
  type SiegeGuard,
} from '../../../data';
import {
  launchFrom,
  muzzleAt,
  siegeWeapon,
  type Aim,
  type Launch,
  type Spot,
  type Vec3,
} from './throw';

// Is a fort fair? General checks that hold for any fort (hand-built now, assembled at random one
// day): walls block shots, the banner can't be reached before the last position, and every guard
// can be. Pure geometry over the fort as it stands, so they run at startup in no time.

/** A box in the fort: a block or a guard. */
interface Box {
  min: Vec3;
  max: Vec3;
  kind: 'block' | 'guard';
  index: number;
  /** The piece kind it belongs to. */
  piece: string;
}

export interface FortProblem {
  path: (string | number)[];
  message: string;
}

const DEG = Math.PI / 180;
/**
 * Seconds between the points a flight is checked at: straight lines between them (exact against
 * the boxes) sag from the true arc by under a millimetre.
 */
const FLIGHT_STEP = 0.02;
const FLIGHT_SECONDS = 4;
/**
 * Degrees between the tilts tried when looking for the one that sends a spear through a point,
 * and the halvings that narrow each find down (to a few thousandths of a degree).
 */
const TILT_STEP = 0.5;
const TILT_HALVINGS = 8;
/** Pieces that are quick to break through: the keep must stay out of reach even with them gone. */
const GATES = new Set(['gate', 'cover']);
/** Pieces that are cover to be broken through: a guard behind them counts as in reach. */
const BREAKABLE = new Set(['wall', 'gate', 'cover']);

/** Every problem with a fort's fairness, for the startup check and for a fort generator. */
export function fortProblems(siege: Siege, fort: SiegeFort): FortProblem[] {
  const weapon = siegeWeapon(siege);
  const gravity = siege.physics.gravity;
  const radius = siege.projectile.radius;
  const stray = siege.feel.barrageSpeedStray;
  const speeds = [weapon.speed * (1 - stray), weapon.speed, weapon.speed * (1 + stray)];
  const boxes = fortBoxes(siege, fort);
  const problems: FortProblem[] = [];
  const last = fort.positions.length - 1;

  /** The aims that send a spear at `speed` from `spot` through `point`, if any. */
  const found = new Map<string, Aim[]>();
  const aimsThrough = (spot: Spot, point: Vec3, speed: number): Aim[] => {
    const key = `${String(spot.x)} ${String(spot.z)} ${String(point.x)} ${String(point.y)} ${String(point.z)} ${String(speed)}`;
    const known = found.get(key);
    if (known) return known;
    const yaw = Math.atan2(point.x - spot.x, -(point.z - spot.z));
    const miss = (degrees: number) =>
      heightAt(launchFrom(spot, { yaw, tilt: degrees * DEG }, speed, 0, weapon), point, gravity) -
      point.y;
    // Coarse steps over the tilts, then each crossing narrowed down by halves.
    const aims: Aim[] = [];
    let low = weapon.tilt.min;
    let before = miss(low);
    for (let high = low + TILT_STEP; low < weapon.tilt.max; high += TILT_STEP) {
      const top = Math.min(high, weapon.tilt.max);
      const after = miss(top);
      if (Math.sign(after) !== Math.sign(before)) {
        let [from, to] = [low, top];
        for (let half = 0; half < TILT_HALVINGS; half++) {
          const middle = (from + to) / 2;
          if (Math.sign(miss(middle)) === Math.sign(before)) from = middle;
          else to = middle;
        }
        aims.push({ yaw, tilt: ((from + to) / 2) * DEG });
      }
      [low, before] = [top, after];
    }
    found.set(key, aims);
    return aims;
  };
  /** Whether a spear from `spot` can hit `target` at `point` first (passing nothing else). */
  const reaches = (
    spot: Spot,
    point: Vec3,
    target: Box,
    ignore: (box: Box) => boolean,
    set: Box[] = boxes,
  ) =>
    speeds.some((speed) =>
      aimsThrough(spot, point, speed).some(
        (aim) =>
          flightHit(launchFrom(spot, aim, speed, 0, weapon), set, radius, gravity, ignore) ===
          target,
      ),
    );

  // The banner, and the keep (or whatever it stands on): out of reach, and the banner out of the
  // weapon's sight, from every spot before the last, even with every gate broken.
  const banner = boxes.find(
    (box) => box.kind === 'block' && fort.blocks[box.index]?.banner === true,
  );
  if (banner) {
    const piece = fort.blocks[banner.index]?.piece;
    const holders = boxes.filter(
      (box) => box.kind === 'block' && fort.blocks[box.index]?.piece === piece,
    );
    const pointsOn = (box: Box) =>
      [0.15, 0.5, 0.85].map((share) => ({
        x: (box.min.x + box.max.x) / 2,
        y: box.min.y + (box.max.y - box.min.y) * share,
        z: box.max.z,
      }));
    const modes = [() => false, (box: Box) => box.kind === 'block' && GATES.has(box.piece)];
    fort.positions.forEach((position, positionIndex) => {
      if (positionIndex >= last) return;
      position.spots.forEach(([x, z], spotIndex) => {
        const spot = { x, z };
        const path = ['siege', 'forts', fort.id, 'positions', positionIndex, 'spots', spotIndex];
        const hit = modes.some((ignore) =>
          holders.some((box) => pointsOn(box).some((point) => reaches(spot, point, box, ignore))),
        );
        if (hit) {
          problems.push({ path, message: 'The keep can be hit before the last position' });
          return;
        }
        const seen = modes.some((ignore) =>
          pointsOn(banner).some((point) => {
            const muzzle = muzzleAt(spot, straightAt(spot, point, weapon.pivotHeight), weapon);
            return lineHit(muzzle, point, boxes, radius, ignore) === banner;
          }),
        );
        if (seen)
          problems.push({ path, message: 'The banner is in sight before the last position' });
      });
    });
  }

  // Every guard can be hit from one of its position's spots, at least once the cover in front of
  // it is broken.
  fort.positions.forEach((position, positionIndex) => {
    const guards = boxes.filter(
      (box) => box.kind === 'guard' && guardPosition(fort, box.index) === positionIndex,
    );
    guards.forEach((guard) => {
      // Anywhere along his walk will do (he'll be there some time).
      const hittable = (ignore: (box: Box) => boolean) =>
        posesOf(guard, fort, POSE_STEP).some((pose) => {
          const set = boxes.map((box) => (box === guard ? pose : box));
          return position.spots.some(([x, z]) =>
            guardPoints(pose).some((point) => reaches({ x, z }, point, pose, ignore, set)),
          );
        });
      if (
        !hittable(() => false) &&
        !hittable((box) => box.kind === 'block' && BREAKABLE.has(box.piece))
      ) {
        problems.push({
          path: ['siege', 'forts', fort.id, 'positions', positionIndex],
          message: `A guard (${String(guard.index)}) can't be hit from any spot, even with the walls down`,
        });
      }
    });
  });

  // A position's guards are out of reach and out of sight from every spot of the positions before
  // it, even with every gate and low wall broken: or they're shot from afar, and the position is
  // won before the weapon gets there.
  const gatesDown = (box: Box) => box.kind === 'block' && GATES.has(box.piece);
  fort.positions.forEach((_, positionIndex) => {
    const guards = boxes.filter(
      (box) => box.kind === 'guard' && guardPosition(fort, box.index) === positionIndex,
    );
    fort.positions.slice(0, positionIndex).forEach((earlier, earlierIndex) => {
      earlier.spots.forEach(([x, z], spotIndex) => {
        const spot = { x, z };
        // Nowhere along his walk.
        const exposed = guards.filter((guard) =>
          posesOf(guard, fort, POSE_STEP).some((pose) => {
            const set = boxes.map((box) => (box === guard ? pose : box));
            return [() => false, gatesDown].some((ignore) =>
              guardPoints(pose).some((point) => {
                const muzzle = muzzleAt(spot, straightAt(spot, point, weapon.pivotHeight), weapon);
                return (
                  lineHit(muzzle, point, set, 0, ignore) === pose ||
                  reaches(spot, point, pose, ignore, set)
                );
              }),
            );
          }),
        );
        for (const guard of exposed) {
          problems.push({
            path: ['siege', 'forts', fort.id, 'positions', earlierIndex, 'spots', spotIndex],
            message: `A guard of position ${String(positionIndex + 1)} (${String(guard.index)}) can be seen or hit from here`,
          });
        }
      });
    });
  });

  return problems;
}

/** Fails loudly at startup if any fort is unfair. */
export function checkForts(data: Pick<GameData, 'siege'>): void {
  const problems = data.siege.forts.flatMap((fort) => fortProblems(data.siege, fort));
  if (problems.length > 0) {
    const list = problems.map((problem) => `${problem.path.join('.')}: ${problem.message}`);
    throw new GameDataError(`Siege forts aren't fair:\n${list.join('\n')}`);
  }
}

/** Every block and guard of a fort, as boxes where it stands. */
function fortBoxes(siege: Siege, fort: SiegeFort): Box[] {
  const blocks = fort.blocks.map((block, index): Box => ({
    min: vec(block.at.map((value, axis) => value - (block.size[axis] ?? 0) / 2)),
    max: vec(block.at.map((value, axis) => value + (block.size[axis] ?? 0) / 2)),
    kind: 'block',
    index,
    piece: block.pieceKind,
  }));
  const [width, height, depth] = siege.guard.size;
  let index = 0;
  const guards = fort.positions.flatMap((position) =>
    position.guards.map((guard): Box => {
      const [x, y, z] = guard.at;
      return {
        min: { x: x - width / 2, y, z: z - depth / 2 },
        max: { x: x + width / 2, y: y + height, z: z + depth / 2 },
        kind: 'guard',
        index: index++,
        piece: fort.pieces[guard.piece]?.kind ?? '',
      };
    }),
  );
  return [...blocks, ...guards];
}

/** How far apart (m) the places along a walkway are that a walking guard is checked at. */
const POSE_STEP = 0.5;

/** A guard where he stands, or, on a walkway, at every `step` along his walk. */
function posesOf(guard: Box, fort: SiegeFort, step: number): Box[] {
  const walk = fortGuard(fort, guard.index)?.walk;
  if (!walk) return [guard];
  const middle = (guard.min.x + guard.max.x) / 2;
  const count = Math.max(Math.round((walk[1] - walk[0]) / step), 1);
  return Array.from({ length: count + 1 }, (_, index) => {
    const shift = walk[0] + ((walk[1] - walk[0]) * index) / count - middle;
    return {
      ...guard,
      min: { ...guard.min, x: guard.min.x + shift },
      max: { ...guard.max, x: guard.max.x + shift },
    };
  });
}

/** Guard `index` (counting through every position's guards in order). */
function fortGuard(fort: SiegeFort, index: number): SiegeGuard | undefined {
  return fort.positions.flatMap((position) => position.guards)[index];
}

/** Points up the front of a guard (legs, chest, head) that shots and sight lines are tried at. */
function guardPoints(guard: Box): Vec3[] {
  return [0.25, 0.5, 0.75].map((share) => ({
    x: (guard.min.x + guard.max.x) / 2,
    y: guard.min.y + (guard.max.y - guard.min.y) * share,
    z: guard.max.z,
  }));
}

/** The position guard `index` (counting through every position's guards in order) guards. */
function guardPosition(fort: SiegeFort, index: number): number {
  let left = index;
  for (let position = 0; position < fort.positions.length; position++) {
    const count = fort.positions[position]?.guards.length ?? 0;
    if (left < count) return position;
    left -= count;
  }
  return -1;
}

function vec(values: number[]): Vec3 {
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
}

/** The aim straight at `point` (no drop): the weapon's sight line. */
function straightAt(spot: Spot, point: Vec3, pivot: number): Aim {
  const dx = point.x - spot.x;
  const dz = point.z - spot.z;
  return { yaw: Math.atan2(dx, -dz), tilt: Math.atan2(point.y - pivot, Math.hypot(dx, dz)) };
}

/** A flight's height when it's as far out (over the ground) as `point`. */
function heightAt(launch: Launch, point: Vec3, gravity: number): number {
  const across = Math.hypot(launch.velocity.x, launch.velocity.z);
  const out = Math.hypot(point.x - launch.position.x, point.z - launch.position.z);
  const t = out / across;
  return launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t;
}

/** The first box a flight runs into (a spear `radius` thick), or undefined if it hits nothing. */
function flightHit(
  launch: Launch,
  boxes: Box[],
  radius: number,
  gravity: number,
  ignore: (box: Box) => boolean,
): Box | undefined {
  // Over the ground a flight runs straight: only the boxes near that line can be hit, so the
  // steps below look at those alone.
  const { position: start, velocity } = launch;
  const landing =
    (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * gravity * Math.max(start.y, 0))) / gravity;
  const end = Math.min(landing + FLIGHT_STEP, FLIGHT_SECONDS);
  const near = boxes.filter(
    (box) =>
      Math.max(start.x, start.x + velocity.x * end) >= box.min.x - radius &&
      Math.min(start.x, start.x + velocity.x * end) <= box.max.x + radius &&
      Math.max(start.z, start.z + velocity.z * end) >= box.min.z - radius &&
      Math.min(start.z, start.z + velocity.z * end) <= box.max.z + radius,
  );
  let from = launch.position;
  for (let t = FLIGHT_STEP; t <= FLIGHT_SECONDS; t += FLIGHT_STEP) {
    const to = {
      x: launch.position.x + launch.velocity.x * t,
      y: launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t,
      z: launch.position.z + launch.velocity.z * t,
    };
    const hit = lineHit(from, to, near, radius, ignore);
    if (hit) return hit;
    if (to.y < 0) return undefined;
    from = to;
  }
  return undefined;
}

/** The first box the segment from `a` to `b` runs into (`radius` thick), if any. */
function lineHit(
  a: Vec3,
  b: Vec3,
  boxes: Box[],
  radius: number,
  ignore: (box: Box) => boolean,
): Box | undefined {
  let best: { box: Box; t: number } | undefined;
  for (const box of boxes) {
    // Most boxes are nowhere near: a quick look first.
    if (
      Math.max(a.x, b.x) < box.min.x - radius ||
      Math.min(a.x, b.x) > box.max.x + radius ||
      Math.max(a.z, b.z) < box.min.z - radius ||
      Math.min(a.z, b.z) > box.max.z + radius ||
      ignore(box)
    ) {
      continue;
    }
    const t = segmentEnters(a, b, box, radius);
    if (t !== undefined && (!best || t < best.t)) best = { box, t };
  }
  return best?.box;
}

/** Where (0 to 1 along it) the segment `a`–`b` first enters `box` grown by `radius`, if it does. */
function segmentEnters(a: Vec3, b: Vec3, box: Box, radius: number): number | undefined {
  let enter = 0;
  let leave = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const start = a[axis];
    const move = b[axis] - start;
    const low = box.min[axis] - radius;
    const high = box.max[axis] + radius;
    if (Math.abs(move) < 1e-12) {
      if (start < low || start > high) return undefined;
      continue;
    }
    let near = (low - start) / move;
    let far = (high - start) / move;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    leave = Math.min(leave, far);
    if (enter > leave) return undefined;
  }
  return enter;
}
