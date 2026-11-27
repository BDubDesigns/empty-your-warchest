"""A small glTF rebuilder: copies scenes, meshes, skins and animations from source files into one
GLB, repacking every accessor tightly, deduping materials by name and images by file name, and
pointing images at a new folder. Only reads its inputs (treated as data)."""
import json, os, struct
from array import array

COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


class Source:
    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        if path.endswith('.glb'):
            with open(path, 'rb') as f:
                data = f.read()
            ln = struct.unpack('<I', data[12:16])[0]
            self.json = json.loads(data[20:20 + ln])
            rest = data[20 + ln:]
            bins = []
            if rest:
                bl = struct.unpack('<I', rest[0:4])[0]
                bins.append(rest[8:8 + bl])
            self.buffers = []
            for b in self.json.get('buffers', []):
                if 'uri' in b:
                    with open(os.path.join(self.dir, b['uri']), 'rb') as f:
                        self.buffers.append(f.read())
                else:
                    self.buffers.append(bins[0])
        else:
            with open(path) as f:
                self.json = json.load(f)
            self.buffers = []
            for b in self.json.get('buffers', []):
                with open(os.path.join(self.dir, b['uri']), 'rb') as f:
                    self.buffers.append(f.read())

    def accessor(self, index):
        """(accessor json without buffer fields, tightly packed bytes)."""
        acc = dict(self.json['accessors'][index])
        if 'sparse' in acc:
            raise ValueError(f'{self.path}: sparse accessors not handled')
        fmt, size = COMPONENT[acc['componentType']]
        n = COUNT[acc['type']]
        elem = size * n
        out = bytearray()
        if 'bufferView' in acc:
            view = self.json['bufferViews'][acc['bufferView']]
            buf = self.buffers[view['buffer']]
            start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
            stride = view.get('byteStride', elem)
            if stride == elem:
                out = bytearray(buf[start:start + elem * acc['count']])
            else:
                for i in range(acc['count']):
                    out += buf[start + i * stride:start + i * stride + elem]
        else:
            out = bytearray(elem * acc['count'])
        for key in ('bufferView', 'byteOffset'):
            acc.pop(key, None)
        return acc, bytes(out)

    def values(self, index):
        acc, data = self.accessor(index)
        fmt, _ = COMPONENT[acc['componentType']]
        arr = array(fmt)
        arr.frombytes(data)
        return acc, arr


