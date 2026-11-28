"""Prints each mesh's UV bounds (TEXCOORD_0), to see how much of its colour map it uses and whether
any of it tiles past 0..1 (which an atlas can't hold). Reads the files as data only.
usage: python3 -I uvs.py <file.gltf> [...]"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'))
from gltflib import Source  # noqa: E402

for path in sys.argv[1:]:
    src = Source(path)
    print(os.path.basename(path))
    for mesh in src.json.get('meshes', []):
        for p in mesh['primitives']:
            if 'TEXCOORD_0' not in p['attributes']:
                continue
            _, uv = src.values(p['attributes']['TEXCOORD_0'])
            us, vs = uv[0::2], uv[1::2]
            mat = src.json['materials'][p['material']].get('name') if 'material' in p else '-'
            print(f'  {mesh.get("name")} [{mat}]: u {min(us):.3f}..{max(us):.3f} v {min(vs):.3f}..{max(vs):.3f}')
