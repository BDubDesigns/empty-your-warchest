"""Prints each glTF's size (its bounds, after node transforms), triangle count and materials, to pick
and place kit pieces. Reads the files as data only.
usage: python3 -I inspect.py <gltf dir> <name> [<name> ...]"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'))
from gltflib import Source  # noqa: E402


def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def local(node):
    """A node's matrix (column-major), from its matrix or its translation, rotation and scale."""
    if 'matrix' in node:
        return node['matrix']
    tx, ty, tz = node.get('translation', [0, 0, 0])
    qx, qy, qz, qw = node.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = node.get('scale', [1, 1, 1])
    r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
         2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
         2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
         tx, ty, tz, 1]
    for i in range(3):
        r[i] *= sx
        r[4 + i] *= sy
        r[8 + i] *= sz
    return r


def report(path):
    src = Source(path)
    lo = [1e9] * 3
    hi = [-1e9] * 3
    tris = 0
    mats = set()

    def visit(i, parent):
        nonlocal tris
        n = src.json['nodes'][i]
        m = mat_mul(parent, local(n))
        if 'mesh' in n:
            for p in src.json['meshes'][n['mesh']]['primitives']:
                acc = src.json['accessors'][p['attributes']['POSITION']]
                for corner in range(8):
                    c = [acc['max'][k] if corner >> k & 1 else acc['min'][k] for k in range(3)]
                    w = [m[r] * c[0] + m[4 + r] * c[1] + m[8 + r] * c[2] + m[12 + r] for r in range(3)]
                    for k in range(3):
                        lo[k] = min(lo[k], w[k])
                        hi[k] = max(hi[k], w[k])
                if 'indices' in p:
                    tris += src.json['accessors'][p['indices']]['count'] // 3
                else:
                    tris += acc['count'] // 3
                if 'material' in p:
                    mats.add(src.json['materials'][p['material']].get('name', '?'))
        for c in n.get('children', []):
            visit(c, m)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for i in src.json['scenes'][src.json.get('scene', 0)]['nodes']:
        visit(i, ident)
    f = lambda v: '[' + ', '.join(f'{x:.2f}' for x in v) + ']'
    print(f'{os.path.basename(path)}: min {f(lo)} max {f(hi)} tris {tris} mats {sorted(mats)}')


folder = sys.argv[1]
for name in sys.argv[2:]:
    report(os.path.join(folder, name if name.endswith(('.gltf', '.glb')) else name + '.gltf'))
