"""Rebuild the Koteshwor map, portable game model and EEVEE review still.

Blender metres are (east, north, height). The glTF exporter rotates these to
(east, height, south), with no translation or scale relative to the simulation.
"""
from __future__ import annotations

import json
import math
import random
import struct
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from build_assets import PALETTE as ASSET_MATERIALS, lettering

GEO = json.loads((ROOT / "data/koteshwor.geo.json").read_text())
# Pave only the roads that matter visually: highways, their links and residential streets near
# the junction. Service drives, tracks and far residential lanes read as stray asphalt loops.
def _keep(road):
    if road["highway"] in ("trunk", "primary", "secondary", "trunk_link", "primary_link"):
        return True
    if road["highway"] in ("residential", "tertiary", "unclassified"):
        return min(math.hypot(x, z) for x, z in road["points"]) < 160
    return False
GEO["roads"] = [r for r in GEO["roads"] if _keep(r)]
# OSM: Koteshwor is a 3-arm Y junction. Local lanes touching the junction (Seti O.P. Marg link)
# read as a false fourth arm, so they are not paved here.
GEO["roads"] = [r for r in GEO["roads"] if r["highway"] not in ("residential", "unclassified") or min(math.hypot(x, z) for x, z in r["points"]) > 45]
# North-east of the junction is Tribhuvan airport land and inside the Araniko curve is the
# Kot Devi temple ground (open in OSM): no illustrative filler buildings there.
def _open_ground(x, z):
    return (x > 15 and z < -10) or (x > 28 and z < 250) or (x > 10 and 10 < z < 260 and x < 150 and z > x * 0.9 - 20)
GEO["buildings"] = [b for b in GEO["buildings"] if not (b.get("filler") and _open_ground(*b["polygons"][0][0][0]))]

RNG = random.Random(1729)
MAP = bpy.data
TAU = math.tau
PALETTE = {}


def v(xz, h=0):
    return (float(xz[0]), float(-xz[1]), h)


def material(name, color, rough=.85, metal=0, pixels=None):
    m = MAP.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    tree = m.node_tree
    shader = tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    if pixels is not None:
        height, width = pixels.shape[:2]
        image = MAP.images.new(name, width, height, alpha=False)
        image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
        image.pack()
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    PALETTE[name] = m
    return m


def textures():
    n = 256
    rng = np.random.default_rng(25)
    y, x = np.mgrid[0:n, 0:n] / n

    def grain(size):
        # Periodic value noise keeps the baked image seamless under UV tiling.
        data = rng.random((size, size))
        ix, iy = (x * size).astype(int), (y * size).astype(int)
        u, w = x * size - ix, y * size - iy
        u, w = u*u*(3-2*u), w*w*(3-2*w)
        return ((1-w)*((1-u)*data[iy, ix]+u*data[iy, (ix+1)%size])
                + w*((1-u)*data[(iy+1)%size, ix]+u*data[(iy+1)%size, (ix+1)%size]))

    coarse, mid, fine, grit = [grain(size) for size in (5, 18, 63, n)]
    variation = .14 * coarse + .10 * mid + .08 * fine + .15 * grit - .235

    def bake(name, rgb, mod, rough=.86, metal=0):
        out = np.ones((n, n, 4), np.float32)
        out[:, :, :3] = np.clip(np.array(rgb)[None, None, :] * mod[:, :, None], 0, 1)
        material(name, rgb, rough, metal, out)

    fracture = grain(9) + .16 * fine + .04 * grit
    cracks = (abs(fracture - .37) < .007) & (mid < .34)
    repairs = (coarse > .72) & (mid > .47)
    traffic = 1.07 - .22 * np.exp(-((np.minimum(abs(x-.28), abs(x-.72)))/.105)**2)
    for name, tone in (("asphalt", (.285, .282, .265)), ("side road", (.305, .292, .27)),
                       ("patch", (.216, .218, .21))):
        bake(name, tone, traffic + variation * 1.4 - .16 * repairs - .25 * cracks)
    bake("apron", (.285, .282, .265), 1 + variation * 1.5 - .16 * repairs - .25 * cracks)
    bake("field grass", (.30,.40,.20), .91 + variation * 1.9 + .22 * coarse)
    paver = ((((x * 8 + .5*(np.floor(y*12)%2)) % 1) < .033) | ((y*12)%1 < .045))
    bake("paving", (.512, .467, .408), 1 + variation - .24*paver)
    bake("paint", (.77, .75, .66), 1 + variation - .57*(grit+.55*fine < .32))
    bake("edge paint", (.76, .61, .29), 1 + variation - .57*(grit+.55*fine < .32))
    for i, color in enumerate(((.73,.65,.53), (.63,.66,.64), (.67,.46,.39), (.66,.60,.49),
                               (.72,.61,.54), (.53,.61,.63), (.66,.65,.56))):
        streaks = .23 * np.exp(-y*7) * (.4 + .6*fine) + .08 * grain(17)
        wall = 1 + variation - streaks
        bake(f"plaster {i}", color, wall)
        # Distant frontage keeps the same 3 m floor pitch with a baked frame,
        # lintel, glass and mullion instead of several meshes per window.
        bay = np.asarray(color)[None,None,:] * wall[:,:,None]
        frame = (x<.057)|(y>.929)
        trim = (x>.16)&(x<.84)&(y>.25)&(y<.80)
        window = (x>.185)&(x<.815)&(y>.275)&(y<.775)&(abs(x-.50)>.016)&(abs(y-.61)>.012)
        bay[frame] = (.31,.29,.255)
        bay[trim&~window] = (.51,.48,.41)
        bay[window] = np.array((.067,.115,.128)) * (1+.24*y[window,None])
        material(f"facade {i}",color,pixels=np.dstack((bay,np.ones((n,n)))))
    mortar = ((y*12)%1 < .10) | ((x*6 + .5*(np.floor(y*12)%2))%1 < .065)
    brick = np.where(mortar, .92, .83 + variation*1.75 + .12*coarse)
    bake("brick", (.59,.385,.286), brick)
    bake("shutter", (.47,.49,.47), .94 + .15*np.sin(TAU*y*34) + variation, .55, .50)
    bake("roof", (.47,.438,.389), .96 + variation * 1.6)
    for name, rgb, rough, metal in (
        ("concrete", (.30,.28,.245), .88, 0), ("kerb", (.32,.30,.264), .87, 0),
        ("steel", (.09,.11,.11), .55, .65), ("cable", (.023,.023,.021), .74, .16),
        ("rebar", (.19,.095,.055), .78, .45), ("glass", (.066,.116,.136), .24, .24),
        ("glass blue", (.10,.20,.22), .27, .30), ("glass dark", (.026,.041,.045), .31, .18),
        ("awning", (.17,.30,.30), .54, .40), ("warm awning", (.35,.11,.061), .60, .38),
        ("white frame", (.52,.49,.43), .78, 0), ("manhole", (.105,.095,.08), .77, .5),
        ("open shop", (.044,.037,.028), .93, 0), ("field", (.24,.30,.16), .99, 0),
        ("hill near", (.133,.171,.174), 1, 0), ("hill far", (.183,.226,.258), 1, 0),
    ):
        material(name, rgb, rough, metal)

    signs = (
        ("KOTESHWOR CHIYA", "9e382c"), ("MOBILE REPAIR", "155968"), ("NEW ROAD PHARMACY", "377243"),
        ("KOTESHWOR MART", "a8322b"), ("BHAKTAPUR FANCY", "204c83"), ("FRESH MOMO", "9b482d"),
        ("TRAVEL & TOURS", "276867"), ("OPTICAL HOUSE", "245689"), ("HIMALAYA HARDWARE", "494240"),
        ("KIRANA STORE", "722e42"), ("RING ROAD GARAGE", "1e5255"), ("NEPAL  TINKUNE", "286351"),
        ("ARANIKO HIGHWAY", "245186"), ("AIRPORT  /  TINKUNE", "236151"), ("BALKUMARI", "28634d"),
    )
    for label, bg in signs:
        PALETTE[label] = ASSET_MATERIALS[lettering((label,), bg)]


