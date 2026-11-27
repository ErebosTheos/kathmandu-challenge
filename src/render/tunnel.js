import * as T from 'three';
import { sample } from '../sim/geometry.js';
import { CLOCK } from '../sim/params.js';
import { tunnelRoutes } from '../sim/tunnel.js';
import { Batch, vehicleModel } from './models.js';

const DEPTH = 7;
const PORTAL_RADIUS = 73;
const RAMP_LENGTH = 35;
const LANE_WIDTH = 3.6;

function depthAt(point, centre) {
  const distance = Math.hypot(point.x - centre.x, point.z - centre.z);
  const t = T.MathUtils.clamp((PORTAL_RADIUS + RAMP_LENGTH - distance) / RAMP_LENGTH, 0, 1);
  return -DEPTH * t * t * (3 - 2 * t);
}

function ribbon(vertices, a, b, width, offset = 0) {
  const edge = (p, side) => [
    p.x + p.dz * (offset + side * width / 2),
    p.y,
    p.z - p.dx * (offset + side * width / 2),
  ];
  const left = edge(a, -1), right = edge(a, 1);
  const nextLeft = edge(b, -1), nextRight = edge(b, 1);
  vertices.push(...left, ...right, ...nextLeft, ...right, ...nextRight, ...nextLeft);
}

function surface(vertices, color, opacity, order) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  const material = new T.MeshBasicMaterial({
    color, opacity, transparent: true, depthTest: false, depthWrite: false,
    side: T.DoubleSide, toneMapped: false, fog: false,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.renderOrder = order;
  return mesh;
}

export class Tunnel {
  constructor(scene, vehicleBatches) {
    this.root = new T.Group();
    this.root.renderOrder = 5;
    this.root.visible = false;
    this.geometry = new T.Group();
    this.geometry.renderOrder = 5;
    this.root.add(this.geometry);
    scene.add(this.root);
    this.enabled = true;
    this.portals = [];
    this.tmp = {};

    const material = vehicleBatches[0].material.clone();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    this.cars = vehicleBatches.map(batch => new Batch(batch.geometry, this.root, 96, material));
    for (const batch of this.cars) batch.mesh.renderOrder = 9;
  }

  build(network) {
    if (this.network === network) return;
    this.network = network;
    for (const mesh of [...this.geometry.children]) {
      this.geometry.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.paths = tunnelRoutes(network);
    this.portals = [];
    const decks = [], shoulders = [], portalLines = [];

    for (const [arm, path] of Object.entries(this.paths)) {
      let previous;
      let portal;
      for (let distance = 0; distance <= path.length; distance += 2) {
        const point = sample(path, distance);
        point.y = depthAt(point, this.centre);
        if (previous && (point.y < -0.05 || previous.y < -0.05)) {
          ribbon(decks, previous, point, LANE_WIDTH);
          for (const side of [-1, 1]) ribbon(shoulders, previous, point, 0.16, side * LANE_WIDTH / 2);
          if (!portal && point.y <= -DEPTH + 0.02) {
            portal = point;
            ribbon(portalLines, previous, point, LANE_WIDTH);
            this.portals.push({ arm, x: point.x, z: point.z });
          } else if (previous.y <= -DEPTH + 0.02 && point.y > -DEPTH + 0.02) {
            ribbon(portalLines, previous, point, LANE_WIDTH);
          }
        }
        previous = point;
      }
    }

    this.geometry.add(surface(decks, 0x08343e, 0.76, 1), surface(shoulders, 0x5ce8e0, 0.94, 2),
      surface(portalLines, 0x9ffff8, 0.93, 3));
  }

  attach(state, centre) {
    this.active = state.rules.gradeSeparation;
    this.root.visible = this.active && this.enabled;
    if (!this.active) return;
    this.centre = centre;
    this.build(state.network);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.root.visible = this.active && this.enabled;
  }

  update(state, fraction) {
    if (!this.root.visible) return;
    for (const batch of this.cars) batch.mesh.count = 0;
    const now = state.time - (1 - fraction) * CLOCK.step;
    for (const { vehicle, speed } of state.bypassed) {
      const distance = (now - vehicle.arrivedAt) * speed;
      if (distance < 0) continue;
      const point = sample(this.paths[vehicle.arm], distance, this.tmp);
      const depth = depthAt(point, this.centre);
      if (depth > -0.12) continue;
      this.cars[vehicleModel(vehicle)].put(point.x, depth + 0.06, point.z, point.heading - Math.PI / 2);
    }
    for (const batch of this.cars) batch.update();
  }
}
