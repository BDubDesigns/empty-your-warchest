"""Builds the game's characters (public/models/characters/) from four Quaternius Source kits, read as
data only (their glTF exports; never their .blend files or engine projects):

- Universal Base Characters: the regular male's head, and his hair and beards.
- Modular Character Outfits - Fantasy: the knight's parts, the man's and the woman's (tabard or
  plate, armet or horned helmet, arms and legs, pauldrons, scarf) and the knight's three colourways.
- Universal Animation Library 1 and 2: the clips, on the same skeleton.

Each character is its parts merged into one skinned mesh, one primitive (one draw) per colour map:
a helmeted guard is one (a knight's map), a bare-headed one or the captain two (a knight's map, and
the heads' map: skin, hair and eyes packed into one, shared by every bare head). The guards' five
looks share two knight maps (the red and dark colourways); the gold one is the captain's. Each
character's body (without its decoration: horns, pauldrons, scarf, hair) is measured through the
idle clip, for the siege's hit box. Only colour maps ship (normal, roughness and ORM maps dropped, and the kits'
vertex colours and extra UV sets), at 1024, 512 and 256 px (tex-1024/, tex-512/, tex-256/); the
GLBs point each image at tex/<name> and the view sends it to the folder its tier asks for. Each
character is cut to two triangle budgets (meshoptimizer, through simplify.mjs): <name>-high.glb and
<name>-low.glb, the same skeleton in both. The skeleton loses the kit's twelve leaf bones (finger
and toe tips, nothing hanging off them): their few weights go to the bone each hangs off.

The clips ship once, in clips.glb (the skeleton's nodes and the animations, no mesh), and play on
either character by bone name. Each is cut to what moves: tracks that hold still at the
character's rest pose go (the mixer leaves those bones at rest), scale tracks go, translation stays
only on the pelvis (scaled to the character's hip height, so his feet stay on the ground; the
other bones keep the character's own lengths), and keys a straight blend between their neighbours
would give back are dropped. Rotations are stored as normalised 16-bit numbers.

usage: python3 -I build.py <quaternius-source dir> <the game's public/models/characters dir>"""
import json, math, os, struct, subprocess, sys
from array import array

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'))
from gltflib import Builder, Source  # noqa: E402

SOURCE, OUT = sys.argv[1:3]
HERE = os.path.dirname(os.path.abspath(__file__))
OUTFITS = os.path.join(SOURCE, 'modular-character-outfits-fantasy', 'Modular Character Outfits - Fantasy[Source]')
PARTS = os.path.join(OUTFITS, 'Exports', 'glTF (Godot-Unreal)', 'Modular Parts')
OUTFIT_TEXTURES = os.path.join(OUTFITS, 'Textures')
BASE = os.path.join(SOURCE, 'universal-base-characters', 'Base Characters', 'Exports', 'Godot - UE')
HAIR = os.path.join(SOURCE, 'universal-base-characters', 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)', 'Male')
UAL1 = os.path.join(SOURCE, 'universal-animation-library', 'Unreal-Godot', 'UAL1.glb')
UAL2 = os.path.join(SOURCE, 'universal-animation-library-2', 'Unreal-Godot', 'UAL2.glb')

SIZES = (1024, 512, 256)
SHARE_POWER = 0.6
TIERS = ('high', 'low')
# An atlas's regions are inset this far (as a share of it) so a smaller copy's texels don't bleed.
INSET = 2 / 1024

KNIGHT = os.path.join(OUTFIT_TEXTURES, 'Knight')
HEAD = os.path.join(BASE, 'Regular_Male_OnlyHead.gltf')


def knight(sex, *names):
    """The knight's parts (Male_Knight_* or Female_Knight_*), by the rest of their names."""
    return [os.path.join(PARTS, f'{sex}_Knight_{name}.gltf') for name in names]


def knight_map(map_name, colourway):
    """The knight's material in one of its colourways (1 red, 2 gold, 3 dark), as a whole map."""
    suffix = '' if colourway == 1 else f'_{colourway}'
    return {'map': map_name, 'region': (0, 0, 1, 1),
            'image': os.path.join(KNIGHT, f'T_Knight{suffix}_BaseColor.png')}


