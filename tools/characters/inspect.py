"""Prints what a character kit's glTF or GLB holds, to pick parts and clips: each mesh's triangles,
morph targets and material, each material's maps, each skin's bone count and the animations' names
and lengths. Reads the files as data only.
usage: python3 -I inspect.py [--anims] <file.gltf|file.glb> [...]"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'))
from gltflib import Source  # noqa: E402


def report(path, show_anims):
    src = Source(path)
    j = src.json
    print(os.path.basename(path))
    total = 0
    for i, mesh in enumerate(j.get('meshes', [])):
        tris = 0
        mats = []
        targets = 0
        attrs = []
        for p in mesh['primitives']:
            if 'indices' in p:
                tris += j['accessors'][p['indices']]['count'] // 3
            mats.append(j['materials'][p['material']].get('name', '?') if 'material' in p else '-')
            targets = max(targets, len(p.get('targets', [])))
            attrs = sorted(p['attributes'])
        total += tris
        print(f'  mesh {mesh.get("name", i)}: {tris} tris, mats {mats}, morphs {targets}, attrs {attrs}')
    print(f'  total tris {total}')
    for m in j.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        maps = [k for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture') if k in m]
        maps += [k for k in ('baseColorTexture', 'metallicRoughnessTexture') if k in pbr]
        uris = []
        if 'baseColorTexture' in pbr:
            tex = j['textures'][pbr['baseColorTexture']['index']]
            uris.append(j['images'][tex['source']].get('uri', '<embedded>'))
        print(f'  material {m.get("name")}: {maps} base {uris} factor {pbr.get("baseColorFactor")} '
              f'alpha {m.get("alphaMode", "OPAQUE")}')
    for s in j.get('skins', []):
        print(f'  skin {s.get("name")}: {len(s["joints"])} joints')
    print(f'  nodes {len(j.get("nodes", []))}')
    anims = j.get('animations', [])
    print(f'  animations {len(anims)}')
    if show_anims:
        for a in anims:
            t = 0
            n = 0
            for sm in a['samplers']:
                acc = j['accessors'][sm['input']]
                t = max(t, acc.get('max', [0])[0])
                n = max(n, acc['count'])
            print(f'    {a.get("name")}: {t:.2f}s, {len(a["channels"])} channels, {n} keys')


args = [a for a in sys.argv[1:] if a != '--anims']
for p in args:
    report(p, '--anims' in sys.argv)