class Batch:
    """One mesh per layer with shared materials and per-face texture coordinates."""

    def __init__(self, name):
        self.name = name
        self.vertices = []
        self.faces = []
        self.materials = []
        self.uv = []

    def face(self, points, surface, uv=None, outward=None):
        if outward is not None:
            a, b, c = map(Vector, points[:3])
            if (b-a).cross(c-a).dot(Vector(outward)) < 0:
                points = points[::-1]
                uv = uv[::-1] if uv else None
        start = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(start, len(self.vertices))))
        self.materials.append(surface)
        self.uv.append(uv if uv else [(x/4, -y/4) for x, y, _ in points])

    def panel(self, a, b, bottom, top, surface, outward, uv=None):
        self.face([v(a, bottom), v(b, bottom), v(b, top), v(a, top)], surface, uv, outward)

    def box(self, p, length, width, low, high, surface, direction=(1, 0)):
        t = np.asarray(direction)
        n = np.array([-t[1], t[0]])
        o = np.asarray(p)
        rim = [o + t*i*length/2 + n*j*width/2 for i,j in ((-1,-1),(1,-1),(1,1),(-1,1))]
        self.face([v(a, high) for a in rim], surface, outward=(0, 0, 1))
        for i, a in enumerate(rim):
            b = rim[(i+1)%4]
            self.panel(a, b, low, high, surface, v((a+b)/2-o))

    def tube(self, start, end, radius, surface, sides=5):
        a, b = Vector(start), Vector(end)
        axis = (b-a).normalized()
        u = axis.cross(Vector((0, 0, 1)))
        if u.length < .001:
            u = axis.cross(Vector((1, 0, 0)))
        u = u.normalized()
        w = axis.cross(u)
        ring = [radius*(u*math.cos(i*TAU/sides) + w*math.sin(i*TAU/sides)) for i in range(sides)]
        for d, e in zip(ring, ring[1:]+ring[:1]):
            self.face([a+d, a+e, b+e, b+d], surface, [(0,0),(1,0),(1,1),(0,1)], d+e)

    def finish(self, collection):
        mesh = MAP.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        slots = {}
        for name in dict.fromkeys(self.materials):
            slots[name] = len(mesh.materials)
            mesh.materials.append(PALETTE[name])
        uv = mesh.uv_layers.new(name="SurfaceUV")
        flat_uv = np.asarray([point for face in self.uv for point in face], dtype=np.float32)
        uv.uv.foreach_set("vector", flat_uv.ravel())
        mesh.polygons.foreach_set("material_index", [slots[name] for name in self.materials])
        obj = MAP.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


class PathLine:
    def __init__(self, points):
        self.points = np.asarray(points, dtype=float)
        self.points = self.points[np.r_[True, np.linalg.norm(np.diff(self.points, axis=0), axis=1) > 1e-5]]
        self.delta = np.diff(self.points, axis=0)
        self.lengths = np.linalg.norm(self.delta, axis=1)
        self.distances = np.r_[0, np.cumsum(self.lengths)]
        self.length = self.distances[-1]
        self.tangent = self.delta / self.lengths[:, None]

    def sample(self, s):
        s = np.clip(s, 0, self.length)
        i = min(np.searchsorted(self.distances, s, side="right")-1, len(self.delta)-1)
        return self.points[i] + self.tangent[i]*(s-self.distances[i]), self.tangent[i]

    def nearest(self, point):
        rel = point - self.points[:-1]
        t = np.clip(np.sum(rel*self.tangent, axis=1), 0, self.lengths)
        d2 = np.sum((rel-t[:,None]*self.tangent)**2, axis=1)
        i = np.argmin(d2)
        return math.sqrt(d2[i]), self.points[i]+t[i]*self.tangent[i], self.tangent[i]


def normal(t):
    return np.array([-t[1], t[0]])


def strip(mesh, path, left, right, height, surface, repeat=3, accept=None):
    # Miter the edges at vertices so sharp local turns do not open seams.
    normals = np.array([normal(t) for t in path.tangent])
    bends = np.vstack((normals[0], normals[1:]+normals[:-1], normals[-1]))
    bends /= np.maximum(.45, np.sum(bends*np.vstack((normals, normals[-1])), axis=1))[:, None]
    for i, (a, b) in enumerate(zip(path.points, path.points[1:])):
        count = max(1, math.ceil(path.lengths[i]/3)) if accept else 1
        for j in range(count):
            t, u = j/count, (j+1)/count
            p, q = a+(b-a)*t, a+(b-a)*u
            n, m = (1-t)*bends[i]+t*bends[i+1], (1-u)*bends[i]+u*bends[i+1]
            if accept and not accept((p+q)/2+(n+m)*(left+right)/4):
                continue
            corners = [p+n*left, q+m*left, q+m*right, p+n*right]
            uv = None
            if repeat is not None:
                s = (path.distances[i]+path.lengths[i]*t)/repeat
                e = (path.distances[i]+path.lengths[i]*u)/repeat
                uv = [(0,s),(0,e),((right-left)/3.5,e),((right-left)/3.5,s)]
            mesh.face([v(c, height) for c in corners], surface, uv, (0,0,1))
            if height > .04:
                for k in (0, 2):
                    mesh.panel(corners[k], corners[k+1], -.025, height, "kerb", v(normal(q-p)*(1 if k else -1)))


