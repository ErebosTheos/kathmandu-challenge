import * as T from 'three';
import { sample } from '../sim/geometry.js';
import { ARM_IDS, SIGNAL_ARM_IDS } from '../sim/scenarios.js';
import { DRIVER, TOOLS } from '../sim/params.js';
import { crossingSite, curbSite } from '../game/tools.js';
import { Batch } from './models.js';

const stops = { mapped: 0xf9d681, assumed: 0x96b5c9, far: 0x58cde0 };
const palette = { moveStop: 0x58cde0, noStoppingZone: 0xfa4a62, busBay: 0x48bfd4, zebra: 0xf8f1cb,
  pedestrianSignal: 0x80f4b3, freeLeft: 0x68eaaa, policeOfficer: 0x81a8ff, signalTiming: 0xf9d681, infoCampaign: 0x81a8ff };
const RG = 0.12;
const materials = new Map();
const flat = (color, opacity = 1) => {
  const key = color * 10 + opacity;
  if (!materials.has(key)) materials.set(key, new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1, toneMapped: false }));
  return materials.get(key);
};
const disc = new T.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
const ring = new T.RingGeometry(0.84, 1, 28).rotateX(-Math.PI / 2);
const ball = new T.SphereGeometry(0.4, 10, 7);
const box = new T.BoxGeometry(1, 1, 1);
const arrow = new T.ConeGeometry(0.65, 1.5, 3).rotateZ(Math.PI);
const heat = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const heatColor = new T.Color();
const ground = {};
const conflictWall = new T.OctahedronGeometry(0.75);
const tempSample = {};
const yaw = pt => pt.heading - Math.PI / 2;

function shape(group, geometry, color, x, y, z, sx = 1, sy = 1, sz = 1, heading = 0, opacity = 1) {
  const mesh = new T.Mesh(geometry, flat(color, opacity));
  mesh.position.set(x, y, z);
  mesh.rotation.y = heading;
  mesh.scale.set(sx, sy, sz);
  group.add(mesh);
  return mesh;
}

function stripe(group, point, color, length, width, angle = 0, opacity = 1) {
  shape(group, box, color, point.x, RG, point.z, length, 0.045, width, yaw(point) + angle, opacity);
}

function stopSign(group, point, color, side) {
  shape(group, ring, color, point.x, RG, point.z, 1.4, 1, 1.4);
  shape(group, box, color, point.x, 1.55, point.z, 0.12, 3.1, 0.12);
  shape(group, box, color, point.x, 3.05, point.z, 1.17, 0.62, 0.19, yaw(point));
  shape(group, ball, color, point.x, 3.1, point.z, 0.33, 0.33, 0.33);
  if (side === 'far') shape(group, disc, color, point.x, RG - 0.02, point.z, 0.7, 1, 0.7, 0, 0.5);
}

function propose(group, arm, input, point, color) {
  const { type, distance, start, length, enabled } = input;
  if (type === 'moveStop') {
    stopSign(group, point, color, input.side);
  } else if (type === 'noStoppingZone') {
    for (let delta = 0; delta <= length; delta += 2.5) {
      const p = sample(arm.incoming[0].path, arm.incoming[0].path.length - start - delta);
      p.x += p.dz * arm.incoming[0].width * 0.44;
      p.z -= p.dx * arm.incoming[0].width * 0.44;
      stripe(group, p, color, 2.25, 0.35, Math.PI / 4);
    }
  } else if (type === 'busBay') {
    const p = sample(arm.bay.path, arm.bay.path.length - distance);
    stripe(group, p, color, TOOLS.busBay.halfLength * 2, 3.3, 0, 0.42);
    for (const offset of [-1.55, 1.55]) {
      stripe(group, { ...p, x: p.x + p.dz * offset, z: p.z - p.dx * offset }, color, TOOLS.busBay.halfLength * 2, 0.22);
    }
  } else if (type === 'zebra' || type === 'pedestrianSignal') {
    const p = crossingSite(arm);
    const angle = Math.atan2(-p.dz, p.dx);
    for (let offset = -p.width / 2 + 0.45; offset < p.width / 2; offset += 1.35) {
      shape(group, box, color, p.x + p.dx * offset, RG, p.z + p.dz * offset, 0.65, 0.045, 3.3, angle);
    }
    if (type === 'pedestrianSignal') {
      const p = curbSite(arm, 2);
      shape(group, box, color, p.x, 1.85, p.z, 0.16, 3.7, 0.16);
      shape(group, box, color, p.x, 3.6, p.z, 0.55, 0.65, 0.55);
    }
  } else if (type === 'freeLeft') {
    const p = sample(arm.incoming[0].path, arm.incoming[0].path.length - 5);
    stripe(group, p, enabled ? color : 0xff5268, 10, 0.7, 0, 0.82);
    stripe(group, { ...p, x: p.x + p.dx * 4, z: p.z + p.dz * 4 }, enabled ? color : 0xff5268, 4, 0.65, -0.65);
  } else if (type === 'policeOfficer') {
    shape(group, ring, color, point.x, RG, point.z, 2.2, 1, 2.2);
    shape(group, disc, color, point.x, RG - 0.02, point.z, 2.2, 1, 2.2, 0, 0.24);
  }
}