# The heads' map, one for every bare head (the captain's and a guard's): skin down the left half,
# grey hair top right, eyes below it, and in the corner beside them the guard's brown hair (only
# the part of the hair map his buzzed hair and beard use, tinted: the kit's hair map is grey, for
# an engine to tint).
HEADS = {
    'MI_Regular_Male': {'map': 'heads', 'region': (0, 0, 0.5, 1)},
    'MI_Hair_1': {'map': 'heads', 'region': (0.5, 0, 1, 0.75),
                  'image': os.path.join(HAIR, 'T_Hair_1_BaseColor.png')},
    'MI_Eyes': {'map': 'heads', 'region': (0.5, 0.75, 0.75, 1)},
}
BROWN_HAIR = {'map': 'heads', 'region': (0.75, 0.75, 1, 1),
              'image': os.path.join(HAIR, 'T_Hair_1_BaseColor.png'),
              'crop': (0.33, 0.24, 0.68, 0.70), 'tint': ('#140c06', '#7a5030')}

# Each character: its parts (glTF files), and where each of their materials' colour maps goes: an
# output map (one draw each) and the region of it (u0, v0, u1, v1; v down, as glTF's UVs), from the
# part's own image or `image` instead (another colourway), or only its `crop` (u0, v0, u1, v1),
# `tint`ed (its greys running from the first colour to the second). A map several characters share
# is packed once, from all their regions. `triangles`: the budget on each tier. A woman's parts
# (their own skeleton: her proportions) are scaled to the man's hip height, so the shared clips'
# hip motion fits her as it does him.
#
# The guards come in five looks, all from the knight's parts that share its colour maps: the red
# colourway (1) or the dark one (3); the man's outfit or the woman's; a closed armet, the horned
# helmet or a bare head (the heads' map, shared with the captain); spiked or round pauldrons; a
# scarf or none. The gold colourway (2) is the captain's alone.
GUARD_TRIANGLES = {'high': 5000, 'low': 2500}
CHARACTERS = {
    # The knight's tabard (red, with a gold cross) over his arms and leg armour, a closed armet,
    # spiked pauldrons and the red scarf. No head: the armet and the scarf cover it.
    'guard': {
        'parts': knight('Male', 'Body_Cloth', 'Head_Armet', 'Arms', 'Legs_Armor', 'Feet_Armor',
                        'Acc_Pauldron_Spike', 'Acc_Scarf'),
        'materials': {'MI_Knight': knight_map('guard', 1)},
        'triangles': GUARD_TRIANGLES,
    },
    # The dark tabard, the horned helmet (closed, as the armet), round pauldrons, no scarf.
    'guard_horns': {
        'parts': knight('Male', 'Body_Cloth', 'Head_Horns', 'Arms', 'Legs_Armor', 'Feet_Armor',
                        'Acc_Pauldron_Round'),
        'materials': {'MI_Knight': knight_map('guard_dark', 3)},
        'triangles': GUARD_TRIANGLES,
    },
    # The red tabard, bare headed (brown buzzed hair and a beard), round pauldrons and the scarf.
    'guard_bare': {
        'parts': knight('Male', 'Body_Cloth', 'Arms', 'Legs_Armor', 'Feet_Armor',
                        'Acc_Pauldron_Round', 'Acc_Scarf')
        + [HEAD, os.path.join(HAIR, 'Hair_Buzzed.gltf'), os.path.join(HAIR, 'Hair_Beard.gltf')],
        'materials': {'MI_Knight': knight_map('guard', 1), **HEADS, 'MI_Hair_1': BROWN_HAIR},
        # His face keeps a little more than its share (it's what makes him this look).
        'weights': {'Regular_Male_OnlyHead': 1.3, 'Male_Knight_Arms': 0.7},
        'triangles': GUARD_TRIANGLES,
    },
    # The woman's outfit: the dark tabard, a closed armet, spiked pauldrons and the scarf.
    'guard_woman': {
        'parts': knight('Female', 'Body_Cloth', 'Head_Armet', 'Arms', 'Legs', 'Feet',
                        'Acc_Pauldrons_Spike', 'Acc_Scarf'),
        'materials': {'MI_Knight': knight_map('guard_dark', 3)},
        'weights': {'Female_Knight_Arms': 0.7},
        'triangles': GUARD_TRIANGLES,
    },
    # The woman's full plate (steel, in the red colourway), the horned helmet, round pauldrons.
    'guard_woman_plate': {
        'parts': knight('Female', 'Body_Armor', 'Head_Horns', 'Arms', 'Legs', 'Feet',
                        'Acc_Pauldrons_Round'),
        'materials': {'MI_Knight': knight_map('guard', 1)},
        'weights': {'Female_Knight_Body_Armor': 1.5, 'Female_Knight_Arms': 0.7},
        'triangles': GUARD_TRIANGLES,
    },
    # The captain: the knight's full plate in its gold colourway (round pauldrons, a scarf), bare
    # headed, grey hair slicked back and a beard: a face to see at the keep's windows.
    'captain': {
        'parts': knight('Male', 'Body_Armor', 'Acc_Pauldron_Round', 'Acc_Scarf', 'Arms',
                        'Legs_Armor', 'Feet_Armor')
        + [HEAD, os.path.join(HAIR, 'Hair_SlickBack.gltf'), os.path.join(HAIR, 'Hair_Beard.gltf')],
        'materials': {'MI_Knight': knight_map('captain', 2), **HEADS},
        # His breastplate's many facets need more than their share; his gauntlets' fingers less.
        'weights': {'Male_Knight_Body_Armor': 1.8, 'Male_Knight_Arms': 0.6},
        'triangles': {'high': 8000, 'low': 5000},
    },
}
# Parts left out of a character's body (what the siege's hit box is measured round): decoration.
DECORATION = ('_Acc_', '_Head_Horns', 'Hair_')
# The body is measured in the idle clip, at this many moments through it.
BODY_SAMPLES = 12
# His trunk, arms and head: what's over his knees (m).
BODY_ABOVE = 0.5