def ring_area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring, ring[1:]+ring[:1]))/2


def triangles(rings, height):
    loops = [[Vector(v(p, height)) for p in ring] for ring in rings]
    vertices = [point for loop in loops for point in loop]
    return [[vertices[i] for i in tri] for tri in tessellate_polygon(loops)]


def polygon(mesh, rings, height, surface):
    for tri in triangles(rings, height):
        mesh.face(list(tri), surface, outward=(0,0,1))


def collection(name):
    c = MAP.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c



def flatten_asphalt(road):
    """Remove buried faces and bake a continuous, coplanar road surface."""
    result = Batch(road.name)
    buckets = defaultdict(list)

    def cells(points):
        min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
        min_y, max_y = min(p[1] for p in points), max(p[1] for p in points)
        return [(x,y) for x in range(math.floor(min_x/12),math.floor(max_x/12)+1)
                for y in range(math.floor(min_y/12),math.floor(max_y/12)+1)]

    def split(points, a, b):
        inside, outside = [], []
        previous = points[-1]
        def side(p):
            return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        old = side(previous)
        for point in points:
            new = side(point)
            if (old>=0)!=(new>=0):
                u = old/(old-new)
                border = tuple(x+u*(y-x) for x,y in zip(previous,point))
                inside.append(border)
                outside.append(border)
            (inside if new>=0 else outside).append(point)
            previous,old = point,new
        return inside,outside

    def subtract(subject, clip):
        pieces = []
        inner = subject
        for a,b in zip(clip,clip[1:]+clip[:1]):
            inner,outer = split(inner,a,b)
            if len(outer)>=3:
                pieces.append(outer)
            if len(inner)<3:
                return pieces
        return pieces

    clips = []
    for face,uv,surface in reversed(list(zip(road.faces,road.uv,road.materials))):
        clip = [tuple(road.vertices[i][:2]) for i in face]
        area = ring_area(clip)
        if abs(area)<1e-6:
            continue
        if area<0:
            clip,uv = clip[::-1],uv[::-1]
        cells_here = cells(clip)
        neighbors = sorted({i for cell in cells_here for i in buckets[cell]})
        remaining = [[(*point,*tex) for point,tex in zip(clip,uv)]]
        for i in neighbors:
            remaining = [part for subj in remaining for part in subtract(subj,clips[i])
                         if abs(ring_area(part))>1e-5]
            if not remaining:
                break
        for part in remaining:
            result.face([(x,y,.009) for x,y,_,_ in part],surface,[(u,w) for _,_,u,w in part])
        for cell in cells_here:
            buckets[cell].append(len(clips))
        clips.append(clip)
    return result

def append_assets():
    keys = ("WaterTank", "ElectricPole", "ElectricPoleTransformer", "StreetLight", "Tree",
            "BusShelter", "BusStopSign", "TrafficSignalHead", "PoliceBooth", "PolicePerson",
            "TeaStall", "ParkedMotorcycle", "Pedestrian", "PedestrianWoman", "Railing",
            "Motorcycle", "Taxi", "CarRed", "Microbus", "OldBus", "SajhaBus", "SafaTempo")
    with MAP.libraries.load(str(ROOT / "assets_library.blend"), link=False) as (library, local):
        local.objects = [name for name in keys if name in library.objects]
    result = {obj.name: obj for obj in local.objects}
    if missing := set(keys)-result.keys():
        raise RuntimeError(f"Missing objects in assets_library.blend: {sorted(missing)}")
    return result


def prop(assets, target, key, point, height=0, angle=0, scale=1, label=None):
    obj = MAP.objects.new(label or key, assets[key].data)
    target.objects.link(obj)
    obj.location = v(point, height)
    obj.rotation_euler.z = -angle
    obj.scale = (scale,)*3 if isinstance(scale, (int,float)) else scale
    return obj


def simulation_geometry():
    # Import the exact paths and stop-line samples the game uses.
    script = """
      import {createNetwork} from './src/sim/network.js';
      const n = createNetwork();
      // Koteshwor is a 3-arm junction; the Seti link carries no modelled traffic.
      const arms = Object.fromEntries(Object.entries(n.arms).filter(([k]) => k !== 'west').map(([k,a]) =>
        [k,{stopLine:a.stopLine,stops:a.stops,incoming:a.incoming.map(l=>l.path),
            outgoing:a.outgoing.map(l=>l.path),width:a.incoming[0].width}]));
      console.log(JSON.stringify({arms,movements:n.movements.filter(m=>m.arm!=='west'&&m.to.arm!=='west').map(m=>m.path.points)}));
    """
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT))