class Builder:
    def __init__(self, image_uri, colour_only=False):
        """`image_uri(basename) -> uri` names each image in the output; `colour_only` drops every
        map but the colour map (matte materials)."""
        self.colour_only = colour_only
        self.json = {'asset': {'version': '2.0', 'generator': 'warchest bench builder'},
                     'scenes': [{'nodes': []}], 'scene': 0, 'nodes': [], 'meshes': [],
                     'accessors': [], 'bufferViews': [], 'buffers': [], 'materials': [],
                     'textures': [], 'images': [], 'samplers': [], 'skins': [], 'animations': []}
        self.bin = bytearray()
        self.image_uri = image_uri
        self.materials = {}
        self.images = {}
        self.samplers = {}
        self.textures = {}
        self.ext_used = set()

    def add_data(self, acc, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            view['target'] = target
        self.bin += data
        self.json['bufferViews'].append(view)
        acc = dict(acc)
        acc['bufferView'] = len(self.json['bufferViews']) - 1
        self.json['accessors'].append(acc)
        return len(self.json['accessors']) - 1

    def copy_accessor(self, src, index, target=None):
        acc, data = src.accessor(index)
        return self.add_data(acc, data, target)

    def image(self, src, index):
        img = src.json['images'][index]
        if 'uri' not in img:
            raise ValueError(f'{src.path}: embedded images not handled')
        base = os.path.basename(img['uri'])
        if base not in self.images:
            self.json['images'].append({'uri': self.image_uri(base)})
            self.images[base] = len(self.json['images']) - 1
        return self.images[base]

    def texture(self, src, index):
        tex = src.json['textures'][index]
        image = self.image(src, tex['source'])
        sampler = None
        if 'sampler' in tex:
            s = json.dumps(src.json['samplers'][tex['sampler']], sort_keys=True)
            if s not in self.samplers:
                self.json['samplers'].append(json.loads(s))
                self.samplers[s] = len(self.json['samplers']) - 1
            sampler = self.samplers[s]
        key = (image, sampler)
        if key not in self.textures:
            t = {'source': image}
            if sampler is not None:
                t['sampler'] = sampler
            self.json['textures'].append(t)
            self.textures[key] = len(self.json['textures']) - 1
        return self.textures[key]

    def material(self, src, index):
        mat = json.loads(json.dumps(src.json['materials'][index]))
        name = mat.get('name', f'{src.path}#{index}')
        if name in self.materials:
            return self.materials[name]

        def fix(info):
            if isinstance(info, dict) and 'index' in info and set(info) - {'index', 'texCoord', 'scale', 'strength', 'extensions'} == set():
                info['index'] = self.texture(src, info['index'])
                for ext in info.get('extensions', {}):
                    self.ext_used.add(ext)
            return info

        if self.colour_only:
            for key in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
                mat.pop(key, None)
            pbr = mat.setdefault('pbrMetallicRoughness', {})
            pbr.pop('metallicRoughnessTexture', None)
            pbr['metallicFactor'] = 0
            pbr['roughnessFactor'] = 1
        for key in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            if key in mat:
                fix(mat[key])
        pbr = mat.get('pbrMetallicRoughness', {})
        for key in ('baseColorTexture', 'metallicRoughnessTexture'):
            if key in pbr:
                fix(pbr[key])
        self.json['materials'].append(mat)
        self.materials[name] = len(self.json['materials']) - 1
        return self.materials[name]

    def add_mesh(self, src, mesh_index, drop_attr=lambda name: False, prim_filter=None):
        mesh = src.json['meshes'][mesh_index]
        prims = []
        for p in mesh['primitives']:
            if prim_filter:
                made = prim_filter(src, p)
                if made is None:
                    continue
                attrs, indices = made
            else:
                attrs = {k: src.accessor(v) for k, v in p['attributes'].items()}
                indices = src.accessor(p['indices']) if 'indices' in p else None
            prim = {'attributes': {}}
            for name, (acc, data) in attrs.items():
                if drop_attr(name):
                    continue
                prim['attributes'][name] = self.add_data(acc, data, 34962)
            if indices is not None:
                prim['indices'] = self.add_data(indices[0], indices[1], 34963)
            if 'material' in p:
                prim['material'] = self.material(src, p['material'])
            if 'mode' in p:
                prim['mode'] = p['mode']
            prims.append(prim)
        if not prims:
            return None
        self.json['meshes'].append({'name': mesh.get('name', ''), 'primitives': prims})
        return len(self.json['meshes']) - 1

    def add_node(self, node):
        self.json['nodes'].append(node)
        return len(self.json['nodes']) - 1

    def import_scene(self, src, name, drop_attr=lambda n: False, prim_filter=None, skip_node=None,
                     animations=None, meshes=True):
        """Copies `src`'s default scene under a new top-level node `name`. Returns the node map."""
        nodes = src.json['nodes']
        node_map = {}

        def visit(i):
            n = nodes[i]
            if skip_node and skip_node(n):
                return None
            out = {k: n[k] for k in ('name', 'translation', 'rotation', 'scale', 'matrix') if k in n}
            index = self.add_node(out)
            node_map[i] = index
            if meshes and 'mesh' in n:
                m = self.add_mesh(src, n['mesh'], drop_attr, prim_filter)
                if m is not None:
                    out['mesh'] = m
                    if 'skin' in n:
                        out['_skin'] = n['skin']
            kids = [visit(c) for c in n.get('children', [])]
            kids = [k for k in kids if k is not None]
            if kids:
                out['children'] = kids
            return index

        scene = src.json['scenes'][src.json.get('scene', 0)]
        roots = [visit(i) for i in scene['nodes']]
        top = self.add_node({'name': name, 'children': [r for r in roots if r is not None]})
        self.json['scenes'][0]['nodes'].append(top)
        skin_map = {}
        for i, out_index in node_map.items():
            out = self.json['nodes'][out_index]
            if '_skin' in out:
                s = out.pop('_skin')
                if s not in skin_map:
                    skin_map[s] = self.copy_skin(src, s, node_map)
                out['skin'] = skin_map[s]
        if animations:
            self.copy_animations(src, node_map, animations)
        return node_map

    def copy_skin(self, src, s, node_map, ibm_from=None):
        skin = src.json['skins'][s]
        out = {'joints': [node_map[j] for j in skin['joints']]}
        if 'name' in skin:
            out['name'] = skin['name']
        if 'inverseBindMatrices' in skin:
            ibm_src, ibm_index = ibm_from or (src, skin['inverseBindMatrices'])
            out['inverseBindMatrices'] = ibm_src_copy(self, ibm_src, ibm_index)
        if 'skeleton' in skin and skin['skeleton'] in node_map:
            out['skeleton'] = node_map[skin['skeleton']]
        self.json['skins'].append(out)
        return len(self.json['skins']) - 1

    def copy_animations(self, src, node_map, keep, channel_filter=None):
        for anim in src.json.get('animations', []):
            if anim.get('name') not in keep:
                continue
            samplers = []
            sampler_map = {}
            channels = []
            for ch in anim['channels']:
                target = ch['target']
                if target.get('node') not in node_map:
                    continue
                if channel_filter and not channel_filter(src.json['nodes'][target['node']], target['path']):
                    continue
                si = ch['sampler']
                if si not in sampler_map:
                    sm = anim['samplers'][si]
                    samplers.append({'input': self.copy_accessor(src, sm['input']),
                                     'output': self.copy_accessor(src, sm['output']),
                                     'interpolation': sm.get('interpolation', 'LINEAR')})
                    sampler_map[si] = len(samplers) - 1
                channels.append({'sampler': sampler_map[si],
                                 'target': {'node': node_map[target['node']], 'path': target['path']}})
            self.json['animations'].append({'name': keep[anim['name']], 'samplers': samplers, 'channels': channels})

    def write(self, path):
        j = self.json
        for key in ('skins', 'animations', 'textures', 'images', 'samplers', 'materials'):
            if not j[key]:
                del j[key]
        if self.ext_used:
            j['extensionsUsed'] = sorted(self.ext_used)
        while len(self.bin) % 4:
            self.bin.append(0)
        j['buffers'] = [{'byteLength': len(self.bin)}]
        text = json.dumps(j, separators=(',', ':')).encode()
        while len(text) % 4:
            text += b' '
        total = 12 + 8 + len(text) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(text), 0x4E4F534A))
            f.write(text)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942))
            f.write(self.bin)


