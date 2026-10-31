"""Render four orthographic reference views without saving or modifying the blend file.

blender -b firefighter-art.blend --python render_views.py -- /path/to/output
"""
import bpy
import math
import os
import sys
from mathutils import Vector

output = sys.argv[sys.argv.index('--') + 1]
os.makedirs(output, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('Фон для просмотра')
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get('Background')
background.inputs['Color'].default_value = (0.28, 0.32, 0.30, 1)
background.inputs['Strength'].default_value = 0.7

def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

for name, location, energy, size in [
    ('Мягкий основной свет', (-4, -6, 7), 500, 5),
    ('Мягкий заполняющий свет', (5, -2, 4), 300, 5),
    ('Свет сзади', (0, 5, 5), 300, 4),
]:
    light = bpy.data.lights.new(name, 'AREA'); light.energy = energy; light.shape = 'DISK'; light.size = size
    obj = bpy.data.objects.new(name, light); scene.collection.objects.link(obj); obj.location = location
    point_at(obj, (0, 0, 1.6))

camera_data = bpy.data.cameras.new('Ортографическая камера')
camera_data.type = 'ORTHO'
camera = bpy.data.objects.new('Ортографическая камера', camera_data)
scene.collection.objects.link(camera); scene.camera = camera
for name, location, target, scale in [
    ('front', (0, -10, 1.58), (0, 0, 1.58), 3.55),
    ('side', (10, 0, 1.58), (0, 0, 1.58), 3.55),
    ('back', (0, 10, 1.58), (0, 0, 1.58), 3.55),
    ('face', (0, -10, 2.40), (0, 0, 2.40), 1.35),
    ('head-front', (0, -10, 2.40), (0, 0, 2.40), 1.65),
    ('head-side', (10, 0, 2.40), (0, 0, 2.40), 1.65),
    ('head-45', (7.071, -7.071, 2.40), (0, 0, 2.40), 1.65),
]:
    camera.location = location; camera_data.ortho_scale = scale; point_at(camera, target)
    scene.render.filepath = os.path.join(output, name + '.png')
    bpy.ops.render.render(write_still=True)