def streets(geo, sim, assets, props, infrastructure, buildings_bvh):
    road_mesh, walk, marks = (Batch(name) for name in ("OSM carriageways", "Grass, paving and kerbs", "Road paint and repairs"))
    furnish, cables = Batch("Street infrastructure"), Batch("Catenary wire bundles")
    roads = [(r, PathLine(r["points"])) for r in geo["roads"]]
    main = [(r,p) for r,p in roads if r["highway"] in ("trunk", "primary", "trunk_link")]
    segments = np.concatenate([p.points[:-1] for _,p in roads])
    directions = np.concatenate([p.tangent for _,p in roads])
    lengths = np.concatenate([p.lengths for _,p in roads])
    widths = np.concatenate([np.full(len(p.lengths),r["width"]/2) for r,p in roads])

    def clearance(point):
        rel = point-segments
        along = np.clip(np.sum(rel*directions, axis=1), 0, lengths)
        return np.min(np.linalg.norm(rel-along[:,None]*directions, axis=1)-widths)

    def in_building(point):
        return buildings_bvh.ray_cast(Vector(v(point,100)), Vector((0,0,-1)))[0] is not None

    def mark(point, direction, length, width, surface="paint", h=.026):
        t, n = direction, normal(direction)
        corners = [point + t*i*length/2 + n*j*width/2 for i,j in ((-1,-1),(1,-1),(1,1),(-1,1))]
        marks.face([v(p,h) for p in corners], surface, outward=(0,0,1))

    # Keep the apron at the junction throat. The mapped slip and frontage roads
    # define their own edges farther southwest.
    apron = [(-36,3),(-33,-10),(-7,-19),(1,-27),(15,-26),(19,-15),(20,3),(20,20),
             (12,22),(4,24),(-6,20),(-14,16),(-24,12)]
    polygon(road_mesh, [apron], .003, "apron")
    for points in sim["movements"]:
        strip(road_mesh, PathLine(points), -1.55, 1.55, .004, "apron", repeat=None)

    southwest = next(arm for arm in geo["arms"] if arm["id"] == "south")
    southwest_ways = {abs(way) for way in southwest["incoming"] + southwest["outgoing"]}
    junction_ways = southwest_ways | {194607856, 591355896, 1132401297, 1132401300}
    for i,(r,p) in enumerate(roads):
        half = r["width"]/2
        arterial = r["highway"] in ("trunk", "primary")
        h = .007 + i*.000064
        # Include the offset spawn points at exact clip caps despite mesh
        # float rounding. Interior OSM junction vertices stay untouched.
        points = p.points.copy()
        if np.linalg.norm(points[0]) > geo["coordinates"]["radius"]-.06:
            points[0] -= p.tangent[0]*.09
        if np.linalg.norm(points[-1]) > geo["coordinates"]["radius"]-.06:
            points[-1] += p.tangent[-1]*.09
        if r["id"] in junction_ways:
            strip(road_mesh, PathLine(points), -half, half, h, "apron", repeat=None)
        else:
            strip(road_mesh, PathLine(points), -half, half, h, "asphalt" if arterial else "side road", repeat=14)
        if arterial:
            for sign in (-1,1):
                strip(walk,p,sign*(half+.49),sign*(half+2.56),.13,"paving",
                      accept=lambda q: clearance(q) > .76 and np.linalg.norm(q) > 45)
            for s in np.arange(8,p.length-4,8.4):
                point,t = p.sample(s)
                if np.linalg.norm(point) < 38:
                    continue
                for lane in range(1,r["lanes"]):
                    mark(point + normal(t)*(r["width"]*lane/r["lanes"]-half),t,3.35,.123)
                for sign in (-1,1):
                    mark(point+normal(t)*sign*(half-.18),t,6.8,.09,"edge paint" if sign<0 else "paint")
            for s in np.arange(16,p.length-3,19.8):
                point,t = p.sample(s)
                point += normal(t)*RNG.uniform(-half*.75,half*.75)
                if np.linalg.norm(point) > 18:
                    mark(point,t,RNG.uniform(.6,2.9),RNG.uniform(.28,1.18),"patch",.024)
            for s in np.arange(24,p.length-3,52):
                point,t = p.sample(s)
                if np.linalg.norm(point) > 32:
                    for j in range(12):
                        vector = np.array([math.cos(j*TAU/12),math.sin(j*TAU/12)])
                        next_vector = np.array([math.cos((j+1)*TAU/12),math.sin((j+1)*TAU/12)])
                        marks.face([v(point,.029),v(point+vector*.30,.029),v(point+next_vector*.30,.029)],
                                   "manhole", outward=(0,0,1))

    for f in geo["footways"]:
        if not f["bridge"]:
            strip(walk,PathLine(f["points"]),-.75,.75,.065,"paving",accept=lambda q: clearance(q)>1.05)

    by_id = {r["id"]: (r,p) for r,p in reversed(roads)}
    for first, second, start, end in (
        (193289326,193289327,29,300), (226834863,1132407062,29,292),
        (648697035,416294069,68,310),
    ):
        road, a = by_id[first]
        other, b = by_id[second]
        previous = None
        for s in np.arange(start,min(end,a.length-5),2.5):
            source,t = a.sample(s if first==193289326 else a.length-s)
            distance,dest,_ = b.nearest(source)
            gap = distance - (road["width"]+other["width"])/2
            if not 1.25 < gap < 16:
                previous = None
                continue
            point = (source+dest)/2
            half_width = min(1.45, gap*.39)
            if clearance(point)<half_width+.22:
                previous = None
                continue
            if previous is not None:
                old, old_width = previous
                segment = point-old
                if np.linalg.norm(segment)<4:
                    strip(walk,PathLine([old,point]),-min(old_width,half_width),min(old_width,half_width),.24,"field grass")
                    for offset in (-.62,.62):
                        shifted = normal(t)*min(half_width*.72, .98)*offset/.62
                        furnish.tube(v(old+shifted,.98),v(point+shifted,.98),.034,"steel")
                        furnish.tube(v(old+shifted,.62),v(point+shifted,.62),.025,"steel")
                        furnish.tube(v(point+shifted,.23),v(point+shifted,1.01),.045,"steel")
                    if int(round((s-start)/2.5))%12==4:
                        prop(assets,props,"Tree",point,.24,scale=.76)
            previous = (point,half_width)

    for cross in geo["crossings"]:
        if cross["markings"] not in ("zebra","yes") and cross["crossing"] not in ("marked", "uncontrolled"):
            continue
        target = np.asarray(cross["point"])
        (distance,point,t), r = min(((p.nearest(target), r) for r,p in roads), key=lambda hit: hit[0][0])
        if distance <= r["width"]/2+.7:
            for d in np.arange(-r["width"]/2+.45,r["width"]/2-.28,.72):
                mark(point+normal(t)*d,t,2.55,.38,h=.036)

    for aid, arm in sim["arms"].items():
        stop = arm["stopLine"]
        t = np.array([stop[0]["dx"],stop[0]["dz"]])
        n = normal(t)
        centre = np.mean([(p["x"],p["z"]) for p in stop],axis=0)
        mark(centre-t*.28,n,len(stop)*arm["width"]+.45,.26,h=.039)
        if aid == "west":
            continue
        pole = centre+n*(len(stop)*arm["width"]/2+1.05)
        angle = math.atan2(-t[1],-t[0])
        furnish.tube(v(pole),v(pole,5.3),.098,"steel",9)
        furnish.tube(v(pole,4.95),v(centre,4.95),.067,"steel",8)
        prop(assets,props,"TrafficSignalHead",centre,4.45,angle)
        prop(assets,props,"TrafficSignalHead",pole,2.65,angle,.73)

    # Props snap to the nearest available verge while preserving mapped stop markers.
    stops = {str(item["id"]):(item["point"],False) for item in geo["busStops"]}
    for aid, arm in sim["arms"].items():
        for item in arm["stops"]:
            if item["assumed"]:
                stops[aid] = (item["point"],True)
    for key,(loc,assumed) in stops.items():
        loc = np.array(loc)
        choices = sorted(((p.nearest(loc),r) for r,p in main),key=lambda hit:hit[0][0])
        (_,mid,t), r = choices[0]
        n = normal(t)
        side = 1 if np.dot(loc-mid,n)>=0 else -1
        angle = math.atan2(t[1],t[0])
        fitting = [mid+n*side*(r["width"]/2+1.5)+t*shift for shift in (0,3,-3,7,-7,11,-11)]
        shelter = next((p for p in fitting if clearance(p)>.86 and not in_building(p)), fitting[0])
        prop(assets,props,"BusShelter",shelter,.12,angle if side==1 else angle+math.pi,
             label=f"BusShelter_{key}" + ("_assumed" if assumed else ""))
        prop(assets,props,"BusStopSign",shelter+t*2.35,.12,angle)
        for j in range(3):
            p = shelter+t*(3.1+j*.92)
            if not in_building(p):
                prop(assets,props,("Pedestrian","PedestrianWoman")[j%2],p,.13,angle+1.5,scale=.93+.05*j)

    placed = []
    for r,p in main:
        if r["highway"] == "trunk_link" or p.length<23:
            continue
        half = r["width"]/2
        for sign in (-1,1):
            previous = None
            for j,s in enumerate(np.arange(12,p.length-3,35)):
                centre,t = p.sample(s)
                n = normal(t)*sign
                candidates = [centre+n*(half+d) for d in (1.08,1.72,2.42)]
                point = next((q for q in candidates if clearance(q)>.62 and not in_building(q)), None)
                if point is None or np.linalg.norm(point)<22 or any(np.linalg.norm(point-q)<12 for q in placed):
                    previous = None
                    continue
                placed.append(point)
                angle = math.atan2(t[1],t[0])
                prop(assets,props,"ElectricPoleTransformer" if j%4==1 else "ElectricPole",point,.11,angle)
                light = point-t*5
                if clearance(light)>.7 and not in_building(light):
                    prop(assets,props,"StreetLight",light,.13,math.atan2(-n[1],-n[0]))
                tree = point+t*10+n*.3
                if j%3!=0 and clearance(tree)>.8 and not in_building(tree):
                    prop(assets,props,"Tree",tree,.13,RNG.uniform(0,TAU),RNG.uniform(.74,1.08))
                if j%3==0 and np.linalg.norm(point)<185:
                    stall = point+t*5+n*1.06
                    if clearance(stall)>1.15 and not in_building(stall):
                        prop(assets,props,"TeaStall",stall,.13,math.atan2(-n[1],-n[0]))
                    for k in range(3):
                        bike = point+t*(1.6*k+2)+n*.28
                        if clearance(bike)>.5 and not in_building(bike):
                            prop(assets,props,"ParkedMotorcycle",bike,.12,angle+sign*.47,.92)
                if previous is not None:
                    old,on = previous
                    distance = np.linalg.norm(point-old)
                    if distance < 79:
                        for k,(height,lateral) in enumerate(((8.14,-.69),(8.14,0),(8.14,.69),(7.49,-.47),
                                                              (7.49,.47),(5.85,-.48),(5.68,.40))):
                            a,b = old+on*lateral,point+n*lateral
                            tension = max(26,distance*.82)
                            chain = []
                            for u in np.linspace(0,1,9):
                                sag = tension*(math.cosh((u-.5)*distance/tension)-math.cosh(.5*distance/tension))
                                chain.append(v(a+(b-a)*u,height+sag*(.67+k*.065)))
                            for a,b in zip(chain,chain[1:]):
                                cables.tube(a,b,.016 if k<5 else .023,"cable",3)
                previous = (point,n)

    booth = np.array([7.0,-17.3])
    furnish.box(booth,2.9,2.3,.01,.24,"kerb")
    prop(assets,props,"PoliceBooth",booth,.24,-.9,1.35)
    prop(assets,props,"PolicePerson",booth+[-.75,1.41],.03,1.7)

    for bridge in (f for f in geo["footways"] if f["bridge"]):
        a,b = map(np.asarray,(bridge["points"][0],bridge["points"][-1]))
        length = np.linalg.norm(b-a)
        if length < 20:
            continue
        t = (b-a)/length
        n = normal(t)
        furnish.box((a+b)/2,length,2.65,5.37,5.72,"concrete",t)
        for side in (-1,1):
            offset = n*side*1.23
            for h in (5.91,6.34,6.81):
                furnish.tube(v(a+offset,h),v(b+offset,h),.045,"steel")
            for s in np.arange(0,length,1.42):
                p = a+t*s+offset
                furnish.tube(v(p,5.67),v(p,6.85),.045,"steel")
        for endpoint,sign in ((a,-1),(b,1)):
            for side in (-1,1):
                p = endpoint+n*side
                furnish.tube(v(p),v(p,5.55),.15,"steel",8)
            for i in range(34):
                p = endpoint+n*(i+.5)*.335*sign
                h = 5.71-i*.166
                furnish.box(p,.338,2.1,max(0,h-.20),h,"concrete",n)
            for side in (-1,1):
                p = endpoint+t*side*.99
                furnish.tube(v(p,6.77),v(p+n*11.4*sign,1.18),.043,"steel")
                for j in range(0,34,4):
                    q=p+n*j*.335*sign
                    furnish.tube(v(q,5.71-j*.166),v(q,6.77-j*.166),.035,"steel")

    # The unmapped airport-side open land receives low scrub and dry grass.
    scrub = Batch("Airport-side grass and scrub")
    for _ in range(164):
        p=np.array([RNG.uniform(26,250),RNG.uniform(-260,35)])
        radius=RNG.uniform(1,4.4)
        if clearance(p)<radius+3.5 or in_building(p):
            continue
        ring=[p+radius*RNG.uniform(.6,1.4)*np.array([math.cos(i*TAU/8),math.sin(i*TAU/8)]) for i in range(8)]
        scrub.face([v(q,-.048) for q in ring],"field grass",outward=(0,0,1))
        if RNG.random()<.16:
            prop(assets,props,"Tree",p,-.045,RNG.uniform(0,TAU),RNG.uniform(.42,.73))
    scrub.finish(infrastructure)

    # The named destinations echo the reference gantry; its street dressing is illustrative.
    for y in (-61,-67):
        for x in (-7,21):
            furnish.tube(v((x,y)),v((x,y),7.8),.15,"steel",8)
        for h in (7.20,7.96):
            furnish.tube(v((-7,y),h),v((21,y),h),.065,"steel")
        for x in np.arange(-7,21,1.75):
            furnish.tube(v((x,y),7.20),v((x+1.75,y),7.96),.035,"steel")
    for x, label, width in ((-2,"AIRPORT  /  TINKUNE",5.6),(7,"ARANIKO HIGHWAY",7.2),(16,"BALKUMARI",5)):
        furnish.panel((x-width/2,-61+.11),(x+width/2,-61+.11),6.69,8.36,label,(0,-1,0),
                      [(0,0),(1,0),(1,1),(0,1)])
    for batch in (flatten_asphalt(road_mesh),walk,marks,furnish,cables):
        batch.finish(infrastructure)