# The clips (UAL1 and UAL2, without root motion: they play in place), by the names they ship as.
CLIPS = {
    'idle': (UAL1, 'Idle_Loop'),
    'walk': (UAL1, 'Walk_Loop'),
    'run': (UAL1, 'Sprint_Loop'),
    'die': (UAL1, 'Death01'),
    'hit': (UAL1, 'Hit_Chest'),
    'cower': (UAL1, 'Crouch_Idle_Loop'),
    'alarm': (UAL2, 'Idle_Rail_Call'),
    'lean': (UAL2, 'Idle_Rail_Loop'),
}
# Keys within these of a straight blend between their neighbours go: 0.4 degrees, 2 mm.
ANGLE_TOLERANCE = math.radians(0.4)
MOVE_TOLERANCE = 0.002

NORMALIZED = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}


def floats(src, index):
    acc, values = src.values(index)
    if acc.get('normalized'):
        scale = NORMALIZED[acc['componentType']]
        return array('f', [v / scale for v in values])
    return array('f', values)


def is_leaf(name):
    return '_leaf_' in name


class Skeleton:
    """A character's skeleton (the kit's man's or woman's), as the first of its parts has it: its
    bones' names, rest poses (local translation and rotation), parents and inverse bind matrices;
    `kept` without the leaf bones. With `hip`, it's scaled (by `scale`) so its hips stand that high;
    `bind` keeps the inverse bind matrices as the parts have them, to check them against."""

    def __init__(self, path, hip=None):
        src = Source(path)
        nodes = src.json['nodes']
        skin = src.json['skins'][0]
        self.names = [nodes[i]['name'] for i in skin['joints']]
        _, ibm = src.values(skin['inverseBindMatrices'])
        self.bind = {name: list(ibm[i * 16:(i + 1) * 16]) for i, name in enumerate(self.names)}
        own_hip = next(n for n in nodes if n.get('name') == 'pelvis')['translation'][2]
        self.scale = 1 if hip is None else hip / own_hip
        # Scaled evenly about the feet: every bone's offset, and each inverse bind's translation.
        self.ibm = {name: m[:12] + [v * self.scale for v in m[12:15]] + m[15:] for name, m in self.bind.items()}
        self.rest = {}
        self.children = {}
        self.top = None
        for node in nodes:
            if 'name' not in node:
                continue
            translation = [v * self.scale for v in node.get('translation', [0, 0, 0])]
            self.rest[node['name']] = (translation, node.get('rotation', [0, 0, 0, 1]))
            self.children[node['name']] = [nodes[c]['name'] for c in node.get('children', [])]
        for i in src.json['scenes'][src.json.get('scene', 0)]['nodes']:
            if nodes[i].get('name') == 'Armature':
                self.top = 'Armature'
        if self.top is None:
            raise SystemExit(f'{path}: no Armature node')
        self.kept = [name for name in self.names if not is_leaf(name)]
        self.parent = {kid: name for name, kids in self.children.items() for kid in kids}
        for name in self.names:
            if is_leaf(name) and self.children.get(name):
                raise SystemExit(f'leaf bone {name} has children')

    def add_nodes(self, builder):
        """The skeleton's nodes (the Armature and its bones, without the leaf bones), by name."""
        index = {}

        def visit(name):
            translation, rotation = self.rest[name]
            node = {'name': name}
            if any(abs(v) > 1e-9 for v in translation):
                node['translation'] = translation
            if any(abs(a - b) > 1e-9 for a, b in zip(rotation, (0, 0, 0, 1))):
                node['rotation'] = rotation
            at = builder.add_node(node)
            index[name] = at
            kids = [visit(c) for c in self.children.get(name, []) if c in self.rest and not is_leaf(c)]
            if kids:
                node['children'] = kids
            return at

        top = visit(self.top)
        return top, index


