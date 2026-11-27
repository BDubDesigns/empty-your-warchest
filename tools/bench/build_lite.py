"""Builds the stress test's "Village optimised" assets into <out>/village-lite/ from the same
downloaded packs as build.py (read as data only): colour-only materials, one atlas and one skinned
mesh per character, a light corner piece, and the characters' and trees' triangles cut with
meshoptimizer (simplify.mjs, run with node from <node-dir>, where its pinned packages are installed).
usage: python3 -I build_lite.py <assets-dir> <out-dir> <node-dir> <the game's public/models/quaternius>"""
import os, re, shutil, subprocess, sys
from array import array

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltflib import Builder, Source, filter_triangles  # noqa: E402

ASSETS, OUT, NODE_DIR, TREES = sys.argv[1:5]
VILLAGE = os.path.join(ASSETS, 'village/x/Medieval Village MegaKit[Standard]/glTF')
OUTFITS = os.path.join(ASSETS, 'outfits/x/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits')
BASE = os.path.join(ASSETS, 'basechars/x/Universal Base Characters[Standard]/Base Characters/Godot - UE')
LITE = os.path.join(OUT, 'village-lite')
QUAT_DROP = lambda name: name.startswith('COLOR_') or re.match(r'TEXCOORD_[1-9]', name) is not None

# The village's pieces, with a plain timber post at the fort's corners (12 triangles, not 3,100).
PIECES = [
    'Wall_UnevenBrick_Straight', 'Wall_UnevenBrick_Window_Wide_Round', 'Wall_UnevenBrick_Door_Round',
    'Corner_Exterior_Wood', 'Roof_Tower_RoundTiles',
    'Wall_Plaster_Straight', 'Wall_Plaster_WoodGrid', 'Wall_Plaster_Window_Wide_Flat', 'Window_Wide_Flat1',
    'Wall_Plaster_Door_Round', 'Door_1_Round', 'Roof_RoundTiles_6x6', 'Prop_Chimney',
    'Prop_Crate', 'Prop_Wagon', 'Prop_WoodenFence_Single', 'Prop_WoodenFence_Extension1',
]
OUTFIT_BASES = {'Male_Peasant': 'Superhero_Male', 'Female_Peasant': 'Superhero_Female',
                'Male_Ranger': 'Superhero_Male', 'Female_Ranger': 'Superhero_Female'}
# A character's atlas (1024 × 512 at full size): its outfit, then its skins, brows and eyes.
ATLAS = {'outfit': (0, 0, 512, 512), 'arms': (512, 0, 256, 256), 'head': (768, 0, 256, 256),
         'brows': (512, 256, 256, 256), 'eyes': (768, 256, 256, 256)}
ATLAS_SIZE = (1024, 512)
SIZES = {'tex-512': 512, 'tex-1024': 1024}

colour_maps = {}  # output name -> source path


def jpg(base):
    return re.sub(r'\.png$', '.jpg', base)


def source_image(src, uri):
    path = os.path.join(src.dir, uri)
    if not os.path.exists(path):
        path = path.replace('_png.png', '.png')
    return path


