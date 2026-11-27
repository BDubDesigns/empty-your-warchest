// Cuts a glTF's triangles with meshoptimizer (through glTF Transform), keeping its look: welds
// matching vertices, then simplifies each mesh toward `ratio` of its triangles, stopping where the
// shape would change by more than `error` (a share of the mesh's size).
// Needs, pinned: @gltf-transform/core@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0
// usage: node simplify.mjs <in> <out> <ratio> <error>, from a folder with those installed.
import { NodeIO } from '@gltf-transform/core';
import { prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output, ratio, error] = process.argv.slice(2);

const io = new NodeIO();
const document = await io.read(input);
const count = () =>
  document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, prim) => sum + (prim.getIndices()?.getCount() ?? 0) / 3, 0);
const before = count();
await MeshoptSimplifier.ready;
await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: Number(error) }),
  prune({ keepAttributes: true, keepLeaves: true }),
);
await io.write(output, document);
console.log(`${input}: ${before} -> ${count()} triangles`);
