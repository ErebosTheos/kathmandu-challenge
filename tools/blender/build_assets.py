"""Build the Koteshwor traffic asset library in Blender 5.3.

Run with Blender -b --python path/to/build_assets.py -- --review to also render review grids.
Vehicle coordinates are longitudinal X, lateral Y, and height Z in metres.
"""
from __future__ import annotations

import json
import math
import random
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public" / "models"
VEHICLES = ("Motorcycle", "Car", "CarSilver", "CarRed", "CarGrey", "Taxi", "Microbus",
            "SajhaBus", "OldBus", "SafaTempo", "Truck")
PROPS = (
    "Pedestrian", "PedestrianWoman", "PedestrianStudent", "PedestrianElder", "PolicePerson",
    "PoliceBooth", "ElectricPole", "ElectricPoleTransformer",
    "StreetLight", "BusShelter", "BusStopSign", "TeaStall", "WaterTank", "Signboard",
    "TrafficSignalHead", "Cone", "Railing", "Planter", "Tree", "ParkedMotorcycle",
)
PALETTE = {}
GRAIN = {}
BASE_COLORS = {}
BODY_PAINTS = set()
DUST = (.39, .32, .24)


def linear(value):
    return value / 12.92 if value < .04045 else ((value + .055) / 1.055) ** 2.4


def rgb(hex_code):
    return tuple(linear(int(hex_code[i:i + 2], 16) / 255) for i in (0, 2, 4))


def material(name, color, rough=.65, metal=0, coat=0, grain=.10, glow=0, glass=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb(color), 1)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = mat.diffuse_color
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Coat Weight"].default_value = coat
    if coat:
        shader.inputs["Coat Roughness"].default_value = .16
    if glass:
        # Tinted glazing uses dielectric reflections on the exterior shell.
        shader.inputs["IOR"].default_value = 1.47
    if glow:
        shader.inputs["Emission Color"].default_value = (*rgb(color), 1)
        shader.inputs["Emission Strength"].default_value = glow
    tint = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "SurfaceTint"
    mat.node_tree.links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    PALETTE[name] = mat
    GRAIN[name] = grain
    BASE_COLORS[name] = rgb(color)
    return mat


def make_palette():
    for name, color in {
        "pearl": "e9e6db", "silver": "b8c4ca", "white": "f0eee5",
        "carRed": "aa2334", "carGrey": "3f464a", "transitBlue": "155392", "skyBlue": "4f9ac3",
        "coachRed": "c62728", "coachGold": "efaf30", "coachBlue": "184b9b",
        "tempoGreen": "116a39", "truckBlue": "354c60", "bikeRed": "aa2929",
    }.items():
        material(name, color, .25, .27 if name in ("silver", "carGrey") else .06, .77, .045)
        BODY_PAINTS.add(name)
    material("helmet", "243641", .25, .06, .69, .05)
    for name, color, rough, metal, grain in (
        ("rubber", "181817", .86, 0, .18), ("sidewall", "363431", .73, 0, .24),
        ("trim", "22262a", .54, 0, .13), ("seam", "282929", .77, 0, .10),
        ("chrome", "b7c3cc", .20, .86, .05), ("alloy", "a2a8ab", .32, .64, .13),
        ("steel", "51575a", .57, .63, .27), ("rust", "854e36", .84, .24, .34),
        ("concrete", "b0a79a", .88, 0, .35), ("dirtyWhite", "d2cbb5", .83, 0, .32),
        ("wood", "825a3d", .85, 0, .32), ("bark", "665345", .93, 0, .38),
        ("soil", "78624b", 1, 0, .45), ("leaf", "546a33", .89, 0, .43),
        ("newLeaf", "75833c", .9, 0, .43), ("shadeLeaf", "3c542f", .9, 0, .43),
        ("skin", "a06546", .73, 0, .20), ("hair", "302823", .88, 0, .22),
        ("silverHair", "a09b93", .79, 0, .21), ("kurta", "a94f61", .83, 0, .19),
        ("shawl", "d5b492", .91, 0, .22), ("uniformBlue", "a9c0d4", .80, 0, .19),
        ("elderWool", "55574e", .94, 0, .24), ("topi", "b28a80", .89, 0, .26),
        ("denim", "39546a", .89, 0, .25), ("shirt", "a46a59", .91, 0, .27),
        ("policeBlue", "4388b4", .81, 0, .25), ("navy", "253647", .88, 0, .22),
        ("canvas", "74574c", .91, 0, .31), ("canvasLight", "a17c65", .87, 0, .32),
        ("plastic", "292c2f", .64, 0, .27), ("orange", "d85f2c", .69, 0, .20),
        ("reflector", "e4ded0", .45, .08, .09), ("signBlue", "215989", .59, .14, .21),
        ("plateRed", "95232a", .58, .18, .13), ("plateBlack", "202427", .62, .12, .16),
    ):
        material(name, color, rough, metal, grain=grain)
    material("glass", "202f3c", .12, .09, .65, .09, glass=True)
    material("sideGlass", "19262e", .145, .07, .58, .12, glass=True)
    material("visor", "182631", .20, .2, .62, .14, glass=True)
    material("headlamp", "f6edda", .23, .24, .48, .09, .46)
    material("tail", "c52724", .24, .13, .39, .12, .38)
    material("taxiLight", "f8f3e1", .26, .05, .40, .04, .35)
    material("amber", "e9922c", .31, .13, .41, .14, .25)
    material("signalGreen", "32874d", .33, .08, .22, .15, .12)


