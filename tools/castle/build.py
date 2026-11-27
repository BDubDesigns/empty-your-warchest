"""Builds the castle's kit (public/models/castle/) from two Quaternius Source kits, read as data only:
the Medieval Village MegaKit's walls, windows, doors, roofs and stairs and the Fantasy Props
MegaKit's weapon stand, banners, barrels and torches. One GLB holds every piece as a named node;
the castle's layout (src/data/castle.ts) says where each goes, and the view merges them. Built the
way the stress test's "Village optimised" assets were (tools/bench/): colour maps only (the normal,
roughness and ORM maps dropped), the kits' vertex colours and extra UV sets dropped, window glass
dropped (open, dark windows a captain can show at), and every colour map saved at 1024, 512 and
256 px (tex-1024/, tex-512/, tex-256/) so each graphics tier picks its own sizes. The GLB points
every image at tex/<name>; the view sends each to the folder its tier asks for.
usage: python3 -I build.py <quaternius-source dir> <the game's public/models/castle dir>"""
import os, re, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'))
from gltflib import Builder, Source  # noqa: E402

SOURCE, OUT = sys.argv[1:3]
VILLAGE = os.path.join(SOURCE, 'medieval-village-megakit/glTF')
PROPS = os.path.join(SOURCE, 'fantasy-props-megakit/Exports/glTF')

# Every piece the castle can use (src/data/castle.ts names them). Corners are drawn in code: the
# kit's stone corners are 3,000 triangles each.
VILLAGE_PIECES = [
    'Wall_UnevenBrick_Straight', 'Wall_UnevenBrick_Window_Thin_Round', 'Wall_UnevenBrick_Window_Wide_Round',
    'Wall_UnevenBrick_Door_Round', 'Window_Thin_Round1', 'Window_Wide_Round1', 'WindowShutters_Thin_Round_Open',
    'Door_4_Round', 'Roof_RoundTiles_8x12', 'Roof_Front_Brick8', 'Roof_Tower_RoundTiles',
    'Stairs_Exterior_Straight', 'Prop_Vine1', 'Prop_Vine2', 'Prop_Vine3', 'Prop_Vine6', 'Prop_Crate',
    'Prop_Wagon', 'Prop_Chimney', 'Floor_RoundRocks',
]
PROP_PIECES = ['WeaponStand', 'Banner_1', 'Banner_Vertical_1', 'Barrel', 'Crate_Wooden', 'Torch_Metal']
SIZES = (1024, 512, 256)
# The kits' shader masks (vertex colours, extra UV sets): three.js would tint the models with them.
DROP = lambda name: name.startswith('COLOR_') or re.match(r'TEXCOORD_[1-9]', name) is not None

colour_maps = {}  # output name -> (source path, keeps its alpha)


def image_name(base, alpha):
    base = base.replace('_png.png', '.png')
    return base if alpha else re.sub(r'\.png$', '.jpg', base)


def source_image(src, uri):
    path = os.path.join(src.dir, uri)
    if not os.path.exists(path):
        path = path.replace('_png.png', '.png')
    return path


def colour_only(builder, src):
    """Material copies with only their colour map; a masked one (vine leaves) keeps its alpha."""
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
            alpha = mat.get('alphaMode') == 'MASK'
            colour_maps[image_name(os.path.basename(uri), alpha)] = (source_image(src, uri), alpha)
            out['pbrMetallicRoughness']['baseColorTexture'] = {'index': builder.texture(src, pbr['baseColorTexture']['index'])}
        builder.json['materials'].append(out)
        builder.materials[name] = len(builder.json['materials']) - 1
        return builder.materials[name]
    builder.material = lambda s, index: material(index)


def no_glass(src, prim):
    """Drops window glass: the windows stay open."""
    if 'material' in prim and src.json['materials'][prim['material']].get('name') == 'MI_WindowGlass':
        return None
    attrs = {k: src.accessor(v) for k, v in prim['attributes'].items()}
    return attrs, (src.accessor(prim['indices']) if 'indices' in prim else None)


def kit():
    # (A material lists its image in colour_maps before its texture is made, so this knows.)
    def uri(base):
        alpha = colour_maps.get(image_name(base, True), (None, False))[1]
        return 'tex/' + image_name(base, alpha)
    b = Builder(uri)
    for folder, names in ((VILLAGE, VILLAGE_PIECES), (PROPS, PROP_PIECES)):
        for name in names:
            src = Source(os.path.join(folder, name + '.gltf'))
            colour_only(b, src)
            b.import_scene(src, name, drop_attr=DROP, prim_filter=no_glass)
    b.write(os.path.join(OUT, 'kit.glb'))


def textures():
    for size in SIZES:
        folder = os.path.join(OUT, f'tex-{size}')
        os.makedirs(folder, exist_ok=True)
        for name, (path, alpha) in sorted(colour_maps.items()):
            args = ['magick', path]
            if not alpha:
                args += ['-alpha', 'off']
            args += ['-resize', f'{size}x{size}>', '-strip']
            if not alpha:
                args += ['-quality', '85']
            subprocess.run(args + [os.path.join(folder, name)], check=True)


os.makedirs(OUT, exist_ok=True)
kit()
textures()
print('pieces', len(VILLAGE_PIECES) + len(PROP_PIECES), 'colour maps', len(colour_maps))
for name in sorted(colour_maps):
    print(' ', name)
