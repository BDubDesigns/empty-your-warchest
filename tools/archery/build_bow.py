"""Builds the hunting stand's bow (public/models/quaternius/bow_wooden.glb) from Quaternius's Medieval
Weapons pack (CC0, https://quaternius.itch.io/lowpoly-medieval-weapons): Bow_Wooden.obj and its
.mtl, read as plain text only. The OBJ has no textures, just three colours: the limbs (DarkWood),
the grip's wrap (LightWood) and the string (White). The string is left out: the game draws its own,
so it can pull back to the arrow's nock. Where the string met each tip is kept as an empty node
(nock_top, nock_bottom), so the drawn string starts there.

The bow is turned and scaled to the game's own frame (src/stations/archery/three/bow.ts): its limbs
along x, 1 long tip to tip, the arrow pointing up +y, the string below the grip (-y), the grip at
the origin. Faces are split into triangles, with the OBJ's own normals.
usage: python3 -I build_bow.py <the pack's OBJ dir> <the game's public/models/quaternius dir>"""
import json, os, struct, sys

SOURCE, OUT = sys.argv[1:3]
OBJ = os.path.join(SOURCE, 'Bow_Wooden.obj')
MTL = os.path.join(SOURCE, 'Bow_Wooden.mtl')
PARTS = {'DarkWood': 'limbs', 'LightWood': 'grip'}
STRING = 'White'


def read_mtl(path):
    colours, name = {}, None
    for line in open(path, encoding='utf-8'):
        part = line.split()
        if not part:
            continue
        if part[0] == 'newmtl':
            name = part[1]
        elif part[0] == 'Kd' and name:
            colours[name] = [float(value) for value in part[1:4]]
    return colours


def read_obj(path):
    positions, normals, faces, material = [], [], {}, None
    for line in open(path, encoding='utf-8'):
        part = line.split()
        if not part:
            continue
        if part[0] == 'v':
            positions.append(tuple(float(value) for value in part[1:4]))
        elif part[0] == 'vn':
            normals.append(tuple(float(value) for value in part[1:4]))
        elif part[0] == 'usemtl':
            material = part[1]
        elif part[0] == 'f':
            corners = []
            for corner in part[1:]:
                index = corner.split('/')
                corners.append((int(index[0]) - 1, int(index[2]) - 1 if len(index) > 2 and index[2] else None))
            faces.setdefault(material, []).append(corners)
    return positions, normals, faces


def triangles_of(corners):
    """Splits a face into triangles by ear clipping, flat in its own plane: the bow's faces with 5
    and 6 corners aren't all convex, and a plain fan over them would cross itself."""
    pts = [positions[i] for i, _ in corners]
    # The face's normal (Newell's method), to flatten it onto the plane it mostly faces.
    nx = ny = nz = 0.0
    for k, p in enumerate(pts):
        q = pts[(k + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    drop = max(range(3), key=lambda axis: abs((nx, ny, nz)[axis]))
    keep = [axis for axis in range(3) if axis != drop]
    flat = [(p[keep[0]], p[keep[1]]) for p in pts]
    area = sum(flat[k][0] * flat[(k + 1) % len(flat)][1] - flat[(k + 1) % len(flat)][0] * flat[k][1] for k in range(len(flat)))
    sign = 1 if area > 0 else -1
    cross = lambda o, a, b: ((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])) * sign

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    left = list(range(len(pts)))
    out = []
    guard = 0
    while len(left) > 3 and guard < 1000:
        guard += 1
        for k in range(len(left)):
            a, b, c = left[k - 1], left[k], left[(k + 1) % len(left)]
            if cross(flat[a], flat[b], flat[c]) <= 0:
                continue
            if any(inside(flat[o], flat[a], flat[b], flat[c]) for o in left if o not in (a, b, c)):
                continue
            out.append((a, b, c))
            left.pop(k)
            break
        else:
            break
    for k in range(1, len(left) - 1):
        out.append((left[0], left[k], left[k + 1]))
    return out


def turn(point):
    """The OBJ's frame to the game's: its length (y) along x, its curve (x, the string's side
    positive) down -y, its thickness (z) staying z."""
    x, y, z = point
    return (y, -x, z)


positions, normals, faces = read_obj(OBJ)
colours = read_mtl(MTL)

# Scaled to 1 tip to tip; the grip (the middle of its wrap) at the origin.
ys = [positions[i][1] for corners in faces['DarkWood'] for i, _ in corners]
span = max(ys) - min(ys)
grip = [positions[i] for corners in faces['LightWood'] for i, _ in corners]
centre = tuple(sum(p[axis] for p in grip) / len(grip) for axis in range(3))


def place(point):
    return tuple(value / span for value in turn(tuple(point[a] - centre[a] for a in range(3))))


# Where the string meets each tip: its highest and lowest ends.
string = [positions[i] for corners in faces[STRING] for i, _ in corners]
top = max(string, key=lambda p: p[1])
bottom = min(string, key=lambda p: p[1])

blob = bytearray()
accessors, views, meshes, nodes, materials = [], [], [], [], []


def add(data, component, count, kind, target, extra=None):
    while len(blob) % 4:
        blob.append(0)
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
    blob.extend(data)
    accessor = {'bufferView': len(views) - 1, 'componentType': component, 'count': count, 'type': kind}
    accessor.update(extra or {})
    accessors.append(accessor)
    return len(accessors) - 1


for material, name in PARTS.items():
    verts, norms = [], []
    for corners in faces[material]:
        for a, b, c in triangles_of(corners):
            for index, normal in (corners[a], corners[b], corners[c]):
                verts.append(place(positions[index]))
                norms.append(turn(normals[normal]) if normal is not None else (0.0, 0.0, 1.0))
    count = len(verts)
    flat = [value for vert in verts for value in vert]
    lows = [min(v[a] for v in verts) for a in range(3)]
    highs = [max(v[a] for v in verts) for a in range(3)]
    position = add(struct.pack(f'<{len(flat)}f', *flat), 5126, count, 'VEC3', 34962, {'min': lows, 'max': highs})
    normal = add(struct.pack(f'<{count * 3}f', *[v for n in norms for v in n]), 5126, count, 'VEC3', 34962)
    materials.append({
        'name': name,
        'pbrMetallicRoughness': {'baseColorFactor': colours[material] + [1.0], 'metallicFactor': 0, 'roughnessFactor': 1},
    })
    meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': position, 'NORMAL': normal}, 'material': len(materials) - 1}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})

nodes.append({'name': 'nock_top', 'translation': list(place(top))})
nodes.append({'name': 'nock_bottom', 'translation': list(place(bottom))})
nodes.append({'name': 'bow', 'children': list(range(len(nodes)))})

while len(blob) % 4:
    blob.append(0)
gltf = {
    'asset': {'version': '2.0', 'generator': 'tools/archery/build_bow.py'},
    'scene': 0,
    'scenes': [{'nodes': [len(nodes) - 1]}],
    'nodes': nodes,
    'meshes': meshes,
    'materials': materials,
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': len(blob)}],
}
text = json.dumps(gltf, separators=(',', ':')).encode()
while len(text) % 4:
    text += b' '
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'bow_wooden.glb')
with open(path, 'wb') as out:
    out.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(blob)))
    out.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
    out.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))
triangles = sum(a['count'] for a in accessors if 'min' in a) // 3
print(f'{path}: {os.path.getsize(path)} bytes, {triangles} triangles, nocks {place(top)} {place(bottom)}')
