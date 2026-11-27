import * as T from 'three';
import { SIGNAL_ARM_IDS } from '../sim/scenarios.js';
import { SKYBRIDGE, skybridgeRoute } from '../sim/skybridge.js';
import { Batch } from './models.js';

const box = new T.BoxGeometry(1, 1, 1);
const concrete = new T.MeshStandardMaterial({ color: 0xadb6b8, roughness: 0.85 });
const deck = new T.MeshStandardMaterial({ color: 0x646f75, roughness: 0.9 });
const steel = new T.MeshStandardMaterial({ color: 0x3f7790, roughness: 0.55, metalness: 0.25 });
const axis = new T.Vector3(0, 0, 1);
const STEPS = 32;
const RAIL_HEIGHT = 1.12;

function beam(group, from, to, width, height, material) {
  const piece = new T.Mesh(box, material);
  const direction = new T.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  piece.quaternion.setFromUnitVectors(axis, direction.clone().normalize());
  piece.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  piece.scale.set(width, height, direction.length());
  group.add(piece);
}

function sectionPoint(segment, fraction, height, offset = 0) {
  const { from, to } = segment;
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return {
    x: from.x + dx * fraction + dz / length * offset,
    y: from.y + (to.y - from.y) * fraction + height,
    z: from.z + dz * fraction - dx / length * offset,
  };
}

function buildSpan(group, route, steps, posts) {
  const { width, stairRun } = SKYBRIDGE;
  const span = route.segments[1];
  beam(group, sectionPoint(span, 0, -0.23), sectionPoint(span, 1, -0.23), width, 0.46, deck);
  for (const end of [span.from, span.to]) {
    steps.put(end.x, end.y - 0.15, end.z, Math.atan2(span.to.x - span.from.x, span.to.z - span.from.z), width, 0.3, width);
    posts.put(end.x, (end.y - 0.42) / 2, end.z, 0, 0.65, end.y - 0.42, 0.65);
  }
  for (const segment of route.segments) {
    const stair = segment !== span;
    if (stair) {
      const yaw = Math.atan2(segment.to.x - segment.from.x, segment.to.z - segment.from.z);
      for (let i = 0; i < STEPS; i++) {
        const p = sectionPoint(segment, (i + 0.5) / STEPS, -0.12);
        steps.put(p.x, p.y, p.z, yaw, width, 0.24, stairRun / STEPS + 0.015);
      }
    }
    const length = Math.hypot(segment.to.x - segment.from.x, segment.to.z - segment.from.z);
    const intervals = Math.ceil(length / 1.7);
    for (const side of [-1, 1]) {
      const offset = side * (width / 2 - 0.08);
      for (const height of [0.52, RAIL_HEIGHT]) {
        beam(group, sectionPoint(segment, 0, height, offset), sectionPoint(segment, 1, height, offset), 0.07, 0.08, steel);
      }
      if (stair) {
        beam(group, sectionPoint(segment, 0, -0.34, offset), sectionPoint(segment, 1, -0.34, offset), 0.16, 0.30, steel);
      }
      for (let i = 0; i <= intervals; i++) {
        const p = sectionPoint(segment, i / intervals, RAIL_HEIGHT / 2, offset);
        posts.put(p.x, p.y, p.z, 0, 0.065, RAIL_HEIGHT, 0.065);
      }
    }
  }
}

export class Skybridges {
  constructor(scene) {
    this.root = new T.Group();
    this.root.visible = false;
    scene.add(this.root);
  }

  attach(state) {
    this.root.visible = state.rules.skybridge;
    if (!this.root.visible || this.network === state.network) return;
    this.network = state.network;
    for (const child of this.root.children) {
      if (child.isInstancedMesh) child.dispose();
    }
    this.root.clear();
    this.routes = Object.fromEntries(SIGNAL_ARM_IDS.map(arm => [arm, skybridgeRoute(this.network.arms[arm])]));
    const steps = new Batch(box, this.root, 256, deck);
    const posts = new Batch(box, this.root, 256, concrete);
    for (const route of Object.values(this.routes)) buildSpan(this.root, route, steps, posts);
    steps.update();
    posts.update();
    this.labelPoint = sectionPoint(this.routes.south.segments[1], 0.5, 2.8);
  }
}
