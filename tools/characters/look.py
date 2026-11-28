"""Renders a quick look at kit parts dressed together (Blender, Workbench, colour maps only), to pick
outfits before building them. Imports glTF files only (data); never opens the kits' .blend files.
usage: blender --background --disable-autoexec --python tools/characters/look.py -- \
         <out.png> [--texture <old name>=<new png>] [--pose <anim.glb> <clip> <0..1>[,<0..1>...]]
         [--camera <distance m> <height m> <lens mm>] <part.gltf> [...]
With several times, writes <out>-<n>.png for each."""
import math, os, sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv.pop(0)
swaps = {}
pose = None
camera = (5.5, 1.1, 75)
parts = []
while argv:
    arg = argv.pop(0)
    if arg == '--texture':
        old, new = argv.pop(0).split('=', 1)
        swaps[old] = new
    elif arg == '--camera':
        camera = tuple(float(argv.pop(0)) for _ in range(3))
    elif arg == '--pose':
        pose = (argv.pop(0), argv.pop(0), [float(t) for t in argv.pop(0).split(',')])
    else:
        parts.append(arg)

bpy.ops.wm.read_factory_settings(use_empty=True)
armatures = []
for path in parts:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == 'ARMATURE']
    armatures += arms
for image in bpy.data.images:
    base = os.path.basename(image.filepath) or image.name
    for old, new in swaps.items():
        if base.startswith(old) or image.name.startswith(old):
            if image.packed_file:
                image.unpack(method='REMOVE')
            image.source = 'FILE'
            image.filepath = new
            image.reload()

if pose:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=pose[0])
    action = bpy.data.actions.get(pose[1])
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o, do_unlink=True)
    if action is None:
        raise SystemExit(f'no clip {pose[1]}')
    start, end = action.frame_range
    for arm in armatures:
        arm.animation_data_create()
        arm.animation_data.action = action
        try:
            arm.animation_data.action_slot = action.slots[0]
        except (AttributeError, IndexError):
            pass
    pose_frames = [int(round(start + (end - start) * t)) for t in pose[2]]

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 600
scene.render.resolution_y = 600
scene.render.filepath = out
world = bpy.data.worlds.new('w')
scene.world = world
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = camera[2]
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
d = camera[0]
yaw = math.radians(25)
cam.location = (d * math.sin(yaw), -d * math.cos(yaw), camera[1])
cam.rotation_euler = (math.radians(88), 0, yaw)
if pose and len(pose_frames) > 1:
    for n, frame in enumerate(pose_frames):
        scene.frame_set(frame)
        scene.render.filepath = out.replace('.png', f'-{n}.png')
        bpy.ops.render.render(write_still=True)
else:
    if pose:
        scene.frame_set(pose_frames[0])
    bpy.ops.render.render(write_still=True)
