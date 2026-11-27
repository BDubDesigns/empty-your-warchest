"""Repacks a .gltf (with .bin and images beside it) as one GLB whose images stay files under
`prefix`, colour maps only: repack.py <in.gltf> <out.glb> <prefix>"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltflib import Builder, Source  # noqa: E402

src_path, out_path, prefix = sys.argv[1:4]
src = Source(src_path)
b = Builder(lambda base: prefix + base, colour_only=True)
scene = src.json['scenes'][src.json.get('scene', 0)]
name = src.json['nodes'][scene['nodes'][0]].get('name', 'Scene')
b.import_scene(src, name)
b.write(out_path)