def buildings(assets, target, roof_props):
    bulk = Batch("Mapped building envelopes")
    facade = Batch("Kathmandu concrete frames and shopfronts")
    roof = Batch("Balconies, parapets and unfinished roofs")
    storefronts = ("KOTESHWOR CHIYA","MOBILE REPAIR","NEW ROAD PHARMACY","KOTESHWOR MART",
                   "BHAKTAPUR FANCY","FRESH MOMO","TRAVEL & TOURS","OPTICAL HOUSE",
                   "HIMALAYA HARDWARE","KIRANA STORE","RING ROAD GARAGE")
    trunk = [PathLine(r["points"]) for r in GEO["roads"] if r["highway"]=="trunk"]
    uv01 = [(0,0),(1,0),(1,1),(0,1)]
    for building in GEO["buildings"]:
        rng = random.Random(str(building["id"]))
        variant = rng.randrange(7)
        color = f"plaster {variant}"
        for polygon_rings in building["polygons"]:
            rings = [list(map(np.asarray,ring[:-1])) for ring in polygon_rings if len(ring)>=4]
            if not rings:
                continue
            boundary = rings[0]
            height = building["levels"] * 3
            centre = np.mean(boundary, axis=0)
            near = np.linalg.norm(centre)<132 and min(p.nearest(centre)[0] for p in trunk)<50
            detailed = near
            commercial = min(p.nearest(centre)[0] for p in trunk)<40
            unfinished = len(boundary)>=4 and rng.random()<.13 and height>=9
            polygon(bulk,rings,height,"roof")
            for i,ring in enumerate(rings):
                orientation = (1 if ring_area(ring)>0 else -1) * (1 if i==0 else -1)
                for a,b in zip(ring,ring[1:]+ring[:1]):
                    length = np.linalg.norm(b-a)
                    if length<.08:
                        continue
                    t = (b-a)/length
                    n = -orientation*normal(t)
                    outside = v(n)
                    # Coordinates stay fixed even for angled corner buildings.
                    bays = max(1,round(length/3.1))
                    # Kathmandu blocks are rows of narrow individually built houses:
                    # split long walls into 4-8 m plots, each with its own plaster,
                    # a column line at the party wall and its own roofline.
                    cuts = [0.0]
                    while length-cuts[-1] > 9.5:
                        cuts.append(cuts[-1]+rng.uniform(4.2,7.8))
                    cuts.append(length)
                    for c0,c1 in zip(cuts,cuts[1:]):
                        pv = rng.randrange(7) if len(cuts)>2 else variant
                        wall = f"plaster {pv}" if detailed or length<1.08 else f"facade {pv}"
                        pa,pb = a+t*c0, a+t*c1
                        pbays = max(1,round((c1-c0)/3.1))
                        bulk.panel(pa,pb,-.03,height,wall,outside,
                                   [(0,0),(pbays,0),(pbays,height/3),(0,height/3)])
                        if len(cuts)>2 and c0>0:
                            col = pa+n*.06
                            roof.panel(col-t*.16,col+t*.16,-.03,height+.54,"concrete",outside)
                        if i==0 and len(cuts)>2 and c1-c0>3.5:
                            step = rng.random()
                            mid = a+t*(c0+c1)/2
                            if step<.30 and height>=9:
                                # one more storey set back from the frontage
                                roof.box(mid-n*2.6,(c1-c0)*.94,4.6,height,height+3,
                                         f"plaster {pv}",t)
                                roof.panel(pa+n*.02,pb+n*.02,height+2.78,height+3.3,"concrete",outside)
                            elif step<.42:
                                # tin-roofed rooftop room, common on older houses
                                roof.box(mid-n*3.2,(c1-c0)*.6,3.0,height,height+2.4,"brick",t)
                    if length<1.08:
                        continue
                    bay = length/bays
                    for floor in range(building["levels"] if detailed else (1 if commercial else 0)):
                        h = floor*3
                        finish = "brick" if unfinished and h+3==height else color
                        slab = a+ n*.018
                        facade.panel(slab,slab+t*length,h+2.78,h+3.025,"concrete",outside)
                        for k in range(bays):
                            base = a+t*k*bay
                            if finish=="brick":
                                f = base+n*.026
                                facade.panel(f,f+t*bay,h,h+2.77,"brick",outside,[(0,0),(bay/3,0),(bay/3,1),(0,1)])
                            if near or bay>2:
                                f = base+n*.039
                                facade.panel(f,f+t*min(.18,bay*.13),h,h+2.8,"concrete",outside)
                            p = base+t*bay*.5+n*.049
                            if floor==0 and commercial and i==0 and bay>1.65:
                                opening = bay*.82
                                mode = "open shop" if rng.random()<.24 else "shutter"
                                facade.panel(p-t*opening/2,p+t*opening/2,.16,2.25,mode,outside,uv01)
                                sign = rng.choice(storefronts)
                                facade.panel(p-t*opening/2+n*.047,p+t*opening/2+n*.047,
                                             2.27,2.73,sign,outside,uv01)
                                if near and rng.random()<.30:
                                    roof.box(p+n*.46,bay*.89,.96,2.33,2.41,rng.choice(("awning","warm awning")),t)
                                continue
                            if bay<1.31 or (finish=="brick" and rng.random()<.57):
                                continue
                            half = bay*rng.uniform(.245,.383)
                            facade.panel(p-t*(half+.045),p+t*(half+.045),h+.76,h+2.39,"white frame",outside)
                            q = p+n*.019
                            facade.panel(q-t*half,q+t*half,h+.82,h+2.33,
                                         "open shop" if finish=="brick" else rng.choice(("glass","glass","glass dark","glass blue")),outside)
                            mullion = q+n*.021
                            facade.panel(mullion-t*.026,mullion+t*.026,h+.82,h+2.33,"white frame",outside)
                            if near:
                                facade.panel(mullion-t*half,mullion+t*half,h+1.84,h+1.88,"white frame",outside)
                            if floor>0 and near and i==0 and bay>2.35 and rng.random()<.12:
                                width = bay*.82
                                q = p+n*.44
                                roof.box(q,width,.93,h+.39,h+.53,"concrete",t)
                                front = q+n*.43
                                roof.tube(v(front-t*width*.5,h+1.34),v(front+t*width*.5,h+1.34),.033,"steel")
                                for k in range(5):
                                    end = front+t*width*(k/4-.5)
                                    roof.tube(v(end,h+.52),v(end,h+1.34),.022,"steel")
                    cap = a+n*.021
                    roof.panel(cap,cap+t*length,height,height+(.29 if unfinished else .54),
                               "brick" if unfinished else "concrete",outside)
                    if unfinished and i==0 and length>1.5 and near:
                        for d in np.arange(.38,length-.24,2.95):
                            p=a+t*d-n*.14
                            for off in (-.079,.079):
                                q=p+t*off
                                roof.tube(v(q,height),v(q,height+rng.uniform(.66,1.23)),.015,"rebar",4)
            if rng.random() < (.72 if near else .34):
                # A tessellated roof triangle provides a point inside concave footprints.
                tris = triangles(rings,height)
                if tris:
                    tri=max(tris,key=lambda f:(f[1]-f[0]).cross(f[2]-f[0]).length)
                    top=sum(tri,Vector((0,0,0)))/3
                    loc=(top.x,-top.y)
                    if (tri[1]-tri[0]).cross(tri[2]-tri[0]).length>4.6:
                        prop(assets,roof_props,"WaterTank",loc,height,rng.uniform(0,TAU),rng.uniform(.74,1.12))
    for batch in (bulk,facade,roof):
        batch.finish(target)


