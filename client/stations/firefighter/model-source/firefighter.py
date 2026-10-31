"""Editable Blender source for the isolated firefighter study.

Run: blender -b --python firefighter.py -- <output-directory>
The shape is an exploratory procedural sculpt, not an approved production asset.
"""
import bpy
import math
import os
import sys
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.dirname(__file__)
os.makedirs(out, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color, roughness=.55, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat

skin = material('Кожа', (.67, .38, .27))
red = material('Красная ткань', (.56, .035, .024))
red_dark = material('Швы и каска', (.31, .016, .012))
yellow = material('Светоотражающая ткань', (.95, .70, .065), .4)
silver = material('Светлая полоса', (.68, .70, .60), .42, .15)
hair = material('Каштановые волосы', (.10, .043, .022))
boots = material('Сапоги и перчатки', (.025, .031, .032), .38)
white = material('Белки глаз', (.95, .87, .76), .28)
iris = material('Радужка', (.20, .09, .035), .30)
black = material('Зрачки', (.015, .012, .010), .2)
mouth = material('Линия губ', (.25, .065, .05))

def surface(name, rings, mat):
    """Build a continuous ring mesh from authored cross-sections."""
    verts = [v for ring in rings for v in ring]
    n = len(rings[0]); faces = []
    for j in range(len(rings)-1):
        for i in range(n):
            k = (i + 1) % n
            faces.append((j*n+i, j*n+k, (j+1)*n+k, (j+1)*n+i))
    faces.extend([tuple(reversed(range(n))), tuple((len(rings)-1)*n+i for i in range(n))])
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
    ob = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def gauss(x, z, cx, cz, sx, sz):
    return math.exp(-((x-cx)/sx)**2 - ((z-cz)/sz)**2)

def head_mesh():
    rings = []
    for j in range(1, 48):
        theta = math.pi * j / 48
        ring = []
        for i in range(96):
            phi = 2*math.pi*i/96
            vertical = math.cos(theta)
            width = .52 * (1 - .14*max(0, -vertical))
            x = width * math.sin(theta)*math.cos(phi)
            z = 2.32 + .55*vertical
            y = .46 * math.sin(theta)*math.sin(phi)
            front = max(0, -math.sin(phi))**7
            # Nose, cheeks and eye sockets are part of the same head surface.
            shape = .095*gauss(x,z,0,2.25,.105,.15)
            shape += .045*(gauss(x,z,.28,2.17,.14,.12)+gauss(x,z,-.28,2.17,.14,.12))
            shape -= .075*(gauss(x,z,.19,2.38,.12,.10)+gauss(x,z,-.19,2.38,.12,.10))
            shape += .025*gauss(x,z,0,2.05,.18,.07)
            y -= front*shape
            ring.append((x,y,z))
        rings.append(ring)
    return surface('Голова — единая поверхность', list(reversed(rings)), skin)

head_mesh()

def oval(name, center, scale, mat, segments=32, levels=20):
    rings=[]
    for j in range(1, levels):
        t=math.pi*j/levels
        rings.append([(center[0]+scale[0]*math.sin(t)*math.cos(2*math.pi*i/segments),
                       center[1]+scale[1]*math.sin(t)*math.sin(2*math.pi*i/segments),
                       center[2]+scale[2]*math.cos(t)) for i in range(segments)])
    return surface(name, list(reversed(rings)), mat)

def curve_tube(name, points, radius, mat):
    curve=bpy.data.curves.new(name, 'CURVE'); curve.dimensions='3D'; curve.resolution_u=16
    curve.bevel_depth=radius; curve.bevel_resolution=3
    spline=curve.splines.new('BEZIER'); spline.bezier_points.add(len(points)-1)
    for point, xyz in zip(spline.bezier_points, points):
        point.co=xyz; point.handle_left_type='AUTO'; point.handle_right_type='AUTO'
    ob=bpy.data.objects.new(name, curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active=ob; ob.select_set(True); bpy.ops.object.convert(target='MESH'); ob.select_set(False)
    for p in ob.data.polygons: p.use_smooth=True
    return ob

for side in (-1, 1):
    x=side*.19
    oval('Глаз', (x,-.385,2.38), (.114,.060,.13), white)
    oval('Радужка', (x,-.439,2.38), (.063,.016,.076), iris)
    oval('Зрачок', (x,-.452,2.38), (.033,.009,.045), black)
    oval('Блик', (x-.018,-.461,2.414), (.014,.006,.017), white, 20, 12)
    curve_tube('Верхнее веко', [(x-.112,-.398,2.39),(x-.075,-.43,2.49),(x,-.443,2.51),(x+.075,-.43,2.49),(x+.112,-.398,2.39)], .017, skin)
    curve_tube('Нижнее веко', [(x-.108,-.398,2.37),(x-.07,-.43,2.29),(x,-.44,2.27),(x+.07,-.43,2.29),(x+.108,-.398,2.37)], .011, skin)
    curve_tube('Бровь', [(x-.095,-.393,2.57),(x,-.424,2.59),(x+.095,-.393,2.56)], .014, hair)
    oval('Ухо', (side*.51,-.015,2.28), (.075,.065,.13), skin)
curve_tube('Улыбка', [(-.10,-.416,2.09),(0,-.452,2.065),(.10,-.416,2.09)], .009, mouth)

# Hair cap is one continuous sculpted surface with an uneven fringe edge.
rings=[]
for j in range(1, 26):
    ring=[]
    for i in range(96):
        phi=2*math.pi*i/96; front=max(0,-math.sin(phi))
        edge=1.92-front*(.91+.08*math.sin(phi*3+.4)+.05*math.sin(phi*7))
        theta=edge*j/25
        sweep=1+.018*math.sin(phi*5+theta*3)
        ring.append((.535*math.sin(theta)*math.cos(phi)*sweep,
                     .475*math.sin(theta)*math.sin(phi)*sweep+.015,
                     2.34+.57*math.cos(theta)))
    rings.append(ring)
surface('Причёска — цельная оболочка', list(reversed(rings)), hair)

def cross_sections(name, sections, mat, n=40):
    rings=[]
    for z,cx,cy,rx,ry in sections:
        rings.append([(cx+rx*math.cos(i*2*math.pi/n), cy+ry*math.sin(i*2*math.pi/n), z) for i in range(n)])
    return surface(name,rings,mat)

cross_sections('Куртка', [(0.85,0,0,.32,.24),(.90,0,0,.43,.30),(1.10,0,0,.45,.31),(1.42,0,0,.43,.29),(1.64,0,0,.36,.26),(1.73,0,0,.23,.18)], red)
for z in (1.00, 1.12):
    cross_sections('Отражающая лента', [(z,0,0,.453,.314),(z+.055,0,0,.453,.314)], yellow)
cross_sections('Воротник', [(1.67,0,0,.24,.19),(1.79,0,0,.24,.19)],red_dark)
cross_sections('Шея', [(1.76,0,0,.15,.14),(1.91,0,0,.16,.14)],skin)
curve_tube('Застёжка', [(0,-.314,.91),(0,-.318,1.36),(0,-.28,1.66)], .008, red_dark)

for side in (-1,1):
    x=side*.22
    cross_sections('Брюки',[(.18,x,0,.155,.15),(.35,x,0,.17,.16),(.68,x,0,.19,.18),(.91,x,0,.21,.19)],red_dark)
    for z in (.29,.39): cross_sections('Полоса брючин',[(z,x,0,.177,.167),(z+.045,x,0,.177,.167)],yellow)
    cross_sections('Сапог',[(.035,x,-.09,.18,.26),(.09,x,-.09,.20,.28),(.19,x,-.05,.185,.23),(.32,x,0,.17,.16)],boots)
    # Curved tapered sleeve is built as a single sectioned mesh along the arm.
    rings=[]
    for j in range(18):
        t=j/17; cx=side*(.32+.27*t); z=1.65-.62*t; r=(.18-.035*t)*(.65+.35*min(1,t*8))
        rings.append([(cx+r*math.cos(2*math.pi*i/32), r*.92*math.sin(2*math.pi*i/32), z) for i in range(32)])
    surface('Рукав',list(reversed(rings)),red)
    for z in (1.06,1.14): cross_sections('Полоса рукава',[(z,side*.56,0,.15,.15),(z+.045,side*.55,0,.15,.15)],yellow,32)
    oval('Перчатка',(side*.59,0,.96),(.13,.12,.17),boots)

# Helmet cap is a continuous radial shell, with a brim and badge.
cross_sections('Поля каски',[(2.78,0,-.005,.57,.50),(2.82,0,-.005,.59,.51),(2.85,0,0,.51,.45)],red_dark,64)
cross_sections('Каска',[(2.82,0,0,.51,.45),(2.94,0,0,.49,.43),(3.05,0,0,.40,.36),(3.14,0,0,.22,.20),(3.16,0,0,.05,.05)],red,64)
oval('Эмблема каски',(0,-.45,2.96),(.10,.025,.12),yellow)

# A small editable armature with rigid weights; deformation weights need artist refinement.
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
rig=bpy.context.object; rig.name='Риг — черновая основа'; edit=rig.data.edit_bones
edit.remove(edit[0])
def bone(name, head, tail, parent=None):
    b=edit.new(name); b.head=head; b.tail=tail
    if parent: b.parent=edit[parent]
bone('pelvis',(0,0,.72),(0,0,1.05))
bone('spine',(0,0,1.05),(0,0,1.70),'pelvis')
bone('head',(0,0,1.70),(0,0,2.65),'spine')
for side,label in [(-1,'L'),(1,'R')]:
    bone('arm.'+label,(side*.34,0,1.58),(side*.59,0,.98),'spine')
    bone('leg.'+label,(side*.22,0,.85),(side*.22,0,.14),'pelvis')
bpy.ops.object.mode_set(mode='OBJECT')
for ob in list(bpy.context.scene.objects):
    if ob.type != 'MESH': continue
    groups={b.name:ob.vertex_groups.new(name=b.name) for b in rig.data.bones}
    for v in ob.data.vertices:
        x,y,z=ob.matrix_world @ v.co
        if z>1.8: name='head'
        elif z<.89 and abs(x)>.06: name='leg.'+('R' if x>0 else 'L')
        elif .90<z<1.74 and abs(x)>.44: name='arm.'+('R' if x>0 else 'L')
        elif z<1.05: name='pelvis'
        else: name='spine'
        groups[name].add([v.index],1.0,'REPLACE')
    mod=ob.modifiers.new('Черновой риг','ARMATURE'); mod.object=rig
    ob.parent=rig

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'firefighter.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'firefighter.glb'), export_format='GLB', export_apply=True)
print('EXPORTED', out)
