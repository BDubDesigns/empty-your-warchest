// Cuts a character's triangles with meshoptimizer (the copy the repo already installs, pinned by
// package-lock.json), for tools/characters/build.py. It only drops triangles and moves none of the
// vertices it keeps, so the skin's weights stay as they were. Seams (where a UV or normal splits a
// vertex) and the open edges where two parts meet stay put, so the parts don't tear apart.
// Reads one JSON job on stdin, writes one JSON answer on stdout:
//   in:  { positions: number[] (xyz), attributes: number[] (per vertex), stride: number,
//          weights: number[], parts: [{ indices: number[], target: number }], error: number }
//   out: { parts: [{ indices: number[], error: number }] }
// usage: python3 -I tools/characters/build.py runs it (node tools/characters/simplify.mjs)
import { MeshoptSimplifier } from 'meshoptimizer';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));

await MeshoptSimplifier.ready;
const positions = new Float32Array(job.positions);
const attributes = new Float32Array(job.attributes);
const parts = job.parts.map((part) => {
  const indices = new Uint32Array(part.indices);
  const [kept, error] = MeshoptSimplifier.simplifyWithAttributes(
    indices,
    positions,
    3,
    attributes,
    job.stride,
    job.weights,
    null,
    Math.max(3, Math.floor(part.target / 3) * 3),
    job.error,
    job.flags ?? [],
  );
  return { indices: Array.from(kept), error };
});
process.stdout.write(JSON.stringify({ parts }));