def urban_fabric(target):
    """Illustrative low-detail city fabric so the Valley floor reads as dense Kathmandu,
    not open sand. Placed only where OSM has no mapped road or building nearby."""
    from mathutils.kdtree import KDTree
    road_pts, widths = [], []
    for r in GEO["roads"]:
        pts = [np.asarray(p) for p in r["points"]]
        for a, b in zip(pts, pts[1:]):
            n_s = max(1, int(np.linalg.norm(b-a)/2))
            for k in range(n_s+1):
                road_pts.append(a+(b-a)*k/n_s); widths.append(r.get("width") or 6)
    roads_kd = KDTree(len(road_pts))
    for i, p in enumerate(road_pts):
        roads_kd.insert((p[0], p[1], 0), i)
    roads_kd.balance()
    cents = [np.mean(np.asarray(poly[0][:-1]), axis=0) for b in GEO["buildings"] for poly in b["polygons"]]
    bkd = KDTree(max(1, len(cents)))
    for i, c in enumerate(cents):
        bkd.insert((c[0], c[1], 0), i)
    bkd.balance()
    rng = random.Random(77)
    fabric = Batch("Illustrative city fabric (not from OSM)")
    step = 21
    for gx in np.arange(-900, 900, step):
        for gz in np.arange(-900, 900, step):
            p = np.array([gx + rng.uniform(-3, 3), gz + rng.uniform(-3, 3)])
            d = math.hypot(*p)
            if d < 170 or d > 900:
                continue
            if p[0] > 28 and p[1] < 250:
                continue  # airport land east of the Ring Road / Araniko
            if rng.random() < .12:      # lanes, courtyards and open plots
                continue
            co, idx, dist = roads_kd.find((p[0], p[1], 0))
            if co is not None and dist < widths[idx]/2 + 4.5:
                continue
            if cents:
                _, _, bd = bkd.find((p[0], p[1], 0))
                if bd < 12:
                    continue
            w, dep = rng.uniform(7, 12), rng.uniform(8, 13)
            h = 3 * rng.choice((2, 3, 3, 4, 4, 5, 6))
            ang = rng.uniform(-.25, .25)
            t = (math.cos(ang), math.sin(ang))
            surface = f"plaster {rng.randrange(7)}"
            fabric.box(p, w, dep, -.05, h, surface, t)
            if rng.random() < .35:
                fabric.box(p + np.array(t)*rng.uniform(-2, 2), 1.3, 1.3, h, h+1.4, "steel", t)
    fabric.finish(target)