def colour_only(builder, src):
    """Material copies with only their colour map (the normal and roughness maps dropped)."""
    def material(index):
        mat = src.json['materials'][index]
        name = mat['name']
        if name in builder.materials:
            return builder.materials[name]
        pbr = mat.get('pbrMetallicRoughness', {})
        out = {'name': name, 'doubleSided': mat.get('doubleSided', False),
               'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1}}
        for key in ('alphaMode', 'alphaCutoff'):
            if key in mat:
                out[key] = mat[key]
        if 'baseColorFactor' in pbr:
            out['pbrMetallicRoughness']['baseColorFactor'] = pbr['baseColorFactor']
        if 'baseColorTexture' in pbr:
            tex = src.json['textures'][pbr['baseColorTexture']['index']]
            uri = src.json['images'][tex['source']]['uri']
            colour_maps[jpg(os.path.basename(uri))] = source_image(src, uri)
            out['pbrMetallicRoughness']['baseColorTexture'] = {'index': builder.texture(src, pbr['baseColorTexture']['index'])}
        builder.json['materials'].append(out)
        builder.materials[name] = len(builder.json['materials']) - 1
        return builder.materials[name]
    builder.material = lambda s, index: material(index)


def pieces():
    b = Builder(lambda base: 'tex-512/' + jpg(base))
    for name in PIECES:
        src = Source(os.path.join(VILLAGE, name + '.gltf'))
        colour_only(b, src)
        b.import_scene(src, name, drop_attr=QUAT_DROP)
    b.write(os.path.join(LITE, 'pieces.glb'))


# 4×4 matrices, column-major as glTF stores them.
def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def mat_inverse(m):
    rows = [[m[c * 4 + r] for c in range(4)] + [1.0 if r == i else 0.0 for i in range(4)] for r in range(4)]
    for col in range(4):
        pivot = max(range(col, 4), key=lambda r: abs(rows[r][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        p = rows[col][col]
        rows[col] = [v / p for v in rows[col]]
        for r in range(4):
            if r != col:
                f = rows[r][col]
                rows[r] = [a - f * b for a, b in zip(rows[r], rows[col])]
    return [rows[r][4 + c] for c in range(4) for r in range(4)]


def transform(m, x, y, z, w):
    return [m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w for r in range(3)]


def ibms(src, skin):
    _, flat = src.values(skin['inverseBindMatrices'])
    return [list(flat[i * 16:(i + 1) * 16]) for i in range(len(skin['joints']))]


def cell_for(material_name):
    if material_name in ('MI_Peasant', 'MI_Ranger'):
        return 'outfit'
    if material_name.startswith('MI_Regular'):
        return 'arms'
    if material_name.startswith('MI_Superhero'):
        return 'head'
    if material_name.startswith('MI_Hair'):
        return 'brows'
    if material_name == 'MI_Eyes':
        return 'eyes'
    raise ValueError(material_name)


def character(outfit, base_name):
    """One skinned mesh, one material: the outfit and the base character's head, the head's
    vertices moved into the outfit's bind space (by each vertex's strongest joint) so a single skin
    drives both, every part's UVs moved into its cell of the atlas."""
    src = Source(os.path.join(OUTFITS, outfit + '.gltf'))
    base = Source(os.path.join(BASE, base_name + '_FullBody.gltf'))
    b = Builder(lambda name: name)
    node_map = b.import_scene(src, outfit, meshes=False)
    outfit_skin = src.json['skins'][0]
    outfit_ibm = ibms(src, outfit_skin)
    base_skin = base.json['skins'][0]
    base_ibm = ibms(base, base_skin)
    names = [src.json['nodes'][j]['name'] for j in outfit_skin['joints']]
    base_names = [base.json['nodes'][j]['name'] for j in base_skin['joints']]
    assert names == base_names, 'the skeletons differ'
    rebase = [mat_mul(mat_inverse(o), h) for o, h in zip(outfit_ibm, base_ibm)]
    keep = (lambda p: p[1] > 1.40 and abs(p[0]) < 0.14) if outfit.startswith('Female') else (lambda p: p[1] > 1.44 and abs(p[0]) < 0.15)
    images = {}
    pos, nor, uv, joints, weights, index = array('f'), array('f'), array('f'), array('H'), array('f'), array('I')

    def add(s, prim, head):
        mat = s.json['materials'][prim['material']]
        cell = ATLAS[cell_for(mat['name'])]
        tex = s.json['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
        images[cell_for(mat['name'])] = source_image(s, s.json['images'][tex['source']]['uri'])
        if head and mat['name'].startswith('MI_Superhero'):
            made = filter_triangles(s, prim, keep, QUAT_DROP)
            if made is None:
                return
            attrs = {k: v for k, v in made[0].items()}
            idx = array('I' if made[1][0]['componentType'] == 5125 else 'H')
            idx.frombytes(made[1][1])
        else:
            attrs = {k: s.accessor(v) for k, v in prim['attributes'].items() if not QUAT_DROP(k)}
            _, idx = s.values(prim['indices'])

        def read(name, fmt):
            acc, data = attrs[name]
            arr = array(fmt)
            arr.frombytes(data)
            return arr
        p = read('POSITION', 'f')
        n = read('NORMAL', 'f')
        t = read('TEXCOORD_0', 'f')
        j = read('JOINTS_0', 'B' if attrs['JOINTS_0'][0]['componentType'] == 5121 else 'H')
        w = read('WEIGHTS_0', 'f')
        start = len(pos) // 3
        count = len(p) // 3
        x0, y0, cw, ch = cell
        pad = 2
        for v in range(count):
            px, py, pz = p[v * 3:v * 3 + 3]
            nx, ny, nz = n[v * 3:v * 3 + 3]
            if head:
                ws = w[v * 4:v * 4 + 4]
                strongest = j[v * 4 + max(range(4), key=lambda k: ws[k])]
                m = rebase[strongest]
                px, py, pz = transform(m, px, py, pz, 1)
                nx, ny, nz = transform(m, nx, ny, nz, 0)
            pos.extend((px, py, pz))
            nor.extend((nx, ny, nz))
            u = min(max(t[v * 2], 0), 1)
            vv = min(max(t[v * 2 + 1], 0), 1)
            uv.extend(((x0 + pad + u * (cw - 2 * pad)) / ATLAS_SIZE[0], (y0 + pad + vv * (ch - 2 * pad)) / ATLAS_SIZE[1]))
            joints.extend(int(k) for k in j[v * 4:v * 4 + 4])
            weights.extend(w[v * 4:v * 4 + 4])
        index.extend(i + start for i in idx)

    for node in src.json['nodes']:
        if 'mesh' in node:
            for prim in src.json['meshes'][node['mesh']]['primitives']:
                add(src, prim, False)
    for node in base.json['nodes']:
        if 'mesh' in node:
            for prim in base.json['meshes'][node['mesh']]['primitives']:
                add(base, prim, True)

    count = len(pos) // 3
    xs = [pos[0::3], pos[1::3], pos[2::3]]
    attributes = {
        'POSITION': b.add_data({'componentType': 5126, 'count': count, 'type': 'VEC3',
                                'min': [min(a) for a in xs], 'max': [max(a) for a in xs]}, pos.tobytes(), 34962),
        'NORMAL': b.add_data({'componentType': 5126, 'count': count, 'type': 'VEC3'}, nor.tobytes(), 34962),
        'TEXCOORD_0': b.add_data({'componentType': 5126, 'count': count, 'type': 'VEC2'}, uv.tobytes(), 34962),
        'JOINTS_0': b.add_data({'componentType': 5123, 'count': count, 'type': 'VEC4'}, joints.tobytes(), 34962),
        'WEIGHTS_0': b.add_data({'componentType': 5126, 'count': count, 'type': 'VEC4'}, weights.tobytes(), 34962),
    }
    indices = b.add_data({'componentType': 5125, 'count': len(index), 'type': 'SCALAR'}, index.tobytes(), 34963)
    atlas_name = f'Atlas_{outfit}.jpg'
    b.json['images'].append({'uri': 'tex-512/' + atlas_name})
    b.json['textures'].append({'source': 0})
    b.json['materials'].append({'name': f'MI_Atlas_{outfit}', 'doubleSided': True,
                                'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}})
    b.json['meshes'].append({'name': outfit, 'primitives': [{'attributes': attributes, 'indices': indices, 'material': 0}]})
    by_name = {src.json['nodes'][i].get('name'): out for i, out in node_map.items()}
    b.json['skins'].append({'joints': [by_name[name] for name in names],
                            'inverseBindMatrices': b.copy_accessor(src, outfit_skin['inverseBindMatrices'])})
    mesh_node = b.add_node({'name': outfit + '_Mesh', 'mesh': 0, 'skin': 0})
    b.json['nodes'][by_name['Armature']].setdefault('children', []).append(mesh_node)
    b.write(os.path.join(LITE, f'{outfit}.full.glb'))
    return atlas_name, images


def atlas(name, images):
    for folder, width in (('tex-512', 512), ('tex-1024', 1024)):
        scale = width / ATLAS_SIZE[0]
        args = ['magick', '-size', f'{ATLAS_SIZE[0]}x{ATLAS_SIZE[1]}', 'xc:#808080']
        for cell, path in images.items():
            x, y, w, h = ATLAS[cell]
            args += ['(', path, '-alpha', 'off', '-resize', f'{w}x{h}!', ')', '-geometry', f'+{x}+{y}', '-composite']
        args += ['-resize', f'{width}x{int(ATLAS_SIZE[1] * scale)}!', '-strip', '-quality', '85',
                 os.path.join(LITE, folder, name)]
        subprocess.run(args, check=True)


def textures():
    for folder, size in SIZES.items():
        for base, path in sorted(colour_maps.items()):
            subprocess.run(['magick', path, '-alpha', 'off', '-resize', f'{size}x{size}>', '-strip',
                            '-quality', '85', os.path.join(LITE, folder, base)], check=True)


SCRIPTS = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(OUT, 'lite-work')
# Simplified to this share of their triangles, unless that would change the shape by more than
# the error (a share of the model's size). Trees' leaf cards don't simplify far.
CHARACTER_CUT = ('0.25', '0.01')
TREE_CUT = ('0.3', '0.1')
LITE_TREES = ['CommonTree_3', 'Pine_1']
TREE_IMAGES = ['Bark_NormalTree.png', 'Leaves_NormalTree_C.png', 'Leaf_Pine_C.png']


def simplified(source, name, cut):
    """`source` with its triangles cut, as <name>.glb in the village-lite folder."""
    work = os.path.abspath(os.path.join(WORK, name + '.gltf'))
    # Beside its packages, so node finds them.
    shutil.copy(os.path.join(SCRIPTS, 'simplify.mjs'), os.path.join(NODE_DIR, 'simplify.mjs'))
    subprocess.run(['node', 'simplify.mjs', os.path.abspath(source), work, *cut], check=True, cwd=NODE_DIR)
    subprocess.run([sys.executable, '-I', os.path.join(SCRIPTS, 'repack.py'), work,
                    os.path.join(LITE, name + '.glb'), 'tex-512/'], check=True)


for folder in SIZES:
    os.makedirs(os.path.join(LITE, folder), exist_ok=True)
os.makedirs(WORK, exist_ok=True)
pieces()
for outfit, base_name in OUTFIT_BASES.items():
    atlas(*character(outfit, base_name))
    full = os.path.join(LITE, f'{outfit}.full.glb')
    simplified(full, outfit, CHARACTER_CUT)
    os.remove(full)
for tree in LITE_TREES:
    simplified(os.path.join(TREES, tree + '.gltf'), tree, TREE_CUT)
for folder, size in SIZES.items():
    for image in TREE_IMAGES:
        subprocess.run(['magick', os.path.join(TREES, image), '-resize', f'{size}x{size}>', '-strip',
                        os.path.join(LITE, folder, image)], check=True)
textures()
print('colour maps', len(colour_maps))