def ibm_src_copy(builder, src, index):
    return builder.copy_accessor(src, index)


def filter_triangles(src, prim, keep_vertex, drop_attr):
    """A primitive's attributes and indices with only the triangles whose three corners pass
    `keep_vertex(position)`, its vertices compacted. Returns None if nothing is left."""
    pos_acc, pos = src.values(prim['attributes']['POSITION'])
    idx_acc, idx = src.values(prim['indices'])
    kept = []
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        if all(keep_vertex(pos[v * 3:v * 3 + 3]) for v in (a, b, c)):
            kept.append((a, b, c))
    if not kept:
        return None
    remap = {}
    order = []
    for tri in kept:
        for v in tri:
            if v not in remap:
                remap[v] = len(order)
                order.append(v)
    attrs = {}
    for name, ai in prim['attributes'].items():
        if drop_attr(name):
            continue
        acc, data = src.accessor(ai)
        fmt, size = COMPONENT[acc['componentType']]
        elem = size * COUNT[acc['type']]
        out = bytearray()
        for v in order:
            out += data[v * elem:(v + 1) * elem]
        acc = dict(acc)
        acc['count'] = len(order)
        if name == 'POSITION':
            xs = array('f')
            xs.frombytes(bytes(out))
            acc['min'] = [min(xs[i::3]) for i in range(3)]
            acc['max'] = [max(xs[i::3]) for i in range(3)]
        else:
            acc.pop('min', None)
            acc.pop('max', None)
        attrs[name] = (acc, bytes(out))
    flat = array('I' if len(order) > 65535 else 'H', [remap[v] for tri in kept for v in tri])
    idx_out = {'componentType': 5125 if flat.typecode == 'I' else 5123, 'count': len(flat), 'type': 'SCALAR'}
    return attrs, (idx_out, flat.tobytes())