def landscape(target, still):
    earth = Batch("Valley ground")
    earth.box((0,0),4300,4300,-.16,-.12,"field")
    earth.box((0,0),885,880,-.08,-.060,"field grass")
    earth.finish(target)
    urban_fabric(target)
    hills = Batch("Valley rim silhouettes")
    for index,(distance,tone) in enumerate(((1200,"hill near"),(2000,"hill far"))):
        edge = []
        count = 190
        for i in range(count):
            a = i/count*TAU
            radius = distance*(1+.105*math.sin(3*a)+.046*math.sin(9*a+.3))
            h = (33+32*index + 41*math.sin(2*a+.38)**2 + 28*math.sin(5*a+index)**2
                 + 12*math.sin(11*a+2)**2 + 7*math.sin(21*a+.2)**2)
            edge.append((np.array([math.cos(a)*radius,math.sin(a)*radius]),h))
        for (a,h),(b,k) in zip(edge,edge[1:]+edge[:1]):
            mid=(a+b)/2
            hills.face([v(a*.57,-.125),v(b*.57,-.125),v(b,k),v(a,h)],tone,outward=(*v(-mid)[:2],1))
    hills.finish(still)


def marker(target, name, location, look=None):
    obj = MAP.objects.new(name,None)
    target.objects.link(obj)
    obj.location = v(location[:2],location[2])
    obj.empty_display_type = "ARROWS" if look else "PLAIN_AXES"
    obj.empty_display_size = 2.4
    if look:
        direction = Vector(v(look[:2],look[2]))-obj.location
        obj.rotation_euler = direction.to_track_quat("-Z","Y").to_euler()
    return obj


def lookdev(scene, still, overview):
    camera = MAP.cameras.new("Overview lens")
    camera.lens = 39
    camera.clip_end = 3300
    obj = MAP.objects.new("Overview render camera",camera)
    still.objects.link(obj)
    obj.matrix_world = overview.matrix_world.copy()
    scene.camera = obj
    world = MAP.worlds.new("Kathmandu dry-season sky")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    tex = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tex.outputs["Normal"],separate.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .03
    ramp.color_ramp.elements[0].color = (.67,.70,.72,1)
    ramp.color_ramp.elements[1].position = .67
    ramp.color_ramp.elements[1].color = (.19,.36,.56,1)
    ramp.color_ramp.elements.new(.26).color = (.40,.57,.72,1)
    links.new(separate.outputs["Z"],ramp.inputs["Fac"])
    bg = nodes.get("Background")
    links.new(ramp.outputs[0],bg.inputs["Color"])
    bg.inputs["Strength"].default_value = .62
    sun = MAP.lights.new("Warm west sun", "SUN")
    sun.energy = 2.9
    sun.angle = math.radians(9)
    sun.color = (1,.84,.69)
    source = MAP.objects.new(sun.name,sun)
    still.objects.link(source)
    source.rotation_euler = Vector((.73,.24,-.61)).to_track_quat("-Z","Y").to_euler()
    fill = MAP.lights.new("Cool sky fill","SUN")
    fill.energy = .74
    fill.angle = math.radians(30)
    fill.color = (.68,.80,1)
    light = MAP.objects.new(fill.name,fill)
    still.objects.link(light)
    light.rotation_euler = Vector((-.38,-.45,-.7)).to_track_quat("-Z","Y").to_euler()

    haze = material("Light road dust",(.61,.54,.45))
    shader = haze.node_tree.nodes.new("ShaderNodeVolumeScatter")
    shader.inputs["Color"].default_value = (.70,.63,.54,1)
    shader.inputs["Density"].default_value = .00034
    shader.inputs["Anisotropy"].default_value = .18
    output = haze.node_tree.nodes.get("Material Output")
    haze.node_tree.links.remove(output.inputs["Surface"].links[0])
    haze.node_tree.links.new(shader.outputs[0],output.inputs["Volume"])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,38))
    air = bpy.context.object
    air.name = "Low dust haze (stills only)"
    air.dimensions = (1750,1750,91)
    air.data.materials.append(haze)
    for c in list(air.users_collection):
        c.objects.unlink(air)
    still.objects.link(air)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = "//logs/review-scene-v1.png"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = .24