def read_part(path, skeleton):
    """A part's primitives: material, colour map and vertices, its joints renamed to the kept
    skeleton's indices."""
    src = Source(path)
    j = src.json
    skin = j['skins'][0]
    names = [j['nodes'][i]['name'] for i in skin['joints']]
    _, ibm = src.values(skin['inverseBindMatrices'])
    for i, name in enumerate(names):
        if name not in skeleton.bind:
            raise SystemExit(f'{path}: unknown bone {name}')
        if max(abs(a - b) for a, b in zip(ibm[i * 16:(i + 1) * 16], skeleton.bind[name])) > 1e-4:
            raise SystemExit(f'{path}: bone {name} binds differently')
    # A leaf bone's weights (a fingertip's) go to the bone it hangs off.
    remap = {i: skeleton.kept.index(name if name in skeleton.kept else skeleton.parent[name])
             for i, name in enumerate(names)}
    prims = []
    for node in j['nodes']:
        if 'mesh' not in node:
            continue
        for p in j['meshes'][node['mesh']]['primitives']:
            if p.get('targets'):
                raise SystemExit(f'{path}: morph targets')
            mat = j['materials'][p['material']]
            pbr = mat.get('pbrMetallicRoughness', {})
            tex = j['textures'][pbr['baseColorTexture']['index']]
            uri = j['images'][tex['source']]['uri']
            a = p['attributes']
            joints = src.values(a['JOINTS_0'])[1]
            weights = floats(src, a['WEIGHTS_0'])
            out_joints = array('B')
            for v in range(len(joints)):
                out_joints.append(remap[joints[v]])
            for v in range(0, len(weights), 4):
                total = sum(weights[v:v + 4]) or 1
                for k in range(4):
                    weights[v + k] /= total
            prims.append({
                'material': mat['name'],
                'image': os.path.join(src.dir, uri),
                'position': array('f', [v * skeleton.scale for v in floats(src, a['POSITION'])]),
                'normal': floats(src, a['NORMAL']),
                'uv': floats(src, a['TEXCOORD_0']),
                'joints': out_joints,
                'weights': weights,
                'indices': array('I', src.values(p['indices'])[1]),
            })
    return prims


class Group:
    """One output primitive: the vertices and triangles of every part drawn with one colour map."""

    def __init__(self):
        self.position, self.normal, self.uv = array('f'), array('f'), array('f')
        self.joints, self.weights, self.indices = array('B'), array('f'), array('I')
        # Each part's slice of the indices (parts are cut apart: each keeps its own share).
        self.parts = []

    @property
    def count(self):
        return len(self.position) // 3

    def add(self, prim, region, weight=1, crop=(0, 0, 1, 1)):
        """A part's primitive, its UVs (only its `crop` of its map) moved into `region`."""
        base = self.count
        u0, v0, u1, v1 = region
        u0, v0, u1, v1 = u0 + INSET, v0 + INSET, u1 - INSET, v1 - INSET
        c0, d0, c1, d1 = crop
        self.position += prim['position']
        self.normal += prim['normal']
        uv = prim['uv']
        for i in range(0, len(uv), 2):
            u = min(1, max(0, (uv[i] - c0) / (c1 - c0)))
            v = min(1, max(0, (uv[i + 1] - d0) / (d1 - d0)))
            self.uv.append(u0 + u * (u1 - u0))
            self.uv.append(v0 + v * (v1 - v0))
        self.joints += prim['joints']
        self.weights += prim['weights']
        start = len(self.indices)
        self.indices += array('I', [i + base for i in prim['indices']])
        self.parts.append((start, len(self.indices), weight))


