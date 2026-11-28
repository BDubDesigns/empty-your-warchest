"""Builds the game's characters (public/models/characters/) from four Quaternius Source kits, read as
data only (their glTF exports; never their .blend files or engine projects):

- Universal Base Characters: the regular male's head, his slicked-back hair and beard.
- Modular Character Outfits - Fantasy: the knight's parts (tabard, armet, armour, pauldrons, scarf)
  and the knight's three colourways.
- Universal Animation Library 1 and 2: the clips, on the same skeleton.

Each character is its parts merged into one skinned mesh, one primitive (one draw) per colour map:
the guard is one (the knight's map), the captain two (his gold knight's map, and his head, hair and
eyes packed into one). Only colour maps ship (normal, roughness and ORM maps dropped, and the kits'
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

# Each character: its parts (glTF files), and where each of their materials' colour maps goes: an
# output map (one draw each) and the region of it (u0, v0, u1, v1; v down, as glTF's UVs), from the
# part's own image or `image` instead (another colourway). `triangles`: the budget on each tier.
CHARACTERS = {
    # A castle guard: the knight's tabard (red, with a gold cross) over his arms and leg armour, a
    # closed armet helmet, spiked pauldrons and the red scarf. No head: the armet and the scarf
    # cover it.
    'guard': {
        'parts': [
            os.path.join(PARTS, name + '.gltf') for name in (
                'Male_Knight_Body_Cloth', 'Male_Knight_Head_Armet', 'Male_Knight_Arms',
                'Male_Knight_Legs_Armor', 'Male_Knight_Feet_Armor', 'Male_Knight_Acc_Pauldron_Spike',
                'Male_Knight_Acc_Scarf')
        ],
        'materials': {
            'MI_Knight': {'map': 'guard', 'region': (0, 0, 1, 1),
                          'image': os.path.join(OUTFIT_TEXTURES, 'Knight', 'T_Knight_BaseColor.png')},
        },
        'triangles': {'high': 5000, 'low': 2500},
    },
    # The captain: the knight's full plate in its gold colourway (round pauldrons, a scarf), bare
    # headed, grey hair slicked back and a beard: a face to see at the keep's windows.
    'captain': {
        'parts': [
            os.path.join(PARTS, name + '.gltf') for name in (
                'Male_Knight_Body_Armor', 'Male_Knight_Acc_Pauldron_Round', 'Male_Knight_Acc_Scarf',
                'Male_Knight_Arms', 'Male_Knight_Legs_Armor', 'Male_Knight_Feet_Armor')
        ] + [
            os.path.join(BASE, 'Regular_Male_OnlyHead.gltf'),
            os.path.join(HAIR, 'Hair_SlickBack.gltf'),
            os.path.join(HAIR, 'Hair_Beard.gltf'),
        ],
        'materials': {
            'MI_Knight': {'map': 'captain', 'region': (0, 0, 1, 1),
                          'image': os.path.join(OUTFIT_TEXTURES, 'Knight', 'T_Knight_2_BaseColor.png')},
            # The head's map: his skin down the left half, hair top right, eyes below it.
            'MI_Regular_Male': {'map': 'captain_head', 'region': (0, 0, 0.5, 1)},
            'MI_Hair_1': {'map': 'captain_head', 'region': (0.5, 0, 1, 0.75)},
            'MI_Eyes': {'map': 'captain_head', 'region': (0.5, 0.75, 0.75, 1)},
        },
        # His breastplate's many facets need more than their share; his gauntlets' fingers less.
        'weights': {'Male_Knight_Body_Armor': 1.8, 'Male_Knight_Arms': 0.6},
        'triangles': {'high': 8000, 'low': 5000},
    },
}

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
    """The kit's shared skeleton, as the first part has it: its bones' names, rest poses (local
    translation and rotation), parents and inverse bind matrices; `kept` without the leaf bones."""

    def __init__(self, path):
        src = Source(path)
        nodes = src.json['nodes']
        skin = src.json['skins'][0]
        self.names = [nodes[i]['name'] for i in skin['joints']]
        _, ibm = src.values(skin['inverseBindMatrices'])
        self.ibm = {name: list(ibm[i * 16:(i + 1) * 16]) for i, name in enumerate(self.names)}
        self.rest = {}
        self.children = {}
        self.top = None
        for node in nodes:
            if 'name' not in node:
                continue
            self.rest[node['name']] = (node.get('translation', [0, 0, 0]), node.get('rotation', [0, 0, 0, 1]))
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
        if name not in skeleton.ibm:
            raise SystemExit(f'{path}: unknown bone {name}')
        if max(abs(a - b) for a, b in zip(ibm[i * 16:(i + 1) * 16], skeleton.ibm[name])) > 1e-4:
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
                'position': floats(src, a['POSITION']),
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

    def add(self, prim, region, weight=1):
        base = self.count
        u0, v0, u1, v1 = region
        u0, v0, u1, v1 = u0 + INSET, v0 + INSET, u1 - INSET, v1 - INSET
        self.position += prim['position']
        self.normal += prim['normal']
        uv = prim['uv']
        for i in range(0, len(uv), 2):
            u = min(1, max(0, uv[i]))
            v = min(1, max(0, uv[i + 1]))
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
    """A colour map packed from its regions' images, saved at each size."""
    size = SIZES[0]
    args = ['magick', '-size', f'{size}x{size}', 'xc:black']
    for (u0, v0, u1, v1), image in regions:
        w, h = round((u1 - u0) * size), round((v1 - v0) * size)
        args += ['(', image, '-alpha', 'off', '-resize', f'{w}x{h}!', ')',
                 '-geometry', f'+{round(u0 * size)}+{round(v0 * size)}', '-composite']
    for s in SIZES:
        folder = os.path.join(OUT, f'tex-{s}')
        os.makedirs(folder, exist_ok=True)
        subprocess.run(args + ['-resize', f'{s}x{s}', '-strip', '-quality', '85',
                               os.path.join(folder, f'{map_name}.jpg')], check=True)


def build_character(name, spec, skeleton):
    groups = {}
    regions = {}
    for path in spec['parts']:
        for prim in read_part(path, skeleton):
            where = spec['materials'].get(prim['material'])
            if where is None:
                raise SystemExit(f'{path}: no map for {prim["material"]}')
            weight = spec.get('weights', {}).get(os.path.basename(path).rsplit('.', 1)[0], 1)
            groups.setdefault(where['map'], Group()).add(prim, where['region'], weight)
            regions.setdefault(where['map'], {})[where['region']] = where.get('image', prim['image'])
    for map_name, parts in regions.items():
        atlas(map_name, sorted(parts.items()))
    total = sum(len(g.indices) // 3 for g in groups.values())
    # Each part's share of the budget grows slower than its triangles (as their SHARE_POWER), so
    # the small pieces (a pauldron, a scarf) keep more of theirs than the big ones (the arms, all
    # fingers): cut as hard, they fall apart first. A part's `weights` scales its share.
    share = lambda a, b, w: w * ((b - a) // 3) ** SHARE_POWER
    weight = sum(share(*part) for g in groups.values() for part in g.parts)
    report = {'source triangles': total}
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
skeleton = Skeleton(CHARACTERS['guard']['parts'][0])
print('bones', len(skeleton.kept), 'of', len(skeleton.names))
for character, spec in CHARACTERS.items():
    print(character, json.dumps(build_character(character, spec, skeleton)))
print('clips', json.dumps(build_clips(skeleton), indent=1))