def dress_still(sim,assets,target):
    # A still-only queue demonstrates the scale and mixed traffic of the references.
    # Live traffic is supplied by the simulation in the game.
    for arm_name, arm in sim["arms"].items():
        if arm_name=="west":
            continue
        for i,path in enumerate(arm["incoming"]):
            line = PathLine(path["points"])
            s = line.length-4.0
            types = ["Motorcycle","Microbus","Motorcycle","Taxi","OldBus","Motorcycle",
                     "CarRed","SafaTempo","Motorcycle","SajhaBus","Motorcycle","Microbus"]
            for j in range(16):
                vehicle = types[(j+3*i+(2 if arm_name=="south" else 0))%len(types)]
                p,t = line.sample(s)
                angle = math.atan2(t[1],t[0])
                prop(assets,target,vehicle,p,.033,angle)
                if vehicle!="Motorcycle" and j%2==0:
                    prop(assets,target,"Motorcycle",p-t*.36+normal(t)*(1.48 if i==0 else -1.39),
                         .033,angle+.07)
                s -= 4.5 if vehicle=="Motorcycle" else (12.5 if vehicle in ("OldBus","SajhaBus") else 7.0)
        for i,path in enumerate(arm["outgoing"][:2]):
            line = PathLine(path["points"])
            for j in range(5):
                p,t=line.sample(13+j*23+i*7)
                prop(assets,target,("Motorcycle","Taxi","CarRed","Microbus","Motorcycle")[j],p,.032,
                     math.atan2(t[1],t[0]))


def verify_alignment(sim):
    mesh = MAP.objects["OSM carriageways"]
    bvh = BVHTree.FromObject(mesh,bpy.context.evaluated_depsgraph_get())
    paths = [p["points"] for arm in sim["arms"].values() for p in arm["incoming"]+arm["outgoing"]]
    samples = 0
    for points in paths+sim["movements"]:
        path = PathLine(points)
        for distance in np.arange(0,path.length,3):
            point,_ = path.sample(distance)
            hit,_,_,_ = bvh.ray_cast(Vector(v(point,4)),Vector((0,0,-1)))
            if hit is None:
                raise RuntimeError(f"Simulation path is off the paved mesh at {point}")
            samples += 1
    print(f"Verified asphalt coverage at {samples:,} simulation path samples",flush=True)


def verify_export(path):
    with path.open("rb") as f:
        magic,version,length = struct.unpack("<4sII",f.read(12))
        size,tag = struct.unpack("<I4s",f.read(8))
        doc = json.loads(f.read(size))
    assert (magic,version,tag,length)==(b"glTF",2,b"JSON",path.stat().st_size)
    nodes = {n.get("name"):n for n in doc["nodes"]}
    for name in ("camera_overview","camera_street","camera_bird","junction_centre"):
        assert name in nodes, name
    assert "translation" not in nodes["junction_centre"] or nodes["junction_centre"]["translation"]==[0,0,0]
    assert np.allclose(nodes["camera_overview"]["translation"],[18,17,90],atol=.001)
    assert all("bufferView" in i and "uri" not in i for i in doc["images"])
    assert length < 25_000_000, f"GLB exceeds 25 MB: {length:,} bytes"
    print(f"Verified {length/1e6:.2f} MB GLB with {len(doc['images'])} embedded images and aligned game markers",flush=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene["Map coordinates"] = "Blender (east, north, up); export (east, up, south); local metres"
    scene["Map source"] = "OpenStreetMap contributors; building fillers and street dressing are illustrative"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    assets = append_assets()
    textures()
    sim = simulation_geometry()
    road_collection = collection("Roads and infrastructure")
    architecture = collection("OSM and filler building footprints")
    furniture = collection("Street furniture and rooftop tanks")
    game_markers = collection("Game markers")
    ground = collection("Ground")
    landscape_collection = collection("Valley rim")
    still = collection("Still lighting and traffic")
    buildings(assets,architecture,furniture)
    bpy.context.view_layer.update()
    # Use only the building envelopes for obstruction tests. A top-down ray hits
    # the ground elsewhere once it has been added.
    building_mesh = MAP.objects["Mapped building envelopes"]
    bvh = BVHTree.FromObject(building_mesh,bpy.context.evaluated_depsgraph_get())
    streets(GEO,sim,assets,furniture,road_collection,bvh)
    landscape(ground,landscape_collection)
    overview = marker(game_markers,"camera_overview",(18,90,17),(-17,-34,4.6))
    marker(game_markers,"camera_street",(16.6,-48,1.82),(5,6,1.9))
    marker(game_markers,"camera_bird",(-2,-14,163),(-2,-13,0))
    marker(game_markers,"junction_centre",(0,0,0))
    bpy.context.view_layer.update()
    verify_alignment(sim)
    bpy.ops.object.select_all(action="DESELECT")
    for c in (road_collection,architecture,furniture,game_markers,ground,landscape_collection):
        for obj in c.objects:
            obj.select_set(True)
    model = ROOT / "public" / "models" / "junction.glb"
    model.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(model),export_format="GLB",use_selection=True,
                              export_yup=True,export_materials="EXPORT",export_cameras=False)
    verify_export(model)
    bpy.ops.object.select_all(action="DESELECT")
    dress_still(sim,assets,still)
    lookdev(scene,still,overview)
    for screen in MAP.screens:
        for area in screen.areas:
            if area.type=="VIEW_3D":
                area.spaces.active.region_3d.view_perspective="CAMERA"
    bpy.ops.file.pack_all()
    blend = ROOT / "koteshwor.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    Path(bpy.path.abspath(scene.render.filepath)).parent.mkdir(parents=True,exist_ok=True)
    options = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    if "--build-only" in options:
        return
    # On macOS a missing Metal context can abort the render process. Isolate
    # that call so the packed scene survives and CPU review remains available.
    render = subprocess.run(
        [bpy.app.binary_path, "-b", str(blend), "--python-exit-code", "1",
         "--python-expr", "import bpy; bpy.ops.render.render(write_still=True)"],
        capture_output=True, text=True,
    )
    output = render.stdout + render.stderr
    print(output, flush=True)
    if render.returncode == 0:
        return
    if "no default Metal device available" not in output:
        render.check_returncode()
    print("EEVEE could not initialize Metal. Rendering the review with CPU Cycles.", flush=True)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 36
    scene.cycles.use_denoising = True
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