class Mesh:
    def __init__(self, name):
        self.name = name
        self.vertices = []
        self.faces = []
        self.surfaces = []
        self.smooth = []
        self.uv = {}
        self.dust_range = None

    def points(self, points):
        first = len(self.vertices)
        self.vertices.extend(points)
        return list(range(first, len(self.vertices)))

    def face(self, indices, surface, smooth=False):
        self.faces.append(indices)
        self.surfaces.append(surface)
        self.smooth.append(smooth)

    def patch(self, points, surface, outward, uv=None):
        a, b, c = map(Vector, points[:3])
        if (b - a).cross(c - a).dot(Vector(outward)) < 0:
            points = points[::-1]
            if uv is not None:
                uv = uv[::-1]
        if uv is not None:
            self.uv[len(self.faces)] = uv
        self.face(self.points(points), surface)

    def bands(self, rings, surface, smooth=False, cap=True):
        """Join equal-sized, consistently wound section loops."""
        ids = [self.points(ring) for ring in rings]
        for a, b in zip(ids, ids[1:]):
            for j, k in zip(range(len(a)), (*range(1, len(a)), 0)):
                self.face((a[j], a[k], b[k], b[j]), surface, smooth)
        if cap:
            self.face(ids[0][::-1], surface)
            self.face(ids[-1], surface)

    def box(self, xyz, dimensions, surface, bevel=.02):
        x, y, z = xyz
        w, d, h = (value / 2 for value in dimensions)
        b = min(bevel, min(w, d, h) * .46)
        if not b:
            ring = [(-w, -d), (w, -d), (w, d), (-w, d)]
            self.bands([[(x + a, y + c, z + level) for a, c in ring] for level in (-h, h)], surface)
            return
        rings = []
        for level, inset in [(-h, b * .85), (-h + b, 0), (h - b, 0), (h, b * .85)]:
            u, v, cut = w - inset, d - inset, b * .8
            ring = [(-u + cut, -v), (u - cut, -v), (u, -v + cut), (u, v - cut),
                    (u - cut, v), (-u + cut, v), (-u, v - cut), (-u, -v + cut)]
            rings.append([(x + a, y + c, z + level) for a, c in ring])
        self.bands(rings, surface)

    def tube(self, start, end, r1, surface, segments=8, r2=None, profile=None):
        start, end = Vector(start), Vector(end)
        axis = (end - start).normalized()
        u = axis.cross(Vector((0, 0, 1) if abs(axis.z) < .9 else (0, 1, 0))).normalized()
        v = axis.cross(u)
        circle = [u * math.cos(2 * math.pi * j / segments) + v * math.sin(2 * math.pi * j / segments)
                  for j in range(segments)]
        if profile is None:
            profile = [(0, r1), (1, r1 if r2 is None else r2)]
        rings = [[tuple(start.lerp(end, fraction) + radius * point) for point in circle]
                 for fraction, radius in profile]
        self.bands(rings, surface, smooth=True)

    def oval(self, xyz, dimensions, surface, segments=10, rings=5, tilt=0, jitter=0, rng=None):
        x, y, z = xyz
        rx, ry, rz = (value / 2 for value in dimensions)
        sine, cosine = math.sin(tilt), math.cos(tilt)

        def position(a, b, c):
            return x + cosine * a + sine * c, y + b, z - sine * a + cosine * c

        bottom = self.points([position(0, 0, -rz)])[0]
        levels = []
        for i in range(1, rings):
            latitude = -math.pi / 2 + math.pi * i / rings
            points = []
            for j in range(segments):
                angle = 2 * math.pi * (j + .24 * (i % 2)) / segments
                radius = 1 + (rng.uniform(-jitter, jitter) if jitter else 0)
                points.append(position(rx * radius * math.cos(latitude) * math.cos(angle),
                                       ry * radius * math.cos(latitude) * math.sin(angle),
                                       rz * radius * math.sin(latitude)))
            levels.append(self.points(points))
        top = self.points([position(0, 0, rz)])[0]
        for j in range(segments):
            k = (j + 1) % segments
            self.face((bottom, levels[0][k], levels[0][j]), surface, not jitter)
            for a, b in zip(levels, levels[1:]):
                if jitter:
                    self.face((a[j], a[k], b[j]), surface)
                    self.face((a[k], b[k], b[j]), surface)
                else:
                    self.face((a[j], a[k], b[k], b[j]), surface, True)
            self.face((levels[-1][j], levels[-1][k], top), surface, not jitter)

    def finish(self, collection):
        ground = min(p[2] for p in self.vertices)
        center_x = center_y = 0
        if self.name in VEHICLES:
            center_x, center_y = [
                (min(p[i] for p in self.vertices) + max(p[i] for p in self.vertices)) / 2
                for i in (0, 1)
            ]
        mesh = bpy.data.meshes.new(self.name + " Mesh")
        mesh.from_pydata([(x-center_x, y-center_y, z-ground) for x,y,z in self.vertices],
                         [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        slots = {}
        for surface in dict.fromkeys(self.surfaces):
            slots[surface] = len(mesh.materials)
            mesh.materials.append(PALETTE[surface])
        colors = mesh.color_attributes.new(name="SurfaceTint", type="BYTE_COLOR", domain="CORNER")
        texcoords = mesh.uv_layers.new(name="DecalUV") if self.uv else None
        for poly, surface, smooth in zip(mesh.polygons, self.surfaces, self.smooth):
            poly.material_index = slots[surface]
            poly.use_smooth = smooth
            if texcoords and poly.index in self.uv:
                for loop, uv in zip(poly.loop_indices, self.uv[poly.index]):
                    texcoords.data[loop].uv = uv
            grain = GRAIN[surface]
            red, green, blue = BASE_COLORS[surface]
            for loop in poly.loop_indices:
                p = mesh.vertices[mesh.loops[loop].vertex_index].co
                large = noise.noise(p * 2.7 + Vector((11.3, 5, 8.8)))
                fine = noise.noise(p * 29 + Vector((5.6, 9.8, 3.7)))
                value = 1 - grain * (.50 + .45 * large + .23 * fine)
                tint = (red * value, green * value, blue * value)
                if self.dust_range and surface in BODY_PAINTS | {"trim", "dirtyWhite"}:
                    sill, ceiling = self.dust_range
                    height = p.z + ground
                    fade = max(0, min(1, (ceiling - height) / (ceiling - sill)))
                    dust = fade ** 1.25 * (.59 + .21 * large + .10 * fine)
                    tint = tuple(channel * (1 - dust) + dirt * dust for channel, dirt in zip(tint, DUST))
                colors.data[loop].color = (*tint, 1)
        mesh.calc_loop_triangles()
        obj.asset_mark()
        obj.asset_data.description = "Koteshwor street library, modelled in metres"
        return obj


# Compact bitmap lettering is generated at build time and packed into the GLB.
# Registration marks are fictional and use the game's Latin transliteration.
FONT = {
    "A": (14,17,17,31,17,17,17), "B": (30,17,17,30,17,17,30),
    "C": (14,17,16,16,16,17,14), "D": (30,17,17,17,17,17,30),
    "E": (31,16,16,30,16,16,31), "F": (31,16,16,30,16,16,16),
    "G": (14,17,16,23,17,17,14), "H": (17,17,17,31,17,17,17),
    "I": (14,4,4,4,4,4,14), "J": (7,2,2,2,18,18,12),
    "K": (17,18,20,24,20,18,17), "L": (16,16,16,16,16,16,31),
    "M": (17,27,21,21,17,17,17), "N": (17,25,21,19,17,17,17),
    "O": (14,17,17,17,17,17,14), "P": (30,17,17,30,16,16,16),
    "Q": (14,17,17,17,21,18,13), "R": (30,17,17,30,20,18,17),
    "S": (15,16,16,14,1,1,30), "T": (31,4,4,4,4,4,4),
    "U": (17,17,17,17,17,17,14), "V": (17,17,17,17,17,10,4),
    "W": (17,17,17,21,21,27,17), "X": (17,17,10,4,10,17,17),
    "Y": (17,17,10,4,4,4,4), "Z": (31,1,2,4,8,16,31),
    "0": (14,17,19,21,25,17,14), "1": (4,12,4,4,4,4,14),
    "2": (14,17,1,2,4,8,31), "3": (30,1,1,14,1,1,30),
    "4": (2,6,10,18,31,2,2), "5": (31,16,16,30,1,1,30),
    "6": (14,16,16,30,17,17,14), "7": (31,1,2,4,8,8,8),
    "8": (14,17,17,14,17,17,14), "9": (14,17,17,15,1,1,14),
    "-": (0,0,0,14,0,0,0),
}


def lettering(lines, bg, fg="efede2"):
    name = " / ".join(lines) + " [" + bg + "]"
    if name in PALETTE:
        return name
    width, height = max(map(len, lines)) * 6 + 3, len(lines) * 9 + 2
    scale = 3
    rng = random.Random(name)
    ink, base = (tuple(int(code[i:i+2], 16) / 255 for i in (0,2,4)) for code in (fg,bg))
    canvas = []
    for y in range(height * scale):
        row, gy = divmod(height - 1 - y // scale - 2, 9)
        line = lines[row] if 0 <= row < len(lines) else ""
        for x in range(width * scale):
            column, gx = divmod(x // scale - (width - len(line) * 6) // 2, 6)
            ch = line[column] if 0 <= column < len(line) else " "
            painted = gx < 5 and gy < 7 and FONT.get(ch, (0,) * 7)[gy] & (16 >> gx)
            color = ink if painted else base
            variation = rng.uniform(.93, 1)
            canvas.extend((*[value * variation for value in color], 1))
    return packed_texture(name, bg, width * scale, height * scale, canvas)


def packed_texture(name, bg, width, height, pixels, roughness=.62, coat=0):
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(pixels)
    image.pack()
    mat = material(name, bg, roughness, .04, coat, grain=0)
    nodes = mat.node_tree.nodes
    # The decal already contains its palette. Export a neutral vertex tint over it.
    BASE_COLORS[name] = (1, 1, 1)
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    mat.node_tree.links.new(texture.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    return name


def decal(m, center, width, height, axis, sign, lines, bg, fg="efede2"):
    center = Vector(center)
    normal = Vector((sign, 0, 0) if axis == "X" else (0, sign, 0))
    right = Vector((0, sign, 0) if axis == "X" else (-sign, 0, 0)) * (width / 2)
    up = Vector((0, 0, height / 2))
    m.patch([center - right - up, center + right - up, center + right + up, center - right + up],
            lettering(lines, bg, fg), normal, [(0, 0), (1, 0), (1, 1), (0, 1)])


def plate(m, x, z, front, private, mark, width=.34, height=.106, y=0):
    sign = 1 if front else -1
    base = "plateRed" if private else "plateBlack"
    m.box((x, y, z), (.022, width + .013, height + .013), base, .008)
    decal(m, (x + sign * .012, y, z), width, height, "X", sign, mark,
          "95232a" if private else "202427")
    for offset in (-1, 1):
        m.tube((x + sign * .01, y + offset * width * .454, z + height * .32),
               (x + sign * .015, y + offset * width * .454, z + height * .32), .005, "alloy", 6)


def wheel(m, x, y, r, width, sign, hub=True, segments=20, z=None):
    z = r if z is None else z
    inside = (x, y - sign * width / 2, z)
    outside = (x, y + sign * width / 2, z)
    m.tube(inside, outside, r, "rubber", segments,
           profile=[(0, r*.82), (.11, r*.93), (.27, r), (.74, r), (.91, r*.94), (1, r*.81)])
    sidewall(m, x, outside[1] + sign*.001, z, r*.62, r*.805, sign, segments)
    if not hub:
        return
    inner_face, outer_face = outside, (x, outside[1] + sign * .016, z)
    m.tube(inner_face, outer_face, r * .60, "alloy", segments, r * .56)
    m.tube(outer_face, (x, outer_face[1] + sign * .012, z), r * .39, "steel", 12)
    m.tube(outer_face, (x, outer_face[1] + sign * .030, z), r * .17, "chrome", 10)
    for j in range(5):
        angle = j * 2 * math.pi / 5
        p = x + math.cos(angle) * r * .30
        q = z + math.sin(angle) * r * .30
        m.tube((p, outer_face[1], q), (p, outer_face[1] + sign * .015, q), r * .049, "alloy", 6)


def sidewall(m, x, y, z, inner, outer, sign, segments):
    def ring(radius):
        return m.points([(x + radius*math.cos(i*math.tau/segments), y,
                          z + radius*math.sin(i*math.tau/segments)) for i in range(segments)])

    a, b = ring(inner), ring(outer)
    for i in range(segments):
        j = (i+1) % segments
        face = (a[i], a[j], b[j], b[i])
        m.face(face if sign == 1 else face[::-1], "sidewall")


def axle_pair(m, x, half_track, r, width, segments=20):
    for side in (-1, 1):
        wheel(m, x, side * half_track, r, width, side, segments=segments)


def datum(stations, x):
    for a, b in zip(stations, stations[1:]):
        if x <= b[0] + 1e-6:
            ratio = (x - a[0]) / (b[0] - a[0])
            return tuple(v + (w - v) * ratio for v, w in zip(a[1:], b[1:]))
    return stations[-1][1:]


def body(m, stations, arches, surface, lip=None, bands=(), livery=None, smooth=False):
    """Loft from (X, half width, sill height, shoulder top) stations.

    Sample wheel openings into the loft so they remain open in silhouette.
    Color bands are integral faces and follow the same wheel-opening profile.
    """
    samples = {row[0] for row in stations}
    for center, radius, wheel_z in arches:
        samples.update(center + radius * math.cos(i * math.pi / 12) for i in range(13)
                       if stations[0][0] < center + radius * math.cos(i * math.pi / 12) < stations[-1][0])
        samples.update(center + side * (radius + .024) for side in (-1,1)
                       if stations[0][0] < center + side * (radius + .024) < stations[-1][0])
    rings = []
    for x in sorted(samples):
        w, floor, top = datum(stations, x)
        for center, radius, wheel_z in arches:
            if abs(x - center) <= radius:
                floor = max(floor, wheel_z + math.sqrt(max(0, radius**2 - (x-center)**2)))
        shoulder = min(.10, (top - floor) * .22)
        levels = [(w*.93, floor), (w, floor + shoulder*.64)]
        edge = floor + shoulder*.64
        levels.extend((w, edge + (top - shoulder - edge) * pos) for pos, _ in bands)
        levels.extend([(w, top - shoulder), (w*.93, top)])
        rings.append([(x, -levels[0][0], floor), *[(x, y, z) for y, z in levels],
                      *[(x, -y, z) for y, z in reversed(levels[1:])]])
    ids = [m.points(ring) for ring in rings]
    n = len(rings[0])
    for a, b in zip(ids, ids[1:]):
        for j in range(n):
            k = (j + 1) % n
            band_id = min(j, n-j)
            color = lip if lip and band_id <= 1 else surface
            if 2 <= band_id < 2 + len(bands):
                color = bands[band_id-2][1]
            face = (a[j], a[k], b[k], b[j])
            if livery and 2 <= band_id <= n//2-2:
                m.uv[len(m.faces)] = [((x-stations[0][0])/(stations[-1][0]-stations[0][0]), z / 1.45)
                                      for x, _, z in (m.vertices[index] for index in face)]
                color = livery
            m.face(face, color, smooth)
    m.face(ids[0][::-1], surface)
    m.face(ids[-1], surface)


def upper_point(section, side, height, offset=0):
    x0, x1, y0, y1, z0, z1 = section
    return Vector((x0 + (x1-x0)*height, side*(y0 + (y1-y0)*height + offset), z0 + (z1-z0)*height))


def side_panel(m, a, b, side, span, heights, material_name, offset=.012):
    def point(t, h):
        return upper_point(a, side, h, offset).lerp(upper_point(b, side, h, offset), t)

    t0, t1 = span
    h0, h1 = heights
    m.patch([point(t0,h0), point(t1,h0), point(t1,h1), point(t0,h1)], material_name, (0, side, 0))


def end_panel(m, section, sign, width, heights, surface, offset=.014):
    def point(side, height):
        value = upper_point(section, side, height)
        value.x += sign * offset
        return value

    def row(height):
        left, right = point(-1, height), point(1, height)
        return left.lerp(right, (1-width)/2), left.lerp(right, (1+width)/2)

    low, high = map(row, heights)
    m.patch([low[0], low[1], high[1], high[0]], surface, (sign, 0, 0))


def end_sign(m, section, side, width, heights, lines, background, foreground="efede2"):
    points = []
    for lateral, height in ((-1,heights[0]),(1,heights[0]),(1,heights[1]),(-1,heights[1])):
        p = upper_point(section, lateral * side, height)
        points.append((p.x + side*.028, lateral*side*width/2, p.z))
    m.patch(points, lettering(lines, background, foreground), (side,0,0),
            [(0,0),(1,0),(1,1),(0,1)])


def cabin(m, sections, surface, window_spans, roof=.075, front_glass=(.94, (.12, .88)),
          rear_glass=(.89, (.18, .85)), roof_surface=None, smooth_roof=False):
    for a, b in zip(sections, sections[1:]):
        for side in (-1, 1):
            side_panel(m, a, b, side, (0,1), (0,1), surface, 0)
    for side in (-1, 1):
        for index, span, heights in window_spans:
            a, b = sections[index:index+2]
            side_panel(m, a, b, side, span, heights, "trim")
            inner_span = (span[0]+.009, span[1]-.009)
            inner_heights = (heights[0]+.023, heights[1]-.023)
            side_panel(m, a, b, side, inner_span, inner_heights, "sideGlass", .019)
            side_panel(m, a, b, side, inner_span, (inner_heights[1]-.038, inner_heights[1]),
                       "glass", .022)
    for section, sign, glaze in ((sections[0], -1, rear_glass), (sections[-1], 1, front_glass)):
        end_panel(m, section, sign, 1, (0,1), surface, 0)
        if glaze:
            w, (low, high) = glaze
            end_panel(m, section, sign, w, (low,high), "trim")
            end_panel(m, section, sign, w-.032, (low+.022,high-.025), "glass", .020)
    rings = []
    for section in sections:
        _, x, _, y, _, z = section
        rings.append([(x,-y,z), (x,y,z), (x,y*.985,z+roof*.48), (x,y*.90,z+roof*.92),
                      (x,y*.68,z+roof), (x,-y*.68,z+roof), (x,-y*.90,z+roof*.92), (x,-y*.985,z+roof*.48)])
    m.bands(rings, roof_surface or surface, smooth=smooth_roof)


def mirrors(m, x, w, z, large=False):
    arm, height = (.27, .32) if large else (.13, .115)
    for side in (-1, 1):
        y = side * w
        m.tube((x,y,z-.045), (x+.035,y+side*arm,z), .025 if large else .016, "trim", 7)
        m.box((x+.035,y+side*arm,z), (.12 if large else .13, .13 if large else .14, height), "trim", .025)
        m.patch([(x-.029,y+side*arm+u,z+v) for u,v in
                 [(-.053,-height*.40),(.053,-height*.40),(.053,height*.40),(-.053,height*.40)]],
                "chrome", (-1,0,0))


def lights(m, x, y, z, sign, width, height, surface, slope=.12):
    """Inset bezel with a faceted wrap-around lens."""
    for side in (-1, 1):
        outline = [(-.49,-.30),(-.39,-.50),(.34,-.50),(.50,-.27),
                   (.47,.29),(.33,.50),(-.43,.43),(-.50,.20)]
        for scale, mat, lift in ((1.11,"trim",0), (1,surface,.013)):
            points = [(x + sign*(lift - slope*u), side*(y + u*width*scale), z + v*height*scale)
                      for u,v in outline]
            m.patch(points, mat, (sign,0,0))


def hatch_lamps(m, shell, front):
    """Project the lenses onto the rounded hatchback shell so they wrap the corners."""
    sign = 1 if front else -1
    outline = ([(.326,.687),(.378,.669),(.625,.705),(.722,.788),(.704,.820),(.526,.772)]
               if front else [(.522,.803),(.649,.776),(.747,.801),(.755,.879),(.706,.905),(.551,.868)])
    center_y = sum(y for y, _ in outline)/len(outline)
    center_z = sum(z for _, z in outline)/len(outline)
    for side in (-1,1):
        def project(y, z, lift):
            hit, _, _, _ = shell.ray_cast((sign*3,side*y,z),(-sign,0,0))
            if hit is None:
                raise RuntimeError(f"Lamp outline falls outside {m.name} body at {y:.3f}, {z:.3f}")
            return hit + Vector((sign*lift,0,0))

        def fitted_triangle(a, b, c, paint, lift):
            # Small facets stay outside the convex shell between projection samples.
            steps = 4
            points = {(i,j): project(*(a + (b-a)*(i/steps) + (c-a)*(j/steps)), lift)
                      for i in range(steps+1) for j in range(steps+1-i)}
            for i in range(steps):
                for j in range(steps-i):
                    m.patch([points[i,j],points[i+1,j],points[i,j+1]],paint,(sign,0,0))
                    if i+j < steps-1:
                        m.patch([points[i+1,j],points[i+1,j+1],points[i,j+1]],paint,(sign,0,0))

        center = Vector((center_y,center_z))
        for scale, paint, lift in ((1.045,"trim",.009),(.87,"headlamp" if front else "tail",.016)):
            points = [center.lerp(Vector(point),scale) for point in outline]
            for a,b in zip(points, points[1:]+points[:1]):
                fitted_triangle(center,a,b,paint,lift)

        y, z = (.48,.699) if front else (.63,.838)
        a,b,c,d = [Vector(point) for point in [(y-.066,z-.005),(y+.066,z+.012),
                                               (y+.066,z+.026),(y-.066,z+.009)]]
        paint = "chrome" if front else "headlamp"
        fitted_triangle(a,b,c,paint,.023)
        fitted_triangle(a,c,d,paint,.023)


def grille(m, x, z, width, height, ribs=4):
    m.box((x, 0, z), (.035, width, height), "trim", .019)
    for j in range(ribs):
        h = z + height * ((j+1)/(ribs+1) - .5)
        m.box((x+.020, 0, h), (.011, width*.89, height*.075), "alloy", .003)


def wipers(m, front, width, z, sweep=.18):
    for side in (-1, 1):
        m.tube((front,side*width*.67,z), (front-.037,side*width*.30,z+sweep*.24), .010, "trim", 5)
        m.tube((front-.037,side*width*.30,z+sweep*.24),
               (front-.06,side*width*.08,z+sweep*.50), .008, "trim", 5)


def handles(m, xs, width, z, surface="trim"):
    for x in xs:
        for side in (-1,1):
            m.box((x, side*width, z), (.125,.027,.034), surface, .009)


def seam(m, points, radius=.005):
    for a, b in zip(points, points[1:]):
        m.tube(a, b, radius, "seam", 5)


def hatchback(name, paint, mark, taxi=False):
    m = Mesh(name)
    m.dust_range = (.30, .68)
    wheelbase = (-1.11, 1.11)
    stations = [(-1.77,.62,.39,.79),(-1.72,.704,.34,.86),(-1.62,.768,.30,.94),
                (-1.46,.796,.28,.963),(-.62,.812,.275,.975),(.42,.815,.275,.983),
                (.94,.811,.276,.969),(1.22,.801,.30,.93),(1.43,.778,.32,.888),
                (1.60,.737,.35,.832),(1.71,.653,.38,.765),(1.77,.542,.417,.69)]
    body(m, stations, [(x,.323,.281) for x in wheelbase], paint, "trim",
         ((.28,paint),(.58,paint)), smooth=True)
    shell = BVHTree.FromPolygons(m.vertices,m.faces)
    hatch_lamps(m,shell,True)
    hatch_lamps(m,shell,False)
    sections = [(-1.62,-1.30,.712,.526,.938,1.39),(-1.41,-1.13,.754,.615,.949,1.485),
                (-.58,-.51,.772,.651,.954,1.515),(.12,.075,.774,.642,.962,1.501),
                (.52,.33,.758,.615,.946,1.455),(1.00,.40,.715,.594,.910,1.405)]
    cabin(m, sections, paint, [(0,(.24,.945),(.29,.79)), (1,(.02,.935),(.19,.87)),
                                (2,(.026,.97),(.17,.90)), (3,(.03,.98),(.155,.92)),
                                (4,(.022,.935),(.143,.90))], .067,
          front_glass=(.97,(.049,.965)), rear_glass=(.95,(.12,.89)), smooth_roof=True)
    for x in wheelbase:
        axle_pair(m, x, .676, .281, .173)
    for side in (-1,1):
        def flank(x, z):
            return x, side * (datum(stations, x)[0] + .003), z

        seam(m, [flank(-.82,.45),flank(-.73,.647),flank(-.69,.866),
                 flank(-.68,.893),flank(.89,.90),flank(.85,.73),flank(.70,.44),
                 flank(.62,.402),flank(-.70,.402),flank(-.82,.45)])
        seam(m, [flank(.035,.402),flank(.06,.63),flank(.08,.894)])
        m.box((-.02,side*.805,.359), (1.30,.023,.040), paint, .012)
        m.box((1.588,side*.717,.483),(.10,.035,.067),"trim",.012)
        m.box((-1.704,side*.659,.548),(.043,.096,.026),"tail",.009)
    handles(m, (-.56,.21), .810, .85, "chrome" if name == "CarGrey" else "trim")
    mirrors(m, .82, .752, 1.02)
    m.box((1.725,0,.49), (.108,1.13,.12), paint, .043)
    m.box((-1.718,0,.441), (.103,1.25,.088), "trim", .029)
    grille(m, 1.77, .591, .80, .127, 3)
    m.box((1.786,0,.455), (.025,.73,.057), "trim", .016)
    m.oval((1.746,0,.706),(.023,.086,.047),"chrome",10,4)
    wipers(m,.94,.70,.976)
    m.tube((-.94,0,1.554),(-1.10,0,1.671),.007,"trim",6)
    plate(m,1.814,.504,True,not taxi,mark)
    plate(m,-1.775,.647,False,not taxi,mark)
    if taxi:
        m.box((-.13,0,1.59), (.185,.322,.035), "trim", .013)
        m.box((-.13,0,1.641), (.161,.292,.087), "taxiLight", .016)
        for side in (-1,1):
            decal(m,(-.13+side*.083,0,1.640),.251,.058,"X",side,("TAXI",),"f8f3e1","202427")
    return m


def microbus():
    m = Mesh("Microbus")
    m.dust_range = (.33, .88)
    axles = (-1.56,1.46)
    body(m,[(-2.32,.83,.40,1.145),(-2.23,.925,.35,1.15),(-1.96,.945,.33,1.16),
            (1.27,.945,.33,1.16),(1.92,.922,.36,1.06),(2.22,.878,.38,.96),
            (2.31,.805,.43,.91)],[(x,.385,.344) for x in axles],"pearl","trim",
         ((.28,"pearl"),(.57,"pearl")))
    sections = [(-2.30,-2.18,.842,.79,1.08,1.995),(-2.20,-2.04,.917,.858,1.11,2.025),
                (-1.18,-1.13,.934,.873,1.12,2.045),(.24,.23,.934,.873,1.12,2.045),
                (1.31,1.23,.93,.868,1.12,2.04),(2.12,1.58,.866,.817,.935,1.95)]
    cabin(m,sections,"white",[(1,(.027,.98),(.22,.89)),(2,(.022,.98),(.19,.89)),
                               (3,(.025,.98),(.19,.89)),(4,(.04,.95),(.21,.87))],.10)
    for x in axles:
        axle_pair(m,x,.755,.344,.195)
    handles(m,(-.25,1.43),.935,1.11)
    mirrors(m,1.95,.876,1.20)
    for side in (-1,1):
        m.box((-.63,side*.951,.958),(2.49,.022,.055),"trim",.008)
        seam(m, [(-1.18,side*.884,1.969),(-1.18,side*.943,1.117),
                 (-1.18,side*.949,.704),(-1.09,side*.949,.644),(.24,side*.949,.644),
                 (.31,side*.949,.702),(.30,side*.944,1.116),(.25,side*.883,1.969),
                 (-1.18,side*.884,1.969)])
        m.tube((-1.68,side*.725,2.245),(.54,side*.725,2.245),.022,"steel",7)
        for x in (-1.56,-.53,.43):
            m.tube((x,side*.712,2.112),(x,side*.725,2.245),.021,"steel",6)
    for x in (-1.63,-1.12,-.61,-.10,.47):
        m.tube((x,-.748,2.227),(x,.748,2.227),.018,"alloy",7)
    m.box((2.22,0,.479),(.235,1.64,.19),"dirtyWhite",.062)
    m.box((-2.26,0,.401),(.17,1.73,.14),"trim",.052)
    grille(m,2.314,.737,.87,.123,3)
    lights(m,2.316,.634,.773,1,.384,.184,"headlamp",.17)
    lights(m,-2.323,.756,.819,-1,.16,.37,"tail",.065)
    lights(m,-2.334,.756,.876,-1,.128,.08,"amber",.065)
    wipers(m,2.035,.865,1.10)
    plate(m,2.347,.516,True,False,("BA 3 KHA","1234"))
    plate(m,-2.336,.739,False,False,("BA 3 KHA","1234"))
    end_sign(m,sections[0],-1,.79,(.79,.897),("KOTESHWOR - RATNAPARK",),"28363a")
    return m


def coach_livery():
    """Painted ribbons and dust in a packed atlas shared by both bus flanks."""
    from array import array

    name = "Araniko Express painted livery"
    width, height = 1024, 148
    red, gold, blue, ivory, burgundy = [(198,36,38), (246,173,39), (19,55,135),
                                        (251,226,153), (114,24,36)]
    rng = random.Random(81)
    pixels = array("f")
    for j in range(height):
        v = j / (height-1)
        for i in range(width):
            u = i / (width-1)
            sweep = .42 + .19*math.sin(math.tau*(1.21*u+.15)) + .053*math.sin(math.tau*3.1*u)
            offset = v - sweep
            color = red
            if abs(offset + .19) < .021:
                color = burgundy
            if -.087 < offset < .19:
                color = gold
            if -.068 < offset < .058:
                color = blue
            if .063 < offset < .082 or .165 < offset < .182 or .891 < v < .908:
                color = ivory
            if .908 <= v:
                color = blue
            dust = max(0, (.76-v)/.49)**1.7 * (.26 + .050*math.sin(82*u+v*19) + rng.random()*.06)
            value = .96 + .04*rng.random()
            pixels.extend([min(1, (channel*value*(1-dust) + dirt*dust)/255)
                           for channel, dirt in zip(color,(148,132,111))] + [1])
    return packed_texture(name, "c62728", width, height, pixels, .25, .68)


def bus(name, modern):
    m = Mesh(name)
    if modern:
        rear, front, half, wheel_r = -4.51, 4.51, 1.235, .455
        axles = (-2.68,2.50)
        lower, upper, trim = "transitBlue","transitBlue","trim"
        stripe = ((.34,"transitBlue"),(.73,"skyBlue"),(.87,"pearl"))
        base, roof_z, roof_thickness = 1.20, 2.94, .115
    else:
        rear, front, half, wheel_r = -4.98, 4.98, 1.245, .493
        axles = (-2.91,2.87)
        lower, upper, trim = "coachRed","coachGold","steel"
        stripe = ((.24,"coachRed"),(.49,"coachRed"),(.74,"coachRed"))
        base, roof_z, roof_thickness = 1.45, 3.16, .15
    m.dust_range = (.39, 1.20 if modern else 1.28)
    body(m,[(rear,half-.13,.51,base-.014),(rear+.12,half-.035,.40,base),
            (rear+.43,half,.41,base), (front-.54,half,.40,base),
            (front-.18,half-.037,.43,base-.042),(front,half-.14,.55,base-.10)],
         [(x,wheel_r+.088,wheel_r) for x in axles],lower,trim,stripe,
         livery=None if modern else coach_livery())
    xs = [rear+.028,rear+.225,rear+1.67,rear+3.11,rear+4.55,rear+5.99,
          rear+7.43]
    if not modern:
        xs.append(rear+8.62)
    xs.extend([front-.58,front-.025])
    sections = []
    for i,x in enumerate(xs):
        end = i in (0,len(xs)-1)
        sections.append((x,x+(.10 if i==0 else -.18 if end else 0),
                         half-(.12 if end else .013),half-(.19 if end else .067),
                         base-(.13 if i==len(xs)-1 else .024),roof_z-(.065 if end else 0)))
    spans = [(i,(.02,.98),(.11,.865)) for i in range(1,len(sections)-2)]
    cabin(m,sections,upper,spans,roof_thickness,
          front_glass=(.98,(.16,.88)),rear_glass=(.92,(.19,.77)))
    for side in (-1,1):
        for i in range(1,len(sections)-2):
            a,b = sections[i:i+2]
            side_panel(m,a,b,side,(.032,.967),(.29,.314),"steel",.024)
            if i % 2:
                side_panel(m,a,b,side,(.49,.504),(.32,.817),"steel",.024)
        for x in (rear+.72, front-1.84, front-.80):
            m.box((x,side*(half+.001),.69),(.115,.022,.058),"amber",.009)
        for x in (rear+1.01, rear+3.31, rear+4.60):
            m.box((x,side*(half+.009),base-.115),(.13,.024,.032),"steel",.005)
        for x in (-.91,.74):
            y = side*(half+.002)
            seam(m,[(x-.51,y,.68),(x-.51,y,base-.19),
                    (x+.51,y,base-.19),(x+.51,y,.68),(x-.51,y,.68)],.005)
    for x in axles:
        axle_pair(m,x,half-.185,wheel_r,.237)
    # Kerb-side glazed folding door and its centre mullion.
    a,b = sections[-3:-1]
    side_panel(m,a,b,1,(.19,.95),(.031,.886),"trim",.026)
    for span in ((.226,.547),(.575,.918)):
        side_panel(m,a,b,1,span,(.13,.837),"glass",.031)
    for z in (.55,.68,.83,1.07):
        m.box(((a[0]+b[0])*.50,half+.007,z),(.78,.032,.026),"steel",.006)
    mirrors(m,front-.32,half-.076,2.22,True)
    m.box((front-.10,0,.56),(.27,2*half-.245,.21),lower,.082)
    m.box((rear+.071,0,.51),(.20,2*half-.245,.17),trim,.055)
    lights(m,front+.005,.801,.835,1,.57,.225,"headlamp",.15)
    lights(m,front+.015,.863,.695,1,.22,.053,"amber",.11)
    lights(m,rear-.015,.925,.822,-1,.19,.33,"tail",.07)
    lights(m,rear-.026,.927,.77,-1,.14,.071,"amber",.055)
    wipers(m,front-.055,half-.22,base+.25,.42)
    if modern:
        grille(m,front+.028,.64,.82,.094,3)
        m.box((-.23,0,roof_z+.23),(3.02,1.66,.27),"dirtyWhite",.095)
        for x in (-1.21,-.52,.17,.86):
            m.box((x,0,roof_z+.363),(.098,1.35,.025),"steel",.007)
        route = ("SAJHA YATAYAT", "KOTESHWOR")
        sign = ("SAJHA YATAYAT","ELECTRIC BUS")
        sign_bg = "155392"
        mark = ("BA 5 KHA","9028")
    else:
        grille(m,front+.023,.907,1.02,.16,5)
        m.box((front+.009,0,1.14),(.04,1.96,.138),"coachBlue",.015)
        m.box((front+.019,0,1.251),(.041,1.95,.049),"coachGold",.012)
        for x in (-2.35,-1.86,-1.37,-.88,-.39,-.18):
            m.tube((x,-.955,roof_z+.19),(x,.955,roof_z+.19),.022,"steel",6)
        for side in (-1,1):
            for x in (-2.36,-1.30,-.20):
                m.tube((x,side*.955,roof_z+.118),(x,side*.955,roof_z+.30),.020,"steel",6)
            for z in (roof_z+.19,roof_z+.30):
                m.tube((-2.36,side*.955,z),(-.18,side*.955,z),.023,"alloy",8)
        for x in (-2.36,-.18):
            m.tube((x,-.955,roof_z+.30),(x,.955,roof_z+.30),.020,"steel",7)
        for x,y,w,d,h,paint in ((-1.91,-.42,.74,.73,.28,"canvas"),(-1.70,.42,.95,.69,.31,"navy"),
                                (-1.10,-.45,.70,.61,.28,"canvasLight"),(-.80,.35,.64,.87,.35,"tempoGreen")):
            m.box((x,y,roof_z+.20+h*.5),(w,d,h),paint,.089)
            for offset in (-.22,.22):
                m.box((x+offset*w,y,roof_z+.205+h),(w*.09,d*.92,.014),"trim",.004)
        m.tube((front-.027,.57,base-.032),(front+.104,.57,base-.032),.051,"chrome",12)
        route = ("ARANIKO EXPRESS","BHAKTAPUR - DHULIKHEL")
        sign = ("ARANIKO EXPRESS",)
        sign_bg = "184b9b"
        mark = ("BA 2 KHA","6119")
    end_sign(m,sections[-1],1,1.62,(.845,.962),route,"202427","efd18c")
    for side in (-1,1):
        center, width, height = (-.46,1.92,.166) if modern else (-.48,3.38,.29)
        decal(m,(center,side*(half+.006),base-.15),width,height,"Y",side,sign,sign_bg)
    end_sign(m,sections[0],-1,1.18,(.81,.898),(route[0],),sign_bg)
    plate(m,front+.052,.559,True,False,mark,.42,.133)
    plate(m,rear-.036,.635,False,False,mark,.42,.133)
    return m


def tempo():
    m = Mesh("SafaTempo")
    m.dust_range = (.42, .96)
    rear_axle, front_axle = -.995,1.16
    # The passenger box and cab share a straight waist band above the chassis.
    body(m,[(-1.59,.721,.49,1.11),(-1.52,.752,.47,1.12),(-.36,.752,.47,1.12),
            (.59,.699,.475,1.12),(1.15,.580,.512,1.105),
            (1.33,.500,.594,1.079),(1.44,.393,.649,1.025),(1.49,.278,.68,.974)],
         [(rear_axle,.273,.244)],"white",None,
         ((.27,"white"),(.47,"tempoGreen"),(.70,"tempoGreen"),(.88,"white")))
    cab = [(-.37,-.36,.736,.713,1.117,1.79),(.38,.37,.711,.679,1.117,1.785),
           (1.24,.77,.533,.535,1.087,1.735)]
    cabin(m,cab,"white",[(0,(.25,.975),(.30,.89)),(1,(.052,.872),(.29,.90))],.066,
          front_glass=(.90,(.17,.92)),rear_glass=None)
    box = [(-1.585,-1.585,.737,.737,1.118,1.99),(-.97,-.97,.748,.748,1.119,1.99),
           (-.365,-.365,.748,.748,1.119,1.99)]
    cabin(m,box,"white",[(0,(.105,.91),(.42,.80)),(1,(.071,.914),(.42,.80))],
          .041,front_glass=None,rear_glass=None)
    m.box((-1.002,0,2.023),(1.30,1.563,.092),"white",.026)
    axle_pair(m,rear_axle,.599,.245,.143,16)
    wheel(m,front_axle,0,.274,.165,1,segments=18)
    sidewall(m,front_axle,-.084,.274,.113,.221,-1,18)
    m.tube((front_axle,-.084,.274),(front_axle,-.10,.274),.149,"steel",14,.137)
    m.tube((front_axle,-.10,.274),(front_axle,-.115,.274),.043,"alloy",10)
    m.tube((front_axle,0,.26),(.98,0,.754),.049,"steel")
    fender(m,front_axle,.274,.298,.217,"tempoGreen",-.32,math.pi+.27)
    m.box((-.39,0,.458),(2.30,1.09,.135),"steel",.03)
    mirrors(m,.98,.584,1.45)
    for side in (-1,1):
        m.box((-.367,side*.752,1.251),(.039,.023,1.40),"white",.005)
        seam(m,[(-.326,side*.757,.56),(-.326,side*.745,1.12),
                (-.326,side*.723,1.746)],.006)
        m.box((-.215,side*.747,1.17),(.108,.029,.036),"trim",.007)
        decal(m,(-1.10,side*.756,1.219),.64,.114,"Y",side,("SAFA TEMPO",),"eee9dc","116a39")
    end_panel(m,box[0],-1,.78,(.022,.92),"trim",.020)
    end_panel(m,box[0],-1,.716,(.040,.89),"white",.024)
    end_panel(m,box[0],-1,.60,(.374,.793),"sideGlass",.027)
    m.box((-1.616,0,1.634),(.020,.021,.372),"white",.003)
    m.box((-1.65,0,.392),(.295,.86,.086),"steel",.016)
    for y in (-.352,.352):
        m.tube((-1.74,y,.414),(-1.547,y,.619),.021,"steel",7)
    for x in (-1.59,-1.66,-1.73):
        m.box((x,0,.437),(.025,.81,.016),"trim",.003)
    m.box((1.427,0,.816),(.165,.66,.115),"tempoGreen",.035)
    lights(m,1.451,.285,.801,1,.127,.089,"headlamp",.26)
    lights(m,1.408,.379,.894,1,.097,.047,"amber",.20)
    lights(m,-1.598,.562,.782,-1,.133,.134,"tail",.035)
    plate(m,1.525,.726,True,False,("BA 1 HA","713"),.263,.093)
    plate(m,-1.626,1.019,False,False,("BA 1 HA","713"),.263,.093)
    return m


def truck():
    m = Mesh("Truck")
    m.dust_range = (.45, .95)
    rear_axle, front_axle = -1.56,1.46
    body(m,[(-2.52,.83,.53,.99),(-2.43,.92,.48,1.01),(-2.16,.955,.47,1.04),
            (1.0,.935,.45,1.12),(1.78,.924,.46,1.10),(2.37,.885,.49,1.025),
            (2.50,.78,.57,.968)],[(x,.436,.346) for x in (rear_axle,front_axle)],
         "truckBlue","trim",((.28,"truckBlue"),(.57,"truckBlue")))
    sections = [(-.76,-.76,.907,.792,1.05,1.99),(-.63,-.622,.937,.829,1.095,2.03),
                (.34,.29,.932,.828,1.10,2.028),(1.36,.81,.892,.803,1.094,1.962)]
    cabin(m,sections,"truckBlue",[(1,(.17,.95),(.20,.89)),(2,(.025,.95),(.20,.89))],.082)
    axle_pair(m,rear_axle,.758,.346,.216)
    axle_pair(m,front_axle,.751,.346,.205)
    m.box((-1.59,0,1.008),(1.73,1.74,.10),"steel",.03)
    m.box((-2.46,0,1.185),(.115,1.794,.47),"truckBlue",.023)
    for side in (-1,1):
        seam(m,[(x,side*y,z) for x,y,z in [(-.64,.947,1.105),(-.64,.951,.579),
                                           (.88,.941,.579),(1.12,.941,.733),
                                           (1.17,.932,1.104)]],.006)
        m.box((-1.60,side*.897,1.194),(1.821,.111,.47),"truckBlue",.026)
        m.box((-1.59,side*.913,1.421),(1.87,.123,.052),"trim",.012)
        for x in (-2.28,-1.67,-1.06):
            m.box((x,side*.957,1.23),(.038,.019,.283),"steel",.004)
    m.tube((-2.16,0,.481),(-2.16,0,.376),.292,"rubber",18)
    m.box((2.47,0,.569),(.20,1.70,.145),"steel",.046)
    m.box((-2.52,0,.536),(.14,1.74,.13),"steel",.043)
    grille(m,2.505,.831,.91,.205,5)
    lights(m,2.506,.67,.865,1,.36,.157,"headlamp",.12)
    lights(m,-2.553,.722,.914,-1,.203,.161,"tail",.07)
    mirrors(m,1.16,.895,1.25)
    handles(m,(-.39,),.939,1.106)
    wipers(m,1.284,.83,1.213)
    decal(m,(-2.521,0,1.207),1.02,.147,"X",-1,("TATA",),"354c60")
    plate(m,2.580,.582,True,True,("BA 11 CHA","3629"))
    plate(m,-2.602,.711,False,True,("BA 11 CHA","3629"))
    return m


def fender(m, x, z, radius, width, surface, start, end):
    rings = []
    for i in range(12):
        t = start + (end-start)*i/11
        rings.append([(x+r*math.cos(t), y, z+r*math.sin(t)) for r,y in
                      [(radius-.021,-width/2),(radius-.021,width/2),
                       (radius,width*.45),(radius+.012,width*.28),
                       (radius+.012,-width*.28),(radius,-width*.45)]])
    m.bands(rings, surface, smooth=True)


def moto_wheel(m, x, r, width):
    profile = [
        (-.5,.79),(-.48,.91),(-.32,.985),(-.11,1),
        (.11,1),(.32,.985),(.48,.91),(.5,.79),(.37,.70),(-.37,.70),
    ]
    rings = []
    for i in range(20):
        angle = math.tau * i / 20
        rings.append([(x+r*f*math.cos(angle), y*width, r+r*f*math.sin(angle))
                      for y,f in profile])
    m.bands(rings+[rings[0]], "rubber", smooth=True, cap=False)
    for side in (-1,1):
        sidewall(m,x,side*width*.501,r,r*.739,r*.925,side,20)
        m.tube((x,0,r),(x,side*width*.52,r),r*.25,"alloy",12)
        for j in range(5):
            angle = j*math.tau/5
            m.tube((x+r*.12*math.cos(angle-.36),side*.032,r+r*.12*math.sin(angle-.36)),
                   (x+r*.78*math.cos(angle),side*width*.30,r+r*.78*math.sin(angle)),
                   .015,"alloy",6)
    m.tube((x,.041,r),(x,.058,r),r*.50,"steel",16)
    m.tube((x,.058,r),(x,.064,r),r*.30,"chrome",12)


def motorcycle(ridden):
    m = Mesh("Motorcycle" if ridden else "ParkedMotorcycle")
    m.dust_range = (.31, .66)
    rear, front = -.684,.665
    moto_wheel(m,rear,.309,.127)
    moto_wheel(m,front,.309,.102)
    fender(m,front,.309,.337,.129,"bikeRed",.36,2.53)
    fender(m,rear,.309,.361,.171,"trim",.78,3.32)
    m.box((-.088,0,.424),(.46,.282,.272),"steel",.068)
    for z in (.406,.459,.515):
        m.box((-.071,0,z),(.32,.308,.020),"alloy",.006)
    m.oval((.071,0,.82),(.65,.362,.34),"bikeRed",12,6,tilt=.16)
    m.oval((-.539,0,.752),(.61,.31,.182),"bikeRed",10,5,tilt=.21)
    m.oval((-.429,0,.845),(.68,.292,.12),"trim",12,5,tilt=.09)
    m.tube((.152,0,.980),(.152,0,.994),.045,"chrome",10)
    for side in (-1,1):
        s = side*.074
        m.tube((front,s,.315),(.39,s,.877),.026,"chrome")
        m.tube((front,s,.311),(.54,s,.551),.035,"steel")
        m.tube((rear,1.36*s,.309),(-.182,1.47*s,.417),.027,"steel")
        m.tube((rear,1.32*s,.343),(-.438,1.24*s,.688),.032,"alloy",8)
        m.tube((.37,s,.881),(.09,1.12*s,.417),.028,"trim")
        m.tube((.359,s,.907),(.34,side*.326,.988),.018,"chrome")
        m.tube((.34,side*.266,.988),(.328,side*.381,.991),.026,"rubber",8)
        m.tube((.342,side*.269,1.0),(.385,side*.369,1.165),.009,"steel",6)
        m.oval((.385,side*.369,1.168),(.058,.156,.086),"trim",8,4)
        m.oval((.354,side*.369,1.168),(.012,.13,.068),"chrome",7,3)
        m.tube((-.12,side*.112,.394),(-.12,side*.239,.394),.022,"rubber",6)
        m.tube((-.275,side*.09,.727),(-.711,side*.099,.76),.019,"chrome",6)
    m.tube((.18,-.1,.435),(.027,-.17,.28),.024,"steel")
    m.tube((.027,-.17,.28),(-.352,-.172,.358),.025,"steel")
    m.tube((-.315,-.173,.351),(-.841,-.173,.449),.05,"chrome",10,.037)
    m.tube((-.821,-.173,.445),(-.85,-.173,.45),.023,"trim",8)
    m.tube((.427,0,.846),(.504,0,.846),.098,"trim",14,.089)
    m.tube((.50,0,.846),(.518,0,.846),.083,"headlamp",14,.074)
    m.box((-.839,0,.748),(.105,.173,.068),"tail",.022)
    for side in (-1,1):
        m.oval((-.81,side*.141,.71),(.066,.073,.052),"amber",8,4)
    for x,z,front_plate in ((-.895,.629,False),(.522,.724,True)):
        plate(m,x,z,front_plate,True,("BA 91 PA","6423"),.178,.086)
    if ridden:
        m.oval((-.32,0,1.115),(.25,.375,.56),"navy",12,6,tilt=.29)
        m.oval((-.391,0,.912),(.29,.31,.205),"denim")
        m.oval((-.057,0,1.445),(.263,.256,.296),"helmet",14,7,tilt=-.06)
        m.oval((.033,0,1.444),(.139,.239,.123),"visor",12,5,tilt=-.12)
        m.oval((-.014,0,1.371),(.251,.243,.101),"helmet",12,4)
        m.oval((-.453,0,1.104),(.237,.281,.389),"canvas",10,5,tilt=.28)
        for side in (-1,1):
            limb(m,(-.390,side*.121,.93),(-.063,side*.215,.741),.086,.071,"denim")
            limb(m,(-.063,side*.215,.741),(-.186,side*.197,.427),.070,.043,"denim")
            m.oval((-.114,side*.2,.41),(.244,.109,.089),"trim")
            limb(m,(-.233,side*.17,1.273),(.015,side*.24,1.035),.078,.055,"navy")
            limb(m,(.015,side*.24,1.035),(.311,side*.314,1.001),.057,.037,"navy")
            m.oval((.327,side*.319,.992),(.10,.078,.079),"skin")
    else:
        m.tube((-.198,-.120,.48),(-.372,-.278,.056),.019,"steel",6)
        m.box((-.372,-.278,.051),(.089,.051,.030),"steel",0)
        angle = math.radians(8)
        sine, cosine = math.sin(angle), math.cos(angle)
        m.vertices = [(x, cosine*y-sine*z, sine*y+cosine*z) for x,y,z in m.vertices]
    return m


def limb(m, start, end, width, taper, surface):
    m.tube(start,end,width,surface,8,
           profile=[(0,width*.84),(.22,width),( .71,(width+taper)*.49),(1,taper)])


def person(name, police=False):
    m = Mesh(name)
    woman, student, elder = (name == "Pedestrian" + suffix for suffix in ("Woman", "Student", "Elder"))
    pants, shirt = {
        "PolicePerson": ("navy","policeBlue"), "PedestrianWoman": ("shawl","kurta"),
        "PedestrianStudent": ("navy","uniformBlue"), "PedestrianElder": ("navy","elderWool"),
    }.get(name, ("denim","shirt"))
    hips, shoulder = 0.882,1.345
    m.oval((0,0,hips),(.231,.31,.245),pants,10,5)
    m.oval((.008,0,1.153),(.241,.385,.522),shirt,12,6,tilt=.022)
    m.tube((.02,0,1.335),(.026,0,1.466),.066,"skin",10,.058)
    m.oval((.035,0,1.506),(.196,.163,.232),"skin",12,6)
    m.oval((-.012,0,1.572),(.184,.17,.124),"silverHair" if elder else "hair",10,5)
    m.oval((.129,0,1.496),(.052,.058,.052),"skin",8,4)
    for side in (-1,1):
        m.oval((.026,side*.077,1.501),(.057,.029,.057),"skin",8,4)
        fx = side * (.043 if police else .09 if elder else .18)
        knee = (fx*.65+.022,side*.096,.516)
        ankle = (fx,side*.105,.105)
        limb(m,(0,side*.079,.924),knee,.087,.061,pants)
        limb(m,knee,ankle,.063,.044,pants)
        m.oval((fx+.046,side*.105,.063),(.237,.121,.125),"trim",10,4)
        if police and side == 1:
            elbow, wrist = (.046,.400,1.337),(.09,.64,1.415)
        else:
            elbow, wrist = (-fx*.68,side*.213,1.104),(-fx,side*.227,.912)
        limb(m,(.003,side*.153,shoulder),elbow,.067,.049,shirt)
        limb(m,elbow,wrist,.048,.034,shirt)
        m.oval(wrist,(.085,.072,.113),"reflector" if police else "skin",8,4)
    if police:
        m.tube((.019,0,1.582),(.018,0,1.643),.100,"white",14,.109)
        m.tube((.019,0,1.575),(.019,0,1.596),.099,"navy",14)
        m.oval((.102,0,1.589),(.163,.198,.031),"white",12,4)
        m.box((.061,0,.963),(.177,.314,.036),"trim",.013)
        m.box((.157,0,.963),(.025,.063,.040),"chrome",.007)
        m.box((.124,0,1.213),(.028,.08,.085),"white",.009)
        m.box((.123,-.091,1.303),(.026,.055,.025),"chrome",.005)
    elif woman:
        m.oval((-.105,0,1.52),(.124,.138,.135),"hair",10,5)
        m.oval((-.108,0,1.37),(.125,.111,.256),"hair",9,5)
        loops = []
        for z,xr,yr in ((.65,.125,.193),(.72,.137,.197),(.92,.132,.164),(1.15,.127,.161)):
            loops.append([(xr*math.cos(j*math.tau/12),yr*math.sin(j*math.tau/12),z) for j in range(12)])
        m.bands(loops,"kurta",smooth=True)
        for side in (-1,1):
            m.tube((.035,side*.114,1.378),(.117,side*.081,1.234),.037,"shawl",8)
        m.tube((.117,-.081,1.234),(.125,.081,1.234),.034,"shawl",8)
        m.tube((.117,-.081,1.234),(.077,-.149,.927),.034,"shawl",8,.024)
    elif elder:
        m.tube((-.004,0,1.583),(-.023,0,1.65),.097,"topi",12,.083)
        m.tube((-.004,0,1.579),(-.006,0,1.596),.099,"elderWool",12)
        for side in (-1,1):
            m.oval((.118,side*.045,1.534),(.013,.069,.039),"trim",10,5)
            m.oval((.126,side*.045,1.534),(.012,.052,.028),"chrome",10,5)
        m.tube((.128,-.017,1.539),(.128,.017,1.539),.004,"trim",6)
        m.tube((.123,0,1.466),(.083,0,1.469),.018,"silverHair",8)
        m.tube((.23,-.227,.020),(.095,-.227,.923),.014,"wood",8)
        m.tube((.095,-.227,.923),(.010,-.227,.923),.015,"wood",8)
    else:
        m.oval((-.141,0,1.204),(.194,.315,.362),"navy" if student else "canvas",10,6)
        for side in (-1,1):
            m.tube((.027,side*.139,1.363),(.129,side*.117,1.205),.018,"trim",6)
            m.tube((.129,side*.117,1.205),(.069,side*.135,1.06),.016,"trim",6)
        if student:
            m.box((.114,-.090,1.235),(.025,.068,.074),"uniformBlue",.007)
            m.tube((.112,0,1.354),(.144,0,1.266),.021,"navy",6,.017)
            m.tube((.144,0,1.266),(.135,0,1.059),.017,"navy",6,.010)
    if student or woman or elder:
        scale = .88 if student else .95 if woman else .94
        m.vertices = [(x*scale,y*scale,z*scale) for x,y,z in m.vertices]
    return m


def umbrella(m, z, r):
    count = 10
    for i in range(count):
        a, b = math.tau*i/count, math.tau*(i+1)/count
        mid = (a+b)/2
        peak = (0,0,z+.37)
        inner = (r*.61*math.cos(mid),r*.61*math.sin(mid),z+.16)
        skirt = [(r*math.cos(t),r*math.sin(t),z) for t in (a,b)]
        crown = "canvas" if i%2 else "canvasLight"
        m.patch([peak,inner,skirt[0]],crown,(0,0,1))
        m.patch([peak,skirt[1],inner],crown,(0,0,1))
        m.patch([inner,skirt[1],skirt[0]],crown,(0,0,1))
        m.tube(peak,skirt[0],.009,"steel",5)
        m.patch([skirt[0],skirt[1],(skirt[1][0],skirt[1][1],z-.095),
                 (skirt[0][0],skirt[0][1],z-.095)],crown,(math.cos(mid),math.sin(mid),0))
    m.tube((0,0,.37),(0,0,z+.47),.035,"steel",10,.028)
    m.oval((0,0,z+.46),(.123,.123,.087),"steel",8,4)


def police_booth():
    m = Mesh("PoliceBooth")
    m.box((0,0,.11),(1.45,1.45,.22),"concrete",.055)
    m.box((0,0,.34),(1.14,1.13,.31),"signBlue",.035)
    for y in (-.50,.50):
        m.box((0,y,.75),(1.10,.085,.69),"signBlue",.025)
        m.box((.002,y,1.107),(1.14,.114,.063),"dirtyWhite",.013)
    m.box((-.52,0,.75),(.08,1.05,.69),"signBlue",.025)
    m.box((-.52,0,1.107),(.109,1.07,.063),"dirtyWhite",.013)
    for x in (-.49,.49):
        for y in (-.49,.49):
            m.tube((x,y,.54),(x,y,1.15),.036,"steel",6)
    m.box((.66,0,.112),(.34,.61,.15),"concrete",.023)
    for side in (-1,1):
        decal(m,(0,side*.546,.822),.81,.155,"Y",side,("TRAFFIC POLICE",),"215989")
    umbrella(m,2.29,1.10)
    return m


def electric_pole(transformer):
    m = Mesh("ElectricPoleTransformer" if transformer else "ElectricPole")
    m.tube((0,0,0),(0,0,8.36),.149,"concrete",8,.085)
    m.tube((0,0,0),(0,0,.40),.210,"concrete",8,.160)
    for z,width in [(7.81,1.65),(7.14,1.15)]:
        m.box((0,0,z),(.115,width,.088),"steel",.012)
        for y in (-width*.42,0,width*.42):
            m.tube((0,y,z), (0,y,z+.24),.044,"dirtyWhite",8,
                   profile=[(0,.039),(.18,.084),(.29,.048),(.43,.077),(.58,.045),
                            (.71,.065),(.88,.043),(1,.037)])
    m.box((0,0,5.70),(.121,1.49,.086),"rust",.014)
    for side in (-1,1):
        m.tube((-.08,0,5.39),(-.08,side*.58,5.7),.028,"steel",6)
    if transformer:
        m.tube((.21,0,5.79),(.21,0,6.48),.302,"steel",14)
        for z in (5.83,6.01,6.41,6.48):
            m.tube((.21,0,z),(.21,0,z+.038),.33,"alloy",14)
        for y in (-.29,-.195,-.10,0,.10,.195,.29):
            m.box((.489,y,6.13),(.13,.051,.48),"steel",.009)
        for y in (-.18,0,.18):
            m.tube((.21,y,6.49),(.21,y,6.78),.045,"dirtyWhite",8,
                   profile=[(0,.045),(.23,.070),(.36,.039),(.55,.062),(.71,.037),(1,.046)])
            m.tube((.21,y,6.78),(.42,y*1.8,7.14),.010,"trim",6)
        decal(m,(.576,0,6.11),.27,.13,"X",1,("11 KV",),"efba3d","202427")
    for z in (.64,1.04,1.58,2.44,3.70,5.72,7.16):
        m.tube((-.11,.101,z-.093),(-.11,.101,z+.093),.025,"steel",6)
    return m


def streetlight():
    m = Mesh("StreetLight")
    m.tube((0,0,0),(0,0,7.89),.133,"alloy",12,
           profile=[(0,.132),(.058,.110),(.088,.093),(.92,.056),(1,.052)])
    points = [(0,0,7.73),(.067,0,8.11),(.31,0,8.38),(.75,0,8.49),(1.35,0,8.50)]
    for a,b in zip(points,points[1:]):
        m.tube(a,b,.054,"alloy",10,.047)
    m.oval((1.43,0,8.488),(.71,.301,.141),"steel",12,5)
    m.oval((1.49,0,8.445),(.503,.228,.048),"headlamp",12,4)
    m.box((.091,0,.46),(.019,.118,.227),"steel",.005)
    return m


def bus_shelter():
    m = Mesh("BusShelter")
    m.box((0,0,.081),(3.70,1.56,.162),"concrete",.038)
    for x in (-1.58,1.58):
        for y in (-.59,.56):
            m.box((x,y,1.211),(.092,.086,2.22),"signBlue",.015)
    for x in (-1.1,0,1.1):
        m.box((x,-.609,1.42),(1.06,.038,1.29),"sideGlass",.007)
    for x in (-1.58,-.55,.55,1.58):
        m.box((x,-.623,1.414),(.032,.044,1.29),"alloy",.007)
    m.box((0,-.615,.735),(3.21,.064,.075),"steel",.012)
    m.box((0,-.28,.583),(2.69,.51,.082),"wood",.019)
    for x in (-1.1,1.1):
        m.box((x,-.28,.352),(.083,.075,.39),"steel",.013)
    corrugated_roof(m,0,0,2.39,3.76,1.81,"signBlue")
    decal(m,(0,.909,2.356),1.63,.123,"Y",1,("KOTESHWOR  BUS STOP",),"215989")
    return m


def corrugated_roof(m, x, y, z, width, depth, surface):
    m.box((x,y,z-.02),(width,depth,.09),surface,.028)
    for i in range(22):
        p = x + width*((i+.5)/22-.5)
        m.box((p,y,z+.031),(.031,depth*.995,.022),"alloy" if i%5==0 else surface,0)


def bus_stop_sign():
    m = Mesh("BusStopSign")
    m.tube((0,0,0),(0,0,2.65),.038,"alloy",10)
    m.box((0,0,2.42),(.100,.50,.447),"signBlue",.024)
    for side in (-1,1):
        decal(m,(side*.051,0,2.42),.438,.382,"X",side,("BUS","STOP"),"215989")
    return m


def tea_stall():
    m = Mesh("TeaStall")
    m.box((0,0,.062),(2.67,2.02,.124),"concrete",.033)
    m.box((-.85,0,1.16),(.132,1.83,2.08),"wood",.039)
    for y in (-.87,.87):
        m.box((-.025,y,.56),(1.79,.10,.895),"tempoGreen",.027)
        m.box((-.79,y,1.545),(.172,.08,1.354),"wood",.020)
        m.box((.78,y,1.557),(.085,.085,1.354),"steel",.015)
    m.box((.811,0,.566),(.113,1.74,.886),"tempoGreen",.018)
    m.box((.793,0,1.022),(.451,1.91,.111),"wood",.022)
    for y in [-.76,-.57,-.38,-.19,0,.19,.38,.57,.76]:
        m.box((.873,y,.565),(.024,.043,.703),"steel",.005)
    corrugated_roof(m,.016,0,2.255,2.39,2.09,"rust")
    m.box((1.107,0,2.094),(.11,1.91,.261),"coachRed",.025)
    decal(m,(1.165,0,2.096),1.76,.205,"X",1,("KOTESHWOR CHIYA",),"b43835")
    for y in (-.37,-.26,-.15):
        m.tube((.79,y,1.08),(.79,y,1.194),.032,"alloy",8,.045)
    m.oval((.678,.43,1.216),(.252,.276,.291),"alloy",12,6)
    m.tube((.68,.43,1.34),(.68,.43,1.391),.064,"trim",10,.038)
    m.tube((.75,.49,1.233),(.90,.603,1.338),.03,"steel",8,.018)
    return m


def water_tank():
    m = Mesh("WaterTank")
    m.tube((0,0,0),(0,0,1.376),.56,"plastic",24,
           profile=[(0,.53),(.036,.60),(.11,.615),(.82,.615),(.92,.559),(1,.31)])
    for z in (.18,.36,.54,.72,.90,1.08):
        m.tube((0,0,z),(0,0,z+.052),.625,"plastic",24,
               profile=[(0,.615),(.32,.626),(.73,.626),(1,.615)])
    m.tube((0,0,1.363),(0,0,1.473),.196,"trim",18)
    m.tube((.58,0,.215),(.735,0,.215),.046,"steel",10)
    m.tube((.732,0,.215),(.732,0,.052),.037,"alloy",10)
    return m


def signboard():
    m = Mesh("Signboard")
    for y in (-.75,.75):
        m.tube((0,y,0),(0,y,2.51),.048,"steel",8)
    m.box((0,0,2.253),(.105,1.84,.528),"steel",.022)
    decal(m,(.054,0,2.253),1.78,.466,"X",1,("KOTESHWOR","RING ROAD  -  AIRPORT"),"2e7747")
    return m


def traffic_head():
    m = Mesh("TrafficSignalHead")
    m.box((-.111,0,.588),(.229,.325,1.17),"trim",.047)
    for z,surface in ((.927,"tail"),(.586,"amber"),(.245,"signalGreen")):
        m.tube((.005,0,z),(.052,0,z),.125,"trim",14)
        m.tube((.050,0,z),(.072,0,z),.103,surface,16,.097)
        points = [(0,.13*math.cos(j*math.pi/9),z+.13*math.sin(j*math.pi/9)) for j in range(10)]
        for a,b in zip(points,points[1:]):
            m.patch([a,b,(.179,b[1]*.94,b[2]),(.179,a[1]*.94,a[2])],"trim",
                    (0,(a[1]+b[1])/2,(a[2]+b[2])/2-z))
    for z in (.117,1.025):
        m.box((-.248,0,z),(.111,.176,.102),"steel",.015)
    return m


def cone():
    m = Mesh("Cone")
    m.box((0,0,.029),(.364,.364,.058),"rubber",.027)
    for a,b,ra,rb,surface in [
            (.05,.141,.144,.121,"orange"),(.141,.201,.121,.107,"reflector"),
            (.201,.298,.107,.083,"orange"),(.298,.369,.083,.064,"reflector"),
            (.369,.506,.064,.032,"orange")]:
        m.tube((0,0,a),(0,0,b),ra,surface,14,rb)
    m.tube((0,0,.505),(0,0,.508),.017,"trim",12)
    return m


def railing():
    m = Mesh("Railing")
    for x in (-.953,.953):
        m.box((x,0,.04),(.094,.145,.08),"concrete",.009)
        m.box((x,0,.501),(.061,.064,.929),"steel",.007)
    for z in (.274,.88):
        m.box((0,0,z),(2,.044,.046),"tempoGreen",.008)
    for x in (-.75,-.50,-.25,0,.25,.50,.75):
        m.box((x,0,.574),(.026,.031,.605),"steel",.005)
    return m


def planter():
    m = Mesh("Planter")
    m.box((0,0,.091),(1.72,.73,.182),"concrete",.04)
    for y in (-.353,.353):
        m.box((0,y,.247),(1.73,.113,.35),"concrete",.026)
    for x in (-.807,.807):
        m.box((x,0,.245),(.117,.667,.35),"dirtyWhite",.026)
    m.box((0,0,.268),(1.48,.597,.263),"soil",.024)
    rng = random.Random(721)
    for j in range(12):
        p = (rng.uniform(-.70,.70),rng.uniform(-.265,.265),.395)
        for _ in range(3):
            end = (p[0]+rng.uniform(-.098,.098),p[1]+rng.uniform(-.094,.094),
                   p[2]+rng.uniform(.09,.27))
            m.tube(p,end,.014,rng.choice(("leaf","shadeLeaf","newLeaf")),5,.002)
    return m


def tree():
    m = Mesh("Tree")
    rng = random.Random(131)
    m.tube((0,0,0),(.12,-.058,2.48),.19,"bark",10,.108)
    m.tube((.12,-.058,2.48),(.054,.143,4.38),.109,"bark",9,.043)
    for j in range(7):
        angle = j*2.3999
        dx,dy = math.cos(angle),math.sin(angle)
        start = (.085,0,1.85+j*.246)
        fork = (.58*dx,.58*dy,start[2]+.62)
        tip = (dx*(1.22-j*.045)+.11,dy*(1.25-j*.037),start[2]+1.33)
        m.tube(start,fork,.092-j*.006,"bark",7,.053-j*.003)
        m.tube(fork,tip,.054-j*.004,"bark",7,.014)
        for i in range(3):
            x,y,z = (tip[0]+rng.uniform(-.48,.48),tip[1]+rng.uniform(-.51,.51),
                     tip[2]+rng.uniform(-.13,.49))
            m.tube(fork,(x,y,z),.028,"bark",6,.006)
            tone = rng.choice(("leaf","newLeaf","shadeLeaf"))
            m.oval((x,y,z+.24),(rng.uniform(1.0,1.69),rng.uniform(1.08,1.65),rng.uniform(.83,1.35)),
                   tone,8,5,jitter=.22,rng=rng)
    m.oval((.13,.09,4.96),(1.94,1.88,1.47),"leaf",10,5,jitter=.22,rng=rng)
    return m


def export_library(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_yup=True,
        export_apply=True, export_materials="EXPORT", export_vertex_color="ACTIVE",
        export_animations=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export failed for {path}")
    verify_glb(path, objects)


def verify_glb(path, objects):
    with path.open("rb") as glb:
        magic, version, size = struct.unpack("<4sII", glb.read(12))
        length, chunk = struct.unpack("<I4s", glb.read(8))
        if (magic, version, size, chunk) != (b"glTF", 2, path.stat().st_size, b"JSON"):
            raise RuntimeError(f"Invalid GLB header in {path}")
        gltf = json.loads(glb.read(length))

    nodes = gltf["nodes"]
    if sorted(node["name"] for node in nodes) != sorted(obj.name for obj in objects):
        raise RuntimeError(f"Unexpected node names in {path}")
    accessors = gltf["accessors"]
    print(f"\n{path.relative_to(ROOT)}", flush=True)
    for obj in objects:
        node = next(node for node in nodes if node["name"] == obj.name)
        if any(key in node for key in ("translation", "rotation", "scale", "matrix")):
            raise RuntimeError(f"Unexpected placement transform on {obj.name}")
        primitives = gltf["meshes"][node["mesh"]]["primitives"]
        triangles = 0
        for primitive in primitives:
            if primitive.get("mode", 4) != 4 or "material" not in primitive:
                raise RuntimeError(f"Missing triangle geometry or material on {obj.name}")
            triangles += accessors[primitive["indices"]]["count"] // 3
        if triangles != len(obj.data.loop_triangles):
            raise RuntimeError(f"Triangle count changed during export for {obj.name}")
        positions = [accessors[p["attributes"]["POSITION"]] for p in primitives]
        ground = min(p["min"][1] for p in positions)
        height = max(p["max"][1] for p in positions)
        if abs(ground) > .0001 or height <= 0:
            raise RuntimeError(f"{obj.name} is misplaced or the GLB is not Y-up")
        if obj.name in VEHICLES:
            for axis in (0, 2):
                centre = min(p["min"][axis] for p in positions) + max(p["max"][axis] for p in positions)
                if abs(centre) > .0001:
                    raise RuntimeError(f"{obj.name} origin is off-centre")
        if obj.name in VEHICLES and triangles > 8000:
            raise RuntimeError(f"{obj.name} exceeded its triangle budget")
        print(f"  {obj.name:24s} {triangles:5d} triangles", flush=True)
    if not any("COLOR_0" in primitive["attributes"] for mesh in gltf["meshes"]
               for primitive in mesh["primitives"]):
        raise RuntimeError(f"No surface vertex colors exported in {path}")
    if not gltf.get("images") or any("bufferView" not in im for im in gltf["images"]):
        raise RuntimeError(f"Decal images are missing or unpacked in {path}")


def review_grid(filename, tiles, columns, view):
    """Frame each asset independently while retaining a shared camera and studio lighting."""
    scene = bpy.data.scenes.new(filename)
    rows = math.ceil(len(tiles) / columns)
    cell_w, cell_h = 4.2, 2.87
    width, height = columns * cell_w, rows * cell_h
    direction = Vector(view).normalized()
    rotation = (-direction).to_track_quat("-Z", "Y")
    right = rotation @ Vector((1,0,0))
    up = rotation @ Vector((0,1,0))
    away = Vector((-direction.x,-direction.y,0)).normalized()

    camera = bpy.data.objects.new("Review Camera", bpy.data.cameras.new("Review Camera"))
    scene.collection.objects.link(camera)
    camera.location = direction * 42
    camera.rotation_euler = rotation.to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(width, height)
    scene.camera = camera

    world = bpy.data.worlds.new("Review Studio")
    nodes, links = world.node_tree.nodes, world.node_tree.links
    background = nodes.get("Background")
    normal = nodes.new("ShaderNodeTexCoord").outputs["Normal"]
    light = (.38,.43,.54,1)
    for bearing, low, high, strength in (((.35,-.48,.8),.91,.99,2.85),
                                          ((-.66,-.65,.45),.92,.985,1.12),
                                          ((.58,.73,.49),.90,.98,2.38)):
        dot = nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        links.new(normal, dot.inputs[0])
        dot.inputs[1].default_value = Vector(bearing).normalized()
        ramp = nodes.new("ShaderNodeMapRange")
        absolute = nodes.new("ShaderNodeMath")
        absolute.operation = "ABSOLUTE"
        links.new(dot.outputs["Value"], absolute.inputs[0])
        links.new(absolute.outputs[0], ramp.inputs["Value"])
        ramp.inputs["From Min"].default_value = low
        ramp.inputs["From Max"].default_value = high
        ramp.inputs["To Max"].default_value = strength
        add = nodes.new("ShaderNodeMixRGB")
        add.blend_type = "ADD"
        add.inputs[0].default_value = 1
        if isinstance(light, tuple):
            add.inputs[1].default_value = light
        else:
            links.new(light, add.inputs[1])
        links.new(ramp.outputs["Result"], add.inputs[2])
        light = add.outputs[0]
    links.new(light, background.inputs["Color"])
    scene.world = world

    sun = bpy.data.objects.new("Review Key", bpy.data.lights.new("Review Key", "SUN"))
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((-.48,.33,-.9)).to_track_quat("-Z","Y").to_euler()
    sun.data.energy = 2.35
    sun.data.angle = .20

    floor = bpy.data.meshes.new("Review Floor")
    floor.from_pydata([(-60,-60,0),(60,-60,0),(60,60,0),(-60,60,0)],[],[(0,1,2,3)])
    stage = bpy.data.objects.new("Review Floor",floor)
    scene.collection.objects.link(stage)
    stage.location.z = -.012
    matte = bpy.data.materials.new("Review Floor")
    shader = matte.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.37,.39,.42,1)
    shader.inputs["Roughness"].default_value = .86
    floor.materials.append(matte)

    ink = bpy.data.materials.new("Review Labels")
    shader = ink.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.019,.026,.036,1)
    shader.inputs["Roughness"].default_value = 1
    for i, (original, yaw, title) in enumerate(tiles):
        col, row = i % columns, i // columns
        target_x = (col + .5) * cell_w - width/2
        target_y = height/2 - (row + .5) * cell_h + .16
        turn = Matrix.Rotation(yaw,3,"Z")
        bounds = [turn @ Vector(p) for p in original.bound_box]
        left, right_edge = min(p.dot(right) for p in bounds), max(p.dot(right) for p in bounds)
        bottom, top = min(p.dot(up) for p in bounds), max(p.dot(up) for p in bounds)
        scale = min(3.56/(right_edge-left), 1.88/(top-bottom))
        obj = original.copy()
        scene.collection.objects.link(obj)
        obj.rotation_euler.z = yaw
        obj.scale = (scale,) * 3
        obj.location = right * (target_x - (left+right_edge)*scale/2)
        obj.location += away * ((target_y - (bottom+top)*scale/2) / away.dot(up))

        font = bpy.data.curves.new(original.name + " Label", "FONT")
        font.body = title
        font.align_x = "CENTER"
        font.align_y = "CENTER"
        font.size = .17
        font.materials.append(ink)
        label = bpy.data.objects.new(font.name,font)
        scene.collection.objects.link(label)
        label.location = right*target_x + up*(target_y-1.24) + direction*34
        label.rotation_euler = rotation.to_euler()
        label.visible_shadow = False

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 22
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x = 720 * columns
    scene.render.resolution_y = 492 * rows
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(ROOT / "logs" / filename)
    bpy.ops.render.render(write_still=True, scene=scene.name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    make_palette()
    vehicles = [
        motorcycle(True), hatchback("Car", "white", ("BA 16 CHA", "4872")),
        hatchback("CarSilver", "silver", ("BA 19 CHA", "3426")),
        hatchback("CarRed", "carRed", ("BA 13 CHA", "2053")),
        hatchback("CarGrey", "carGrey", ("BA 17 CHA", "6301")),
        hatchback("Taxi", "white", ("BA 2 JA", "5281"), taxi=True), microbus(),
        bus("SajhaBus", modern=True), bus("OldBus", modern=False), tempo(), truck(),
    ]
    props = [
        person("Pedestrian"), person("PedestrianWoman"), person("PedestrianStudent"),
        person("PedestrianElder"), person("PolicePerson", police=True), police_booth(),
        electric_pole(False), electric_pole(True), streetlight(), bus_shelter(), bus_stop_sign(),
        tea_stall(), water_tank(), signboard(), traffic_head(), cone(), railing(), planter(),
        tree(), motorcycle(False),
    ]
    MODELS.mkdir(parents=True, exist_ok=True)
    libraries = []
    for title, builders, names, filename in (
        ("Vehicles", vehicles, VEHICLES, "vehicles.glb"),
        ("Street Props", props, PROPS, "props.glb"),
    ):
        if tuple(m.name for m in builders) != names:
            raise RuntimeError(f"Incomplete {title} collection")
        collection = bpy.data.collections.new(title)
        bpy.context.scene.collection.children.link(collection)
        objects = [m.finish(collection) for m in builders]
        export_library(MODELS / filename, objects)
        libraries.append(objects)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.scene.world = bpy.data.worlds.new("Library World")
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "assets_library.blend"))
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--review" in arguments:
        vehicle_order = ("Car", "CarSilver", "CarRed", "CarGrey", "Motorcycle", "Taxi",
                         "Microbus", "SajhaBus", "OldBus", "SafaTempo", "Truck")
        vehicle_objects = {obj.name: obj for obj in libraries[0]}
        vehicle_tiles = [(vehicle_objects[name], 0, name) for name in vehicle_order]
        vehicle_tiles.append((vehicle_objects["SafaTempo"], math.pi, "SafaTempo · Rear"))
        prop_tiles = [(obj, -math.pi/2 if obj.name == "BusShelter" else 0, obj.name)
                      for obj in libraries[1]]
        review_grid("review-vehicles-v2.png", vehicle_tiles, 4, (.76,-.91,.49))
        review_grid("review-props-v2.png", prop_tiles, 5, (.67,-.91,.62))


if __name__ == "__main__":
    main()