export class Overlays {
  constructor(parent, policeGeometry) {
    this.root = new T.Group();
    parent.add(this.root);
    this.signals = new T.Group();
    this.marks = new T.Group();
    this.preview = new T.Group();
    this.root.add(this.marks, this.signals, this.preview);
    this.police = new Batch(policeGeometry, this.marks, 8);
    this.policePreview = new Batch(policeGeometry, this.root, 1);
    this.blockers = new Batch(ring, this.root, 16, new T.MeshBasicMaterial({ color: 0xff244a, transparent: true, depthWrite: false, toneMapped: false }));
    this.blockIcons = new Batch(arrow, this.root, 16, flat(0xff244a));
    this.conflict = shape(this.root, conflictWall, 0xff2e55, 0, 4, 0);
    this.lamps = {};
    this.heat = [];
    this.queueGroup = new T.Group();
    this.root.add(this.queueGroup);
    this.queueEnabled = true;
  }

  reset(state) {
    this.signals.clear();
    this.queueGroup.clear();
    this.heat.length = 0;
    this.network = state.network;
    this.rules = null;
    this.setPreview(null);
    for (const arm of SIGNAL_ARM_IDS) {
      const road = state.network.arms[arm];
      const p = curbSite(road, 2.5);
      shape(this.signals, box, 0x18242c, p.x, 2.65, p.z, 0.14, 5.3, 0.14);
      shape(this.signals, box, 0x18242c, p.x, 5.25, p.z, 1.25, 1.1, 1.25);
      this.lamps[arm] = shape(this.signals, ball, 0xe63254, p.x, 5.57, p.z, 1.35, 1.35, 1.35);
    }
    for (const arm of ARM_IDS) for (const lane of state.network.arms[arm].roadLanes) {
      const steps = Math.ceil(Math.min(lane.path.length, 165) / 5);
      const tiles = new T.InstancedMesh(heat, new T.MeshBasicMaterial({ transparent: true, opacity: 0.43, depthWrite: false, toneMapped: false }), steps);
      tiles.frustumCulled = false;
      tiles.count = 0;
      const dummy = new T.Object3D();
      this.heat.push({ lane, tiles, steps, dummy });
      this.queueGroup.add(tiles);
    }
  }

