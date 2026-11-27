/**
 * Rapier, the physics engine the siege's rules run on: its cross-platform deterministic build, so
 * the same throws knock a fort down the same way on every phone. The package carries its
 * WebAssembly inline, so it works the same in the browser and in unit tests. It's loaded (and the
 * wasm started) once, on first use, and kept out of the main bundle.
 */
export type Physics = typeof import('@dimforge/rapier3d-deterministic-compat');

let loading: Promise<Physics> | undefined;

export function loadPhysics(): Promise<Physics> {
  loading ??= import('@dimforge/rapier3d-deterministic-compat').then(async (physics) => {
    await physics.init();
    return physics;
  });
  return loading;
}
