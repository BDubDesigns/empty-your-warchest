import { GameDataError, type GameData, type Siege, type SiegeFort } from '../../../data';
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
/** Degrees between the tilts tried when looking for the one that sends a spear through a point. */
const TILT_STEP = 0.05;
/** Pieces that are quick to break through: the keep must stay out of reach even with them gone. */
const GATES = new Set(['gate', 'cover']);
/** Pieces that are cover to be broken through: a guard behind them counts as in reach. */
const BREAKABLE = new Set(['wall', 'gate', 'cover']);
/** Pieces a shot has to get past: its crenels must be higher than any shot can be there. */
const BLOCKING = new Set(['wall', 'gate']);

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
  const aimsThrough = (spot: Spot, point: Vec3, speed: number): Aim[] => {
    const yaw = Math.atan2(point.x - spot.x, -(point.z - spot.z));
    const found: Aim[] = [];
    let before: number | undefined;
    for (let degrees = weapon.tilt.min; degrees <= weapon.tilt.max; degrees += TILT_STEP) {
      const aim = { yaw, tilt: degrees * DEG };
      const launch = launchFrom(spot, aim, speed, 0, weapon);
      const miss = heightAt(launch, point, gravity) - point.y;
      if (before !== undefined && Math.sign(miss) !== Math.sign(before)) found.push(aim);
      before = miss;
    }
    return found;
  };
  /** Whether a spear from `spot` can hit `target` at `point` first (passing nothing else). */
  const reaches = (spot: Spot, point: Vec3, target: Box, ignore: (box: Box) => boolean) =>
    speeds.some((speed) =>
      aimsThrough(spot, point, speed).some(
        (aim) =>
          flightHit(launchFrom(spot, aim, speed, 0, weapon), boxes, radius, gravity, ignore) ===
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
      const points = [0.25, 0.5, 0.75].map((share) => ({
        x: (guard.min.x + guard.max.x) / 2,
        y: guard.min.y + (guard.max.y - guard.min.y) * share,
        z: guard.max.z,
      }));
      const hittable = (ignore: (box: Box) => boolean) =>
        position.spots.some(([x, z]) =>
          points.some((point) => reaches({ x, z }, point, guard, ignore)),
        );
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

  // Walls block: from every spot, no shot clears the nearest wall in front of it.
  const [, stoneHeight] = siege.parts.stone;
  const fronts = fort.pieces.flatMap((piece) => {
    if (!BLOCKING.has(piece.kind)) return [];
    const top =
      piece.kind === 'wall'
        ? piece.courses * stoneHeight
        : piece.kind === 'gate'
          ? piece.height
          : 0;
    const depth = piece.kind === 'gate' ? siege.parts.gateDepth : siege.parts.stone[2];
    return [{ z: piece.at[1] + depth / 2, top }];
  });
  fort.positions.forEach((position, positionIndex) => {
    position.spots.forEach(([, z], spotIndex) => {
      const ahead = fronts.filter((front) => front.z < z);
      const nearest = Math.max(...ahead.map((front) => front.z));
      ahead
        .filter((front) => front.z >= nearest - 0.5)
        .forEach((front) => {
          const highest = highestAt(z - front.z, weapon, speeds, gravity) + radius;
          if (highest >= front.top) {
            problems.push({
              path: ['siege', 'forts', fort.id, 'positions', positionIndex, 'spots', spotIndex],
              message: `A shot can clear the wall in front (${highest.toFixed(2)} m over a ${front.top.toFixed(2)} m wall)`,
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

/** The highest any shot can be `distance` metres out in front of the weapon. */
function highestAt(
  distance: number,
  weapon: ReturnType<typeof siegeWeapon>,
  speeds: number[],
  gravity: number,
): number {
  let best = -Infinity;
  for (const speed of speeds) {
    for (let degrees = weapon.tilt.min; degrees <= weapon.tilt.max; degrees += TILT_STEP * 5) {
      const launch = launchFrom({ x: 0, z: 0 }, { yaw: 0, tilt: degrees * DEG }, speed, 0, weapon);
      best = Math.max(best, heightAt(launch, { x: 0, y: 0, z: -distance }, gravity));
    }
  }
  return best;
}

/** The first box a flight runs into (a spear `radius` thick), or undefined if it hits nothing. */
function flightHit(
  launch: Launch,
  boxes: Box[],
  radius: number,
  gravity: number,
  ignore: (box: Box) => boolean,
): Box | undefined {
  let from = launch.position;
  for (let t = FLIGHT_STEP; t <= FLIGHT_SECONDS; t += FLIGHT_STEP) {
    const to = {
      x: launch.position.x + launch.velocity.x * t,
      y: launch.position.y + launch.velocity.y * t - 0.5 * gravity * t * t,
      z: launch.position.z + launch.velocity.z * t,
    };
    const hit = lineHit(from, to, boxes, radius, ignore);
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
