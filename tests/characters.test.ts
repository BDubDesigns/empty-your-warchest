import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameDataError, characterTextureSizes } from '../src/data';
import { textureBytes } from '../src/bench/logic/stats';
import { data, dataWith } from './helpers';

const characters = data.characters;
const PUBLIC = join(import.meta.dirname, '..', 'public');

interface Accessor {
  count: number;
  min?: number[];
  max?: number[];
}
interface Primitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  targets?: unknown[];
}
interface Material {
  name?: string;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
  pbrMetallicRoughness?: {
    baseColorTexture?: { index: number };
    metallicRoughnessTexture?: unknown;
  };
}
interface Gltf {
  accessors: Accessor[];
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes?: { primitives: Primitive[] }[];
  materials?: Material[];
  textures?: { source: number }[];
  images?: { uri?: string }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string; channels: { target: { node: number; path: string } }[] }[];
}

/** A GLB's JSON chunk (its first), read straight from the file: no three.js. */
function glbJson(path: string): Gltf {
  const file = readFileSync(join(PUBLIC, path));
  expect(file.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const length = file.readUInt32LE(12);
  expect(file.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(file.subarray(20, 20 + length).toString('utf8')) as Gltf;
}

/** A JPEG's width and height, from its first start-of-frame marker. */
function jpegSize(path: string): [number, number] {
  const file = readFileSync(join(PUBLIC, path));
  let at = 2;
  while (at < file.length) {
    const marker = file.readUInt16BE(at);
    const length = file.readUInt16BE(at + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return [file.readUInt16BE(at + 7), file.readUInt16BE(at + 5)];
    }
    at += 2 + length;
  }
  throw new Error(`${path}: no frame header`);
}

function triangles(gltf: Gltf): number {
  let total = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== undefined)
        total += (gltf.accessors[primitive.indices]?.count ?? 0) / 3;
    }
  }
  return total;
}

function jointNames(gltf: Gltf): string[] {
  return (gltf.skins?.[0]?.joints ?? []).map((joint) => gltf.nodes[joint]?.name ?? '');
}

