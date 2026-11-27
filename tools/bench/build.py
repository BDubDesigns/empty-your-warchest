"""Builds the stress test's assets into <out>/ from the downloaded packs (read as data only).
usage: python3 -I build.py <assets-dir> <out-dir>"""
import os, re, shutil, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltflib import Builder, Source, filter_triangles  # noqa: E402

ASSETS, OUT = sys.argv[1], sys.argv[2]
VILLAGE = os.path.join(ASSETS, 'village/x/Medieval Village MegaKit[Standard]/glTF')
OUTFITS = os.path.join(ASSETS, 'outfits/x/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits')
BASE = os.path.join(ASSETS, 'basechars/x/Universal Base Characters[Standard]/Base Characters/Godot - UE')
UAL = os.path.join(ASSETS, 'ual/x/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb')
CASTLE = os.path.join(ASSETS, 'kenney-castle/glb')
MINI = os.path.join(ASSETS, 'kenney-mini/glb')

# Quaternius vertex colours are masks for the pack's own shaders, and its extra UV sets are unused
# by three.js: drop both, or three.js would tint the models with the masks.
QUAT_DROP = lambda name: name.startswith('COLOR_') or re.match(r'TEXCOORD_[1-9]', name) is not None

VILLAGE_PIECES = [
    'Wall_UnevenBrick_Straight', 'Wall_UnevenBrick_Window_Wide_Round', 'Wall_UnevenBrick_Door_Round',
    'Corner_Exterior_Brick', 'Roof_Tower_RoundTiles',
    'Wall_Plaster_Straight', 'Wall_Plaster_WoodGrid', 'Wall_Plaster_Window_Wide_Flat', 'Window_Wide_Flat1',
    'Wall_Plaster_Door_Round', 'Door_1_Round', 'Roof_RoundTiles_6x6', 'Prop_Chimney',
    'Prop_Crate', 'Prop_Wagon', 'Prop_WoodenFence_Single', 'Prop_WoodenFence_Extension1',
]
CASTLE_PIECES = [
    'wall', 'wall-corner', 'wall-narrow-gate', 'tower-square-base', 'tower-square-mid',
    'tower-square-mid-windows', 'tower-square-roof', 'tower-square-top-roof', 'flag', 'rocks-large',
    'siege-ballista', 'tree-log', 'stairs-stone', 'tree-large', 'tree-small',
]
OUTFIT_BASES = {'Male_Peasant': 'Superhero_Male', 'Female_Peasant': 'Superhero_Female',
                'Male_Ranger': 'Superhero_Male', 'Female_Ranger': 'Superhero_Female'}
MINI_CHARACTERS = ['character-soldier', 'character-knight', 'character-male-a', 'character-female-a']

used_images = {}  # basename -> source path


def jpg(base):
    return re.sub(r'\.png$', '.jpg', base)


def note_images(src):
    for img in src.json.get('images', []):
        path = os.path.join(src.dir, img['uri'])
        if not os.path.exists(path):
            # The base characters point at "X_png.png" files that ship as "X.png".
            path = path.replace('_png.png', '.png')
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        used_images[os.path.basename(img['uri'])] = path


def village_pieces():
    b = Builder(lambda base: 'tex/' + jpg(base))
    for name in VILLAGE_PIECES:
        src = Source(os.path.join(VILLAGE, name + '.gltf'))
        note_images(src)
        b.import_scene(src, name, drop_attr=QUAT_DROP)
    b.write(os.path.join(OUT, 'village/pieces.glb'))


def head_keep(female):
    low, half = (1.40, 0.14) if female else (1.44, 0.15)
    return lambda p: p[1] > low and abs(p[0]) < half


def village_characters():
    for outfit, base_name in OUTFIT_BASES.items():
        b = Builder(lambda base: 'tex/' + jpg(base))
        src = Source(os.path.join(OUTFITS, outfit + '.gltf'))
        note_images(src)
        node_map = b.import_scene(src, outfit, drop_attr=QUAT_DROP)
        base = Source(os.path.join(BASE, base_name + '_FullBody.gltf'))
        note_images(base)
        # The base character's head (the outfits leave it out), bound to the outfit's skeleton by
        # joint name, keeping its own bind matrices so it sits on the outfit's neck.
        by_name = {src.json['nodes'][i].get('name'): out for i, out in node_map.items()}
        armature = by_name['Armature']
        keep = head_keep(outfit.startswith('Female'))
        skin = base.json['skins'][0]
        joints = [by_name[base.json['nodes'][j]['name']] for j in skin['joints']]
        b.json['skins'].append({'joints': joints,
                                'inverseBindMatrices': b.copy_accessor(base, skin['inverseBindMatrices'])})
        head_skin = len(b.json['skins']) - 1
        for node in base.json['nodes']:
            if 'mesh' not in node:
                continue
            body = node.get('name', '').lower().startswith('superhero')
            prim_filter = (lambda s, p: filter_triangles(s, p, keep, QUAT_DROP)) if body else None
            mesh = b.add_mesh(base, node['mesh'], QUAT_DROP, prim_filter)
            if mesh is None:
                continue
            index = b.add_node({'name': 'Head_' + node.get('name', ''), 'mesh': mesh, 'skin': head_skin})
            b.json['nodes'][armature].setdefault('children', []).append(index)
        b.write(os.path.join(OUT, f'village/{outfit}.glb'))


def village_animations():
    b = Builder(lambda base: base)
    src = Source(UAL)
    # Rotations only (plus the hips' height), so the mannequin's proportions don't stretch others.
    node_map = b.import_scene(src, 'Animations', meshes=False)
    b.copy_animations(src, node_map, {'Idle_Loop': 'idle', 'Walk_Loop': 'walk'},
                      channel_filter=lambda node, path: path == 'rotation' or node.get('name') == 'pelvis')
    b.write(os.path.join(OUT, 'village/animations.glb'))


def castle_pieces():
    b = Builder(lambda base: 'castle-colormap.png')
    for name in CASTLE_PIECES:
        src = Source(os.path.join(CASTLE, name + '.glb'))
        b.import_scene(src, name)
    b.write(os.path.join(OUT, 'kenney/castle.glb'))
    shutil.copy(os.path.join(CASTLE, 'Textures/colormap.png'), os.path.join(OUT, 'kenney/castle-colormap.png'))


def mini_characters():
    os.makedirs(os.path.join(OUT, 'kenney/mini/Textures'), exist_ok=True)
    for name in MINI_CHARACTERS:
        shutil.copy(os.path.join(MINI, name + '.glb'), os.path.join(OUT, f'kenney/mini/{name}.glb'))
    shutil.copy(os.path.join(MINI, 'Textures/colormap.png'), os.path.join(OUT, 'kenney/mini/Textures/colormap.png'))


def textures():
    for folder, size, quality in (('tex', 1024, 85), ('tex-full', None, 90)):
        os.makedirs(os.path.join(OUT, 'village', folder), exist_ok=True)
        for base, path in sorted(used_images.items()):
            out = os.path.join(OUT, 'village', folder, jpg(base))
            args = ['magick', path, '-alpha', 'off']
            if size:
                args += ['-resize', f'{size}x{size}>']
            args += ['-strip', '-quality', str(quality), out]
            subprocess.run(args, check=True)


for d in ('village', 'kenney'):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)
village_pieces()
village_characters()
village_animations()
castle_pieces()
mini_characters()
textures()
print('images', len(used_images))