def simplify(group, targets):
    """`group`'s parts' triangles, each cut toward its target (simplify.mjs): the kept indices and
    the worst error."""
    attributes = []
    for v in range(group.count):
        attributes += group.normal[v * 3:v * 3 + 3]
        attributes += group.uv[v * 2:v * 2 + 2]
    job = {
        'positions': list(group.position), 'attributes': attributes, 'stride': 5,
        'weights': [0.5, 0.5, 0.5, 1, 1], 'error': 1, 'flags': ['Permissive'],
        'parts': [{'indices': list(group.indices[a:b]), 'target': target * 3}
                  for (a, b, _), target in zip(group.parts, targets)],
    }
    done = subprocess.run(['node', os.path.join(HERE, 'simplify.mjs')], input=json.dumps(job).encode(),
                          capture_output=True, check=True)
    parts = json.loads(done.stdout)['parts']
    return array('I', [i for part in parts for i in part['indices']]), max(part['error'] for part in parts)


def accessor(builder, values, component, kind, target=None, bounds=False, normalized=False):
    codes = {5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
    data = values if isinstance(values, array) and values.typecode == codes[component] else array(codes[component], values)
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[kind]
    acc = {'componentType': component, 'count': len(data) // width, 'type': kind}
    if normalized:
        acc['normalized'] = True
    if bounds:
        acc['min'] = [min(data[k::width]) for k in range(width)]
        acc['max'] = [max(data[k::width]) for k in range(width)]
    return builder.add_data(acc, data.tobytes(), target)


def write_character(name, groups, kept, skeleton, path):
    """A character's GLB: its skeleton, and one skinned mesh with a primitive per colour map."""
    b = Builder(lambda base: 'tex/' + base)
    top, index = skeleton.add_nodes(b)
    ibm = array('f')
    for bone in skeleton.kept:
        ibm += array('f', skeleton.ibm[bone])
    b.json['skins'].append({'name': name, 'joints': [index[bone] for bone in skeleton.kept],
                            'inverseBindMatrices': accessor(b, ibm, 5126, 'MAT4')})
    b.json['samplers'].append({'magFilter': 9729, 'minFilter': 9987})
    prims = []
    triangles = 0
    for map_name, group in groups.items():
        indices = kept[map_name]
        order = []
        remap = {}
        for i in indices:
            if i not in remap:
                remap[i] = len(order)
                order.append(i)
        pick = lambda values, width: array(values.typecode, [values[v * width + k] for v in order for k in range(width)])
        image = len(b.json['images'])
        b.json['images'].append({'uri': f'tex/{map_name}.jpg'})
        b.json['textures'].append({'source': image, 'sampler': 0})
        b.json['materials'].append({
            'name': map_name,
            'pbrMetallicRoughness': {'baseColorTexture': {'index': image}, 'metallicFactor': 0, 'roughnessFactor': 1},
        })
        flat = [remap[i] for i in indices]
        prims.append({
            'attributes': {
                'POSITION': accessor(b, pick(group.position, 3), 5126, 'VEC3', 34962, bounds=True),
                'NORMAL': accessor(b, pick(group.normal, 3), 5126, 'VEC3', 34962),
                'TEXCOORD_0': accessor(b, pick(group.uv, 2), 5126, 'VEC2', 34962),
                'JOINTS_0': accessor(b, pick(group.joints, 4), 5121, 'VEC4', 34962),
                'WEIGHTS_0': accessor(b, pick(group.weights, 4), 5126, 'VEC4', 34962),
            },
            'indices': accessor(b, flat, 5123 if len(order) < 65536 else 5125, 'SCALAR', 34963),
            'material': len(b.json['materials']) - 1,
        })
        triangles += len(indices) // 3
    b.json['meshes'].append({'name': name, 'primitives': prims})
    body = b.add_node({'name': name, 'mesh': 0, 'skin': 0})
    b.json['scenes'][0]['nodes'] += [top, body]
    b.write(path)
    return triangles


def atlas(map_name, regions):
    """A colour map packed from its regions' images (each its crop, tinted), saved at each size."""
    size = SIZES[0]
    args = ['magick', '-size', f'{size}x{size}', 'xc:black']
    for (u0, v0, u1, v1), (image, crop, tint) in regions:
        w, h = round((u1 - u0) * size), round((v1 - v0) * size)
        args += ['(', image, '-alpha', 'off']
        if crop:
            done = subprocess.run(['magick', 'identify', '-format', '%w %h', image],
                                  capture_output=True, check=True)
            iw, ih = (int(n) for n in done.stdout.split())
            c0, d0, c1, d1 = crop
            args += ['-crop', f'{round((c1 - c0) * iw)}x{round((d1 - d0) * ih)}'
                     f'+{round(c0 * iw)}+{round(d0 * ih)}', '+repage']
        if tint:
            args += ['-colorspace', 'gray', '-colorspace', 'sRGB', '+level-colors', ','.join(tint)]
        args += ['-resize', f'{w}x{h}!', ')', '-geometry', f'+{round(u0 * size)}+{round(v0 * size)}',
                 '-composite']
    for s in SIZES:
        folder = os.path.join(OUT, f'tex-{s}')
        os.makedirs(folder, exist_ok=True)
        subprocess.run(args + ['-resize', f'{s}x{s}', '-strip', '-quality', '85',
                               os.path.join(folder, f'{map_name}.jpg')], check=True)


def quat_matrix(t, q):
    """A translation and rotation (x, y, z, w) as a 4x4 matrix, column by column (as glTF)."""
    x, y, z, w = q
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
            2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
            2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
            t[0], t[1], t[2], 1]


def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def sample(times, values, width, blend, t):
    """A track's value at `t` (s): a straight blend between the keys either side."""
    if t <= times[0]:
        return list(values[0:width])
    for i in range(1, len(times)):
        if t <= times[i]:
            share = (t - times[i - 1]) / (times[i] - times[i - 1])
            return blend(values[(i - 1) * width:i * width], values[i * width:(i + 1) * width], share)
    return list(values[(len(times) - 1) * width:len(times) * width])


def pose(skeleton, clip, share, hip):
    """Each bone's matrix in the scene `share` of the way through `clip` ((file, name)), played as
    the game plays it: rotations from the clip, translation only on the pelvis (scaled to `hip`)."""
    path, name = clip
    src = Source(path)
    nodes = src.json['nodes']
    anim = next(a for a in src.json['animations'] if a.get('name') == name)
    their_hip = next(n for n in nodes if n.get('name') == 'pelvis')['translation'][2]
    tracks = []
    for ch in anim['channels']:
        sampler = anim['samplers'][ch['sampler']]
        tracks.append((nodes[ch['target']['node']].get('name'), ch['target']['path'],
                       list(floats(src, sampler['input'])), floats(src, sampler['output'])))
    start = min(times[0] for _, _, times, _ in tracks)
    end = max(times[-1] for _, _, times, _ in tracks)
    at = start + (end - start) * share
    local = {bone: [list(t), list(q)] for bone, (t, q) in skeleton.rest.items()}
    for bone, kind, times, values in tracks:
        if bone not in local or kind == 'scale' or (kind == 'translation' and bone != 'pelvis'):
            continue
        if kind == 'rotation':
            local[bone][1] = sample(times, values, 4, slerp, at)
        else:
            local[bone][0] = [v * hip / their_hip for v in sample(times, values, 3, lerp, at)]
    world = {}

    def visit(bone, parent):
        world[bone] = mat_mul(parent, quat_matrix(*local[bone]))
        for kid in skeleton.children.get(bone, []):
            if kid in local:
                visit(kid, world[bone])

    visit(skeleton.top, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    return world


def body_bounds(prims, skeleton, hip):
    """The box round the body's vertices (min and max xyz, m) through the idle clip, skinned, and
    the box round only what's above BODY_ABOVE: his trunk, arms and head (his stance puts his feet
    wide apart, but over a parapet or a sill only this shows)."""
    low, high = [math.inf] * 3, [-math.inf] * 3
    upper_low, upper_high = [math.inf] * 3, [-math.inf] * 3
    for n in range(BODY_SAMPLES):
        world = pose(skeleton, CLIPS['idle'], n / BODY_SAMPLES, hip)
        skin = [mat_mul(world[bone], skeleton.ibm[bone]) for bone in skeleton.kept]
        for prim in prims:
            position, joints, weights = prim['position'], prim['joints'], prim['weights']
            for v in range(len(position) // 3):
                x, y, z = position[v * 3:v * 3 + 3]
                out = [0, 0, 0]
                for k in range(4):
                    w = weights[v * 4 + k]
                    if w <= 0:
                        continue
                    m = skin[joints[v * 4 + k]]
                    for r in range(3):
                        out[r] += w * (m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r])
                for r in range(3):
                    low[r] = min(low[r], out[r])
                    high[r] = max(high[r], out[r])
                    if out[1] >= BODY_ABOVE:
                        upper_low[r] = min(upper_low[r], out[r])
                        upper_high[r] = max(upper_high[r], out[r])
    return low, high, upper_low, upper_high


def build_character(name, spec, skeleton, hip, maps):
    """A character's GLB on each tier; its regions of the colour maps go into `maps` (by map)."""
    groups = {}
    body = []
    for path in spec['parts']:
        part = os.path.basename(path).rsplit('.', 1)[0]
        for prim in read_part(path, skeleton):
            where = spec['materials'].get(prim['material'])
            if where is None:
                raise SystemExit(f'{path}: no map for {prim["material"]}')
            weight = spec.get('weights', {}).get(part, 1)
            groups.setdefault(where['map'], Group()).add(prim, where['region'], weight,
                                                         where.get('crop', (0, 0, 1, 1)))
            source = (where.get('image', prim['image']), where.get('crop'), where.get('tint'))
            regions = maps.setdefault(where['map'], {})
            if regions.setdefault(where['region'], source) != source:
                raise SystemExit(f'{name}: map {where["map"]} has two images for {where["region"]}')
            if not any(mark in part for mark in DECORATION):
                body.append(prim)
    low, high, upper_low, upper_high = body_bounds(body, skeleton, hip)
    total = sum(len(g.indices) // 3 for g in groups.values())
    # Each part's share of the budget grows slower than its triangles (as their SHARE_POWER), so
    # the small pieces (a pauldron, a scarf) keep more of theirs than the big ones (the arms, all
    # fingers): cut as hard, they fall apart first. A part's `weights` scales its share.
    share = lambda a, b, w: w * ((b - a) // 3) ** SHARE_POWER
    weight = sum(share(*part) for g in groups.values() for part in g.parts)
    report = {'source triangles': total, 'scale': round(skeleton.scale, 4),
              # The body (without its decoration) through the idle clip: across, up, deep (m).
              'body': [round(high[r] - low[r], 3) for r in range(3)],
              'body min': [round(v, 3) for v in low], 'body max': [round(v, 3) for v in high],
              # Only over his knees: across and deep, and its middle (x, z).
              'upper body': [round(upper_high[r] - upper_low[r], 3) for r in (0, 2)],
              'upper middle': [round((upper_high[r] + upper_low[r]) / 2, 3) for r in (0, 2)]}
    for tier in TIERS:
        budget = spec['triangles'][tier]
        kept = {}
        errors = []
        for map_name, group in groups.items():
            targets = [min((a_b_w[1] - a_b_w[0]) // 3, math.floor(budget * share(*a_b_w) / weight))
                       for a_b_w in group.parts]
            kept[map_name], error = simplify(group, targets)
            errors.append(round(error, 4))
        path = os.path.join(OUT, f'{name}-{tier}.glb')
        triangles = write_character(name, groups, kept, skeleton, path)
        report[tier] = {'triangles': triangles, 'draws': len(groups), 'bones': len(skeleton.kept),
                        'kB': round(os.path.getsize(path) / 1024), 'error': errors}
    return report


def angle(a, b):
    dot = min(1, abs(sum(x * y for x, y in zip(a, b))))
    return 2 * math.acos(dot)


def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = [-x for x in b]
        dot = -dot
    if dot > 0.9995:
        out = [x + (y - x) * t for x, y in zip(a, b)]
    else:
        theta = math.acos(dot)
        s = math.sin(theta)
        out = [(math.sin((1 - t) * theta) * x + math.sin(t * theta) * y) / s for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in out))
    return [x / n for x in out]


def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def reduce_keys(times, values, width, blend, distance, tolerance):
    """The keys a straight blend between kept neighbours can't give back (the ends always stay)."""
    keys = [values[i * width:(i + 1) * width] for i in range(len(times))]
    kept = [0]
    i = 0
    while i < len(times) - 1:
        j = i + 2
        while j < len(times):
            ok = all(distance(keys[k], blend(keys[i], keys[j], (times[k] - times[i]) / (times[j] - times[i])))
                     <= tolerance for k in range(i + 1, j))
            if not ok:
                break
            j += 1
        i = j - 1
        kept.append(i)
    return [times[k] for k in kept], [keys[k] for k in kept]


def build_clips(skeleton):
    """clips.glb: the skeleton's nodes and every clip, cut to what moves."""
    b = Builder(lambda base: base)
    top, index = skeleton.add_nodes(b)
    b.json['scenes'][0]['nodes'].append(top)
    sources = {}
    hip = skeleton.rest['pelvis'][0][2]
    report = {}
    for out_name, (path, clip) in CLIPS.items():
        if path not in sources:
            sources[path] = Source(path)
        src = sources[path]
        nodes = src.json['nodes']
        anim = next((a for a in src.json['animations'] if a.get('name') == clip), None)
        if anim is None:
            raise SystemExit(f'{path}: no clip {clip}')
        their_hip = next(n for n in nodes if n.get('name') == 'pelvis')['translation'][2]
        samplers, channels = [], []
        keys = 0
        start = None
        for ch in anim['channels']:
            bone = nodes[ch['target']['node']].get('name')
            kind = ch['target']['path']
            if bone not in index or kind == 'scale':
                continue
            if kind == 'translation' and bone != 'pelvis':
                continue
            sampler = anim['samplers'][ch['sampler']]
            times = list(floats(src, sampler['input']))
            values = floats(src, sampler['output'])
            start = times[0] if start is None else min(start, times[0])
            if kind == 'rotation':
                width, blend, distance, tolerance = 4, slerp, angle, ANGLE_TOLERANCE
                rest = skeleton.rest[bone][1]
            else:
                width, blend, distance, tolerance = 3, lerp, lambda a, c: math.dist(a, c), MOVE_TOLERANCE
                values = array('f', [v * hip / their_hip for v in values])
                rest = skeleton.rest[bone][0]
            first = values[0:width]
            still = all(distance(values[k * width:(k + 1) * width], first) <= tolerance for k in range(len(times)))
            if still and distance(first, rest) <= tolerance:
                continue  # at rest throughout: the mixer leaves it there
            if still:
                times, frames = times[:1], [list(first)]
            else:
                times, frames = reduce_keys(times, values, width, blend, distance, tolerance)
            keys += len(times)
            flat = [x for f in frames for x in f]
            if kind == 'rotation':
                output = accessor(b, [round(max(-1, min(1, x)) * 32767) for x in flat], 5122, 'VEC4', normalized=True)
            else:
                output = accessor(b, flat, 5126, 'VEC3')
            samplers.append({'input': times, 'output': output})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': index[bone], 'path': kind}})
        for s in samplers:
            s['input'] = accessor(b, [t - start for t in s['input']], 5126, 'SCALAR', bounds=True)
            s['interpolation'] = 'LINEAR'
        b.json['animations'].append({'name': out_name, 'samplers': samplers, 'channels': channels})
        length = max(b.json['accessors'][s['input']]['max'][0] for s in samplers)
        report[out_name] = {'from': clip, 'seconds': round(length, 2), 'tracks': len(channels), 'keys': keys}
    del b.json['meshes']
    path = os.path.join(OUT, 'clips.glb')
    b.write(path)
    report['kB'] = round(os.path.getsize(path) / 1024)
    return report


os.makedirs(OUT, exist_ok=True)
# The man's skeleton: the clips are fitted to it, and every other character's hips stand as high.
skeleton = Skeleton(CHARACTERS['guard']['parts'][0])
hip = skeleton.rest['pelvis'][0][2]
print('bones', len(skeleton.kept), 'of', len(skeleton.names))
maps = {}
for character, spec in CHARACTERS.items():
    own = Skeleton(spec['parts'][0], hip)
    if own.kept != skeleton.kept:
        raise SystemExit(f'{character}: its skeleton has other bones')
    print(character, json.dumps(build_character(character, spec, own, hip, maps)))
for map_name, regions in maps.items():
    atlas(map_name, sorted(regions.items()))
print('maps', sorted(maps))
print('clips', json.dumps(build_clips(skeleton), indent=1))