  updateRules(state) {
    if (this.rules === state.rules.arms) return;
    this.rules = state.rules.arms;
    this.marks.clear();
    this.marks.add(this.police.mesh);
    this.police.mesh.count = 0;
    for (const arm of ARM_IDS) {
      const road = state.network.arms[arm];
      const local = this.rules[arm];
      for (const stop of local.stops) {
        const p = curbSite(road, stop.distance, stop.side, stop.laneIndex);
        stopSign(this.marks, p, stop.side === 'far' ? stops.far : stop.assumed ? stops.assumed : stops.mapped, stop.side);
      }
      for (const zone of local.zones) propose(this.marks, road, { ...zone, length: zone.end - zone.start }, ground, palette.noStoppingZone);
      for (const bay of local.bays) propose(this.marks, road, { ...bay, distance: bay.distance ?? road.officialStop.distance }, ground, palette.busBay);
      for (const officer of local.officers) {
        const p = curbSite(road, officer.distance);
        propose(this.marks, road, officer, p, palette.policeOfficer);
        this.police.put(p.x, 0, p.z, yaw(p) + Math.PI / 2);
      }
      if (local.crosswalk !== 'gap') {
        const type = local.crosswalk === 'zebra' ? 'zebra' : 'pedestrianSignal';
        propose(this.marks, road, { type }, ground, palette[type]);
      }
      if (local.channelizedLeft || !local.freeLeft) propose(this.marks, road, { type: 'freeLeft', enabled: local.freeLeft }, ground, palette.freeLeft);
    }
    this.police.update();
  }

  setPreview(site) {
    this.preview.clear();
    this.policePreview.mesh.count = 0;
    if (!site || !this.network || !site.arm) return;
    const { input, arm } = site;
    propose(this.preview, this.network.arms[arm], input, site, palette[input.type]);
    shape(this.preview, ring, palette[input.type], site.x, RG + 0.05, site.z, 2.4, 1, 2.4);
    if (input.type === 'policeOfficer') {
      this.policePreview.put(site.x, 0, site.z, yaw(site));
      this.policePreview.update();
    }
  }

  updateTick(state) {
    for (const arm of SIGNAL_ARM_IDS) {
      const { arm: active, stage } = state.signal;
      this.lamps[arm].material = flat(arm === active && stage !== 'allRed' ? (stage === 'green' ? 0x47fba1 : 0xffbe42) : 0xee2e53);
    }
    if (!this.queueEnabled) return;
    for (const { lane, tiles, steps, dummy } of this.heat) {
      let farthest = 0;
      let stopped = 0;
      const incoming = lane.kind === 'incoming';
      for (const vehicle of lane.vehicles) {
        if (vehicle.speed > DRIVER.stoppedSpeed) continue;
        stopped++;
        farthest = Math.max(farthest, incoming ? lane.path.length - vehicle.s : vehicle.s);
      }
      const count = Math.min(steps, Math.ceil((farthest + 2) / 5));
      tiles.count = stopped ? count : 0;
      if (!tiles.count) continue;
      for (let i = 0; i < count; i++) {
        sample(lane.path, incoming ? lane.path.length - (i + 0.5) * 5 : (i + 0.5) * 5, tempSample);
        dummy.position.set(tempSample.x, RG - 0.045, tempSample.z);
        dummy.rotation.y = tempSample.heading;
        dummy.scale.set(lane.width * 0.9, 1, 4.82);
        dummy.updateMatrix();
        tiles.setMatrixAt(i, dummy.matrix);
        heatColor.setHSL(Math.max(0, 0.122 - stopped * 0.006) + i / count * 0.042, 0.94, 0.52);
        tiles.setColorAt(i, heatColor);
      }
      tiles.instanceMatrix.needsUpdate = true;
      tiles.instanceColor.needsUpdate = true;
    }
  }

  startFrame(time, conflict) {
    this.blockers.mesh.count = 0;
    this.blockIcons.mesh.count = 0;
    this.blockers.material.opacity = 0.58 + Math.sin(time * 7) * 0.36;
    this.conflict.visible = Boolean(conflict);
    if (conflict) {
      const crossing = this.network.arms[conflict.arm].crossing.point;
      this.conflict.position.set(crossing[0], 3.5 + Math.sin(time * 5) * 0.45, crossing[1]);
      this.conflict.rotation.y = time * 3;
    }
  }

  blocker(x, z, heading, length, type) {
    this.blockers.put(x, 0.19, z, heading, length * 0.59, 1, 1.65);
    this.blockIcons.put(x, type === 'tempo' ? 3.4 : 4.6, z, 0);
  }

  endFrame() {
    this.blockers.update();
    this.blockIcons.update();
  }
}
