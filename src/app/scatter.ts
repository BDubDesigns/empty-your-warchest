import * as THREE from 'three';

/**
 * Scenery in bulk: many copies of one model drawn with instancing (the GPU draws every copy of a
 * mesh in a single call, so a thousand grass clumps cost about as much as one), in a matte
 * material, optionally swaying in a shared wind. For any scene's dressing; nothing here is in play.
 */

/** One copy of a model: where it stands on the ground (world x, z), how tall, which way it faces. */
export interface Placement {
  x: number;
  z: number;
  height: number;
  turn: number;
}

/** The wind's clock (in gusts), shared by every swaying material: set it once a frame. */
export const windTime = { value: 0 };

/**
 * Copies of `source` at `placements`, each scaled to its height and standing on the ground.
 * `sway` is how far the tips move in the wind, as a share of the height (0 for still things);
 * `grass` lights it as if it faced straight up (the usual trick for grass, whose upright blades
 * would otherwise catch little light and look dark against the ground they grow from) and reads
 * its colour from a palette texture (thin stripes of colour) without mipmaps, the shrunken copies
 * a GPU uses at a distance, where the thin stripes would blur into the blank space beside them.
 */
export function scatter(
  source: THREE.Object3D,
  placements: readonly Placement[],
  { sway = 0, grass = false }: { sway?: number; grass?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  if (placements.length === 0) return group;
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Model space to a model 1 unit tall, centred on its middle and standing on y = 0.
  const fit = new THREE.Matrix4()
    .makeScale(1 / size.y, 1 / size.y, 1 / size.y)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const place = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const materials = new Map<THREE.Material, THREE.Material>();
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    let geometry = child.geometry as THREE.BufferGeometry;
    if (grass) {
      geometry = geometry.clone();
      const normal = geometry.getAttribute('normal');
      for (let index = 0; index < normal.count; index++) normal.setXYZ(index, 0, 1, 0);
    }
    const original = child.material as THREE.Material | THREE.Material[];
    const matte = (material: THREE.Material) => {
      let made = materials.get(material);
      if (!made) {
        made = matteCopy(material, sway, box.min.y, size.y);
        const map = made instanceof THREE.MeshLambertMaterial ? made.map : null;
        if (grass && map) {
          map.generateMipmaps = false;
          map.minFilter = THREE.LinearFilter;
          map.needsUpdate = true;
        }
        materials.set(material, made);
      }
      return made;
    };
    const mesh = new THREE.InstancedMesh(
      geometry,
      Array.isArray(original) ? original.map(matte) : matte(original),
      placements.length,
    );
    placements.forEach((placement, index) => {
      turn.setFromAxisAngle(up, placement.turn);
      place.compose(
        new THREE.Vector3(placement.x, 0, placement.z),
        turn,
        new THREE.Vector3(placement.height, placement.height, placement.height),
      );
      mesh.setMatrixAt(index, place.clone().multiply(fit).multiply(child.matrixWorld));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    // Spread over the whole scene, so culling would rarely skip it: don't spend time checking.
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

/**
 * A matte (Lambert, cheaper than the models' standard material) copy of a model's material with
 * its colour, texture and cut-out leaves; not its vertex colours, which in the nature
 * pack are a wind mask, not colour. With `sway`, its vertices bend in the wind, more toward
 * the top (`base` and `height` are the model's bottom and height in its own units), each copy at
 * its own point in the gust so a field ripples rather than nodding together.
 */
function matteCopy(
  material: THREE.Material,
  sway: number,
  base: number,
  height: number,
): THREE.Material {
  const lit = material instanceof THREE.MeshStandardMaterial ? material : undefined;
  const matte = new THREE.MeshLambertMaterial({
    color: lit?.color ?? 0xffffff,
    map: lit?.map ?? null,
    alphaTest: material.alphaTest,
    side: material.side,
  });
  if (sway <= 0) return matte;
  matte.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime;
    shader.uniforms.windBase = { value: base };
    shader.uniforms.windHeight = { value: height };
    shader.uniforms.windSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float windTime;
uniform float windBase;
uniform float windHeight;
uniform float windSway;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec2 windAt = instanceMatrix[3].xz;
  #else
  vec2 windAt = vec2(0.0);
  #endif
  float up = clamp((transformed.y - windBase) / windHeight, 0.0, 1.0);
  float gust = sin(windTime * 6.2832 + windAt.x * 0.35 + windAt.y * 0.25) * 0.7
    + sin(windTime * 15.0 + windAt.x * 1.3 + windAt.y * 0.9) * 0.3;
  float bend = up * up * windSway * windHeight * gust;
  transformed.x += bend;
  transformed.z += bend * 0.4;
}`,
      );
  };
  matte.customProgramCacheKey = () => 'wind';
  return matte;
}