describe('the characters', () => {
  it('validate as shipped', () => {
    expect(characters.models.map((model) => model.id)).toEqual([
      'guard',
      'guard_horns',
      'guard_bare',
      'guard_woman',
      'guard_woman_plate',
      'captain',
    ]);
    expect(characters.clips.map((clip) => clip.id)).toEqual(
      expect.arrayContaining(['idle', 'walk', 'run', 'die', 'hit', 'cower', 'alarm']),
    );
  });

  it('give the guards 4 to 6 looks, sharing their colour maps, the gold the captain’s alone', () => {
    const looks = characters.guards.map((id) => characters.models.find((model) => model.id === id));
    expect(looks.length).toBeGreaterThanOrEqual(4);
    expect(looks.length).toBeLessThanOrEqual(6);
    const maps = new Set(looks.flatMap((look) => look?.maps ?? []));
    // Two knight colourways and the bare heads' map (shared with the captain): nothing more.
    expect([...maps].sort()).toEqual(['guard', 'guard_dark', 'heads']);
    expect(characters.models.find((model) => model.id === 'captain')?.maps).toContain('captain');
    expect(maps.has('captain')).toBe(false);
  });

  it('reject guard looks that are not characters, or twice over', () => {
    expect(() =>
      dataWith((raw) => {
        raw.characters.guards = ['guard', 'dragon'];
      }),
    ).toThrow('Unknown model "dragon"');
    expect(() =>
      dataWith((raw) => {
        raw.characters.guards = ['guard', 'guard_horns', 'guard'];
      }),
    ).toThrow('Duplicate look "guard"');
    expect(() =>
      dataWith((raw) => {
        raw.characters.guards = [];
      }),
    ).toThrow(GameDataError);
  });

  it('reject clips, models and maps that are not there', () => {
    expect(() =>
      dataWith((raw) => {
        raw.characters.idleClip = 'dance';
      }),
    ).toThrow(GameDataError);
    expect(() =>
      dataWith((raw) => {
        raw.characters.idleClip = 'die';
      }),
    ).toThrow('The idle clip must loop');
    expect(() =>
      dataWith((raw) => {
        raw.characters.preview.crowd.clips = ['idle', 'moonwalk'];
      }),
    ).toThrow('Unknown clip "moonwalk"');
    expect(() =>
      dataWith((raw) => {
        delete raw.characters.tiers.low.textureSizes.heads;
      }),
    ).toThrow('No size for map "heads"');
    expect(() =>
      dataWith((raw) => {
        raw.characters.tiers.high.textureSizes.guard = 2048 as 1024;
      }),
    ).toThrow(GameDataError);
    expect(() =>
      dataWith((raw) => {
        const guard = raw.characters.models[0];
        if (guard) guard.triangles.low = guard.triangles.high + 1;
      }),
    ).toThrow('Low must not have more triangles than High');
    expect(() =>
      dataWith((raw) => {
        raw.characters.clips.push({ id: 'idle', label: 'Idle again', play: 'loop' });
      }),
    ).toThrow('Duplicate clip "idle"');
  });

  describe.each(characters.models)('$name', (model) => {
    it.each(['high', 'low'] as const)(
      'ships on %s within its triangles, one draw per colour map, colour maps only',
      (tier) => {
        const gltf = glbJson(model.files[tier]);
        expect(triangles(gltf)).toBeLessThanOrEqual(model.triangles[tier]);
        // A Low copy that's worth having: at least half the budget's triangles.
        expect(triangles(gltf)).toBeGreaterThan(model.triangles[tier] / 2);
        const primitives = (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives);
        expect(gltf.meshes).toHaveLength(1);
        expect(primitives).toHaveLength(model.maps.length);
        for (const primitive of primitives) {
          expect(primitive.targets ?? []).toEqual([]);
          expect(Object.keys(primitive.attributes).sort()).toEqual([
            'JOINTS_0',
            'NORMAL',
            'POSITION',
            'TEXCOORD_0',
            'WEIGHTS_0',
          ]);
        }
        const maps = (gltf.materials ?? []).map((material) => {
          expect(material.normalTexture).toBeUndefined();
          expect(material.occlusionTexture).toBeUndefined();
          expect(material.emissiveTexture).toBeUndefined();
          expect(material.pbrMetallicRoughness?.metallicRoughnessTexture).toBeUndefined();
          const texture =
            gltf.textures?.[material.pbrMetallicRoughness?.baseColorTexture?.index ?? -1];
          return gltf.images?.[texture?.source ?? -1]?.uri;
        });
        expect(maps.sort()).toEqual(model.maps.map((map) => `tex/${map}.jpg`).sort());
        expect(jointNames(gltf).length).toBeLessThanOrEqual(characters.maxBones);
      },
    );

    it('has the same skeleton on both tiers', () => {
      expect(jointNames(glbJson(model.files.low))).toEqual(jointNames(glbJson(model.files.high)));
    });

    it('has the bones the clips play on, and the characters’ body height (feet at 0)', () => {
      const gltf = glbJson(model.files.high);
      // Every look has the guard's skeleton (the clips play on it by name).
      expect(jointNames(gltf)).toEqual(jointNames(glbJson(characters.models[0]?.files.high ?? '')));
      const bounds = (gltf.meshes ?? [])
        .flatMap((mesh) => mesh.primitives)
        .map((primitive) => gltf.accessors[primitive.attributes.POSITION ?? -1]);
      const bottom = Math.min(...bounds.map((accessor) => accessor?.min?.[1] ?? Infinity));
      const top = Math.max(...bounds.map((accessor) => accessor?.max?.[1] ?? -Infinity));
      expect(Math.abs(bottom)).toBeLessThan(0.05);
      // As tall as the body every look is drawn by (horns may stand above it).
      expect(top).toBeGreaterThan(characters.body[1] - 0.06);
      expect(top).toBeLessThan(characters.body[1] + 0.3);
    });
  });

  it('ships every clip the data names, each moving only bones the characters have', () => {
    const clips = glbJson(characters.clipFile);
    expect(clips.meshes ?? []).toEqual([]);
    const names = (clips.animations ?? []).map((clip) => clip.name);
    expect(names).toEqual(expect.arrayContaining(characters.clips.map((clip) => clip.id)));
    const bones = new Set(jointNames(glbJson(characters.models[0]?.files.high ?? '')));
    for (const clip of clips.animations ?? []) {
      expect(clip.channels.length).toBeGreaterThan(0);
      for (const channel of clip.channels) {
        expect(bones).toContain(clips.nodes[channel.target.node]?.name);
        // Scale never moves; translation only at the hips (the bones keep their own lengths).
        expect(channel.target.path).not.toBe('scale');
        if (channel.target.path === 'translation') {
          expect(clips.nodes[channel.target.node]?.name).toBe('pelvis');
        }
      }
    }
  });

  it('saves every colour map at each size, and each tier stays within its texture memory', () => {
    const maps = new Set(characters.models.flatMap((model) => model.maps));
    for (const map of maps) {
      for (const size of characterTextureSizes) {
        expect(jpegSize(`models/characters/tex-${String(size)}/${map}.jpg`)).toEqual([size, size]);
      }
    }
    for (const tier of ['high', 'low'] as const) {
      const look = characters.tiers[tier];
      const bytes = [...maps].reduce((sum, map) => {
        const size = look.textureSizes[map] ?? 0;
        return sum + textureBytes(size, size);
      }, 0);
      expect(bytes / (1024 * 1024)).toBeLessThanOrEqual(look.maxTextureMB);
    }
  });
});
