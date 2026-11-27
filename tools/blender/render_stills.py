"""Render the 4 presentation stills from koteshwor.blend.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b koteshwor.blend --python tools/blender/render_stills.py
Writes public/renders/{overview,street,bird,dusk}.png (1920x1080, EEVEE).
"""
import bpy, math, os
from mathutils import Euler

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "renders")
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.image_settings.file_format = "PNG"
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    scene.view_settings.view_transform = "Filmic"
ee = scene.eevee
for attr, val in (("use_shadows", True), ("use_raytracing", True), ("taa_render_samples", 64)):
    if hasattr(ee, attr):
        setattr(ee, attr, val)

render_cam = bpy.data.objects["Overview render camera"]
sun = bpy.data.objects["Warm west sun"]
fill = bpy.data.objects["Cool sky fill"]
base_sun = (sun.data.energy, tuple(sun.data.color), sun.rotation_euler.copy())
base_fill = fill.data.energy
world_bg = scene.world.node_tree.nodes.get("Background")
base_world = world_bg.inputs["Strength"].default_value if world_bg else None


def shoot(name, marker, lens):
    render_cam.matrix_world = bpy.data.objects[marker].matrix_world.copy()
    render_cam.data.lens = lens
    scene.camera = render_cam
    scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("STILL", scene.render.filepath)


shoot("overview", "camera_overview", 39)
shoot("street", "camera_street", 28)
shoot("bird", "camera_bird", 35)

# Dusk: low orange sun, dimmer sky, cooler fill.
sun.data.energy = base_sun[0] * .55
sun.data.color = (1.0, .62, .36)
sun.rotation_euler = Euler((math.radians(84), 0, base_sun[2].z), "XYZ")
fill.data.energy = base_fill * .6
if world_bg:
    world_bg.inputs["Strength"].default_value = base_world * .45
shoot("dusk", "camera_overview", 39)
