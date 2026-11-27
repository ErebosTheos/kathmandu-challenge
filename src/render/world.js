import * as T from 'three';
import { Tunnel } from './tunnel.js';
import { Skybridges } from './skybridge.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARM_IDS } from '../sim/scenarios.js';
import { sampleSkybridge } from '../sim/skybridge.js';
import { curbSite, crossingSite } from '../game/tools.js';
import { assetGeometry, Batch, peopleModels, vehicleModel, vehicleModels } from './models.js';
import { Overlays } from './overlays.js';

const DPR_LIMIT = 1.5;
const CAMERA_FOV = 42;
const UP = new T.Vector3(0, 1, 0);
const GROUND = new T.Plane(UP, 0);
const halfTurn = Math.PI;
const doubleTurn = halfTurn * 2;
const blend = (a, b, t) => a + (b - a) * t;
const pedestrians = new WeakMap();
const { clamp } = T.MathUtils;

export function capturePoses(state) {
  for (const v of state.vehicles) {
    v.renderPreviousX = v.x;
    v.renderPreviousZ = v.z;
    v.renderPreviousHeading = v.heading;
  }
}

function sky(scene) {
  const material = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec3 p; void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 p;
      void main(){
        vec3 dir=normalize(p);
        vec3 color=mix(vec3(.73,.67,.58),vec3(.31,.48,.59),smoothstep(0.,.69,dir.y));
        color+=vec3(.17,.09,.02)*pow(max(0.,dot(dir,normalize(vec3(-.66,.22,.42)))),12.);
        gl_FragColor=vec4(color,1.);
      }`,
  });
  const dome = new T.Mesh(new T.SphereGeometry(1080, 20, 10), material);
  dome.renderOrder = -1;
  scene.add(dome);
}

export class World {
  constructor(canvas, labels) {
    this.canvas = canvas;
    this.labels = labels;
    this.renderer = new T.WebGLRenderer({ logarithmicDepthBuffer: true, canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_LIMIT));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.17;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0xc9bbab, 0.0027);
    sky(this.scene);
    this.scene.add(new T.HemisphereLight(0xb6d6f7, 0xad8572, 1.75));
    const sun = new T.DirectionalLight(0xffd4a5, 3.15);
    sun.position.set(-90, 125, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    Object.assign(sun.shadow.camera, { left: -135, right: 135, top: 135, bottom: -135, near: 1, far: 380 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.17;
    sun.shadow.bias = -0.00015;
    this.scene.add(sun, sun.target);
    const pmrem = new T.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.035, 0.1, 50, { size: 64 }).texture;
    this.scene.environmentIntensity = 0.47;
    room.dispose();
    pmrem.dispose();

    this.camera = new T.PerspectiveCamera(CAMERA_FOV, 1, 0.45, 1300);
    this.ghostCamera = new T.PerspectiveCamera(CAMERA_FOV, 1, 0.45, 1300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 19;
    this.controls.maxDistance = 315;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.055;
    this.controls.minPolarAngle = 0.03;
    this.controls.maxTargetRadius = 160;
    this.controls.mouseButtons.RIGHT = T.MOUSE.PAN;
    this.controls.touches.TWO = T.TOUCH.DOLLY_PAN;

    this.pointer = new T.Vector2();
    this.mouseRay = new T.Raycaster();
    this.point = new T.Vector3();
    this.temp = new T.Vector3();
    this.followPoint = new T.Vector3();
    this.travel = new T.Vector3();
    this.transition = { position: new T.Vector3(), target: new T.Vector3(), active: false };
    this.dimensions = { w: 0, h: 0 };
    this.actors = new T.Group();
    this.scene.add(this.actors);
    this.popups = [];
    this.anchors = [];
    this.presetPositions = {};
    this.selection = this.label('vehicle-pin');
    this.hoverLabel = this.label('world-tooltip');
  }

  label(className) {
    const element = document.createElement('div');
    element.className = className;
    element.hidden = true;
    this.labels.append(element);
    return element;
  }

  async load() {
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL + 'models/';
    const [junction, vehicles, props] = await Promise.all(['junction.glb', 'vehicles.glb', 'props.glb'].map(path => loader.loadAsync(base + path)));
    for (const { scene } of [junction, vehicles, props]) scene.updateMatrixWorld(true);
    junction.scene.traverse(object => {
      if (!object.isMesh) return;
      object.receiveShadow = true;
      // The city extends beyond the near shadow camera. Only nearby geometry casts into it.
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
      const centre = this.temp.copy(object.geometry.boundingSphere.center).applyMatrix4(object.matrixWorld);
      object.castShadow = Math.hypot(centre.x, centre.z) < 178 && centre.y > 0.35;
    });
    this.scene.add(junction.scene);
    const marker = (name, x, y, z) => junction.scene.getObjectByName(name)?.getWorldPosition(new T.Vector3()) ?? new T.Vector3(x, y, z);
    this.centre = marker('junction_centre', -9, 0, -6);
    this.presetPositions.overview = marker('camera_overview', 112, 100, 125);
    this.presetPositions.street = marker('camera_street', 38, 9, -52);
    // North-up, high enough to show the whole Y junction (Ring Road N, Ring Road SW, Araniko SE).
    this.presetPositions.bird = new T.Vector3(this.centre.x, 230, this.centre.z + 0.5);
    this.controls.cursor.copy(this.centre);
    this.batches = vehicleModels.map(name => new Batch(assetGeometry(vehicles.scene, name), this.actors, 512));
    this.people = peopleModels.slice(0, -1).map(name => new Batch(assetGeometry(props.scene, name), this.actors, 128));
    this.shadows = new Batch(new T.CircleGeometry(1, 14).rotateX(-halfTurn / 2), this.actors, 800,
      new T.MeshBasicMaterial({ color: 0x231c1a, transparent: true, opacity: 0.24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.overlay = new Overlays(this.scene, assetGeometry(props.scene, 'PolicePerson'));
    this.tunnel = new Tunnel(this.scene, this.batches);
    this.skybridges = new Skybridges(this.scene);
    this.skybridgeLabel = this.label('skybridge-label');
    this.skybridgeLabel.textContent = 'Pedestrian skybridge';
    this.portalLabels = Object.fromEntries([['north', 'Tinkune portal'], ['east', 'Jadibuti portal']].map(([arm, name]) => {
      const label = this.label('portal-label');
      label.textContent = name;
      return [arm, label];
    }));
    this.renderer.shadowMap.needsUpdate = true;
    this.ready = true;
    this.setPreset('overview', true);
  }

  attach(state) {
    this.overlay.reset(state);
    this.tunnel?.attach(state, this.centre);
    this.skybridges.attach(state);
    this.skybridgeLabel.hidden = true;
    for (const label of Object.values(this.portalLabels)) label.hidden = true;
    this.vehicles = state.vehicles;
    this.lastTick = -1;
    this.selected = null;
    this.follow = false;
    this.setPreview(null);
    this.setAnchors([]);
    for (const popup of this.popups) popup.element.hidden = true;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.dimensions.w && h === this.dimensions.h) return;
    this.dimensions.w = w;
    this.dimensions.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setPreset(name, instant = false) {
    if (name === 'follow') {
      if (!this.selected) return false;
      this.follow = true;
      this.transition.active = false;
      this.followPoint.set(this.selected.x, 1, this.selected.z);
      this.controls.target.copy(this.followPoint);
      this.camera.position.set(this.selected.x - 15, 11, this.selected.z + 14);
      return true;
    }

    this.follow = false;
    const position = this.presetPositions[name];
    if (!position) return false;
    this.transition.position.copy(position);
    const offset = this.transition.position.sub(this.centre);
    if (name === 'overview' && innerWidth < 720) offset.setLength(Math.min(275, Math.max(187, offset.length() * 1.12)));
    if (name === 'street') offset.y = Math.max(offset.y, 5);
    this.transition.position.add(this.centre);
    this.transition.target.copy(this.centre);
    this.transition.target.y = name === 'street' ? 3 : 0;
    if (instant) {
      this.camera.position.copy(this.transition.position);
      this.controls.target.copy(this.transition.target);
      this.controls.update();
    }
    this.transition.active = !instant;
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'game';
    if (mode === 'title') this.setPreset('overview', true);
  }

  cancelCameraTravel() {
    this.transition.active = false;
    this.follow = false;
  }

  setPlacementMode(enabled) {
    this.controls.mouseButtons.LEFT = enabled ? null : T.MOUSE.ROTATE;
    this.controls.touches.ONE = enabled ? null : T.TOUCH.ROTATE;
    if (!enabled) this.setPreview(null);
  }

  setPreview(site, label = '') {
    if (!this.overlay) return;
    this.hover = site;
    this.hoverLabel.textContent = label;
    this.hoverLabel.hidden = !site?.arm;
    this.overlay.setPreview(site);
  }

  setAnchors(anchors) {
    for (const { element } of this.anchors) element.remove();
    this.anchors.length = 0;
    for (const anchor of anchors) {
      const element = this.label('placement-anchor');
      element.textContent = anchor.name;
      element.dataset.anchor = anchor.arm;
      this.anchors.push({ ...anchor, element });
    }
  }

  setQueue(enabled) {
    this.overlay.queueEnabled = enabled;
    this.overlay.queueGroup.visible = enabled;
    this.lastTick = -1;
  }

  ray(x, y) {
    this.pointer.set(x / this.dimensions.w * 2 - 1, 1 - y / this.dimensions.h * 2);
    this.mouseRay.setFromCamera(this.pointer, this.camera);
    return this.mouseRay.ray;
  }

  ground(x, y) { return this.ray(x, y).intersectPlane(GROUND, this.point); }

  pick(x, y) {
    const ray = this.ray(x, y);
    let best = 1;
    let match = null;
    const fraction = this.fraction ?? 1;
    for (const v of this.vehicles) {
      const radius = Math.max(0.85, v.length * 0.42);
      this.temp.set(blend(v.renderPreviousX ?? v.x, v.x, fraction), radius * 0.55, blend(v.renderPreviousZ ?? v.z, v.z, fraction));
      const distance = ray.distanceSqToPoint(this.temp) / (radius * radius) + ray.origin.distanceTo(this.temp) * 0.0001;
      if (distance < best) {
        best = distance;
        match = v;
      }
    }
    this.selected = match;
    if (!match) this.follow = false;
    return match;
  }

  addPopup(event) {
    if (event.type !== 'curb-blockage' || event.vehicleSecondsLost < 1 || !this.vehicles) return;
    const vehicle = this.vehicles.find(agent => agent.id === event.vehicleId);
    if (!vehicle) return;
    const now = performance.now();
    if (now - (this.lastPopup ?? -1000) < 900) return;
    this.lastPopup = now;
    let popup = this.popups.find(item => item.until < now);
    if (!popup && this.popups.length < 5) {
      popup = { element: this.label('delay-popup') };
      this.popups.push(popup);
    }
    if (!popup) return;
    popup.x = vehicle.x;
    popup.z = vehicle.z;
    popup.until = now + 1900;
    popup.element.textContent = '+' + Math.round(event.vehicleSecondsLost) + ' s';
    popup.element.title = 'Vehicle-seconds lost to curb blockage';
  }

  project(x, y, z, element, margin = 0) {
    this.temp.set(x, y, z).project(this.camera);
    const { w, h } = this.dimensions;
    element.hidden = !(Math.abs(this.temp.x) <= 1 && Math.abs(this.temp.y) <= 1 && this.temp.z < 1);
    if (!element.hidden) {
      const screenX = clamp((this.temp.x + 1) * w / 2, margin, w - margin);
      const screenY = (1 - this.temp.y) * h / 2;
      element.style.transform = 'translate3d(' + screenX.toFixed(1) + 'px,' + screenY.toFixed(1) + 'px,0) translate(-50%,-50%)';
    }
  }

  actorsAt(state, fraction, overlays) {
    const { batches, people, shadows } = this;
    for (const batch of batches) batch.mesh.count = 0;
    for (const batch of people) batch.mesh.count = 0;
    shadows.mesh.count = 0;
    for (const v of state.vehicles) {
      const x = blend(v.renderPreviousX ?? v.x, v.x, fraction);
      const z = blend(v.renderPreviousZ ?? v.z, v.z, fraction);
      const pre = v.renderPreviousHeading ?? v.heading;
      let delta = v.heading - pre;
      if (delta > halfTurn) delta -= doubleTurn;
      else if (delta < -halfTurn) delta += doubleTurn;
      const heading = pre + delta * fraction - halfTurn / 2;
      batches[vehicleModel(v)].put(x, 0, z, heading);
      shadows.put(x, 0.043, z, heading, v.length * 0.51, 1, v.type === 'motorcycle' ? 0.48 : 0.95);
      const stop = v.stop;
      if (overlays && stop && stop.started !== null && !stop.completed && !stop.bay) this.overlay.blocker(x, z, heading, v.length, v.type);
      if (overlays && v === this.selected) this.project(x, v.type === 'sajha' || v.type === 'bus' ? 4.8 : 3.4, z, this.selection);
    }
    for (const batch of batches) batch.update();
    shadows.update();
    if (overlays) this.tunnel.update(state, fraction);

    const now = state.time - (1 - fraction) * 0.25;
    let sites = pedestrians.get(state.network);
    if (!sites) {
      sites = Object.fromEntries(ARM_IDS.map(arm => [arm, crossingSite(state.network.arms[arm])]));
      pedestrians.set(state.network, sites);
    }
    const bridgePose = {};
    for (const arm of ARM_IDS) {
      const lane = state.pedestrians[arm];
      const p = sites[arm];
      const heading = Math.atan2(p.dx, p.dz) - halfTurn / 2;
      const edge = p.width * 0.5 + 0.85;
      for (const person of lane.crossing) {
        if (person.underpass) continue;
        if (person.skybridge) {
          const route = this.skybridges.routes?.[arm];
          if (route && person.started <= now) {
            const elapsed = now - person.started;
            const p = sampleSkybridge(route, elapsed, person.incomingFirst, (person.incomingFirst ? 1 : -1) * 0.5, bridgePose);
            people[person.id % people.length].put(p.x, p.y + Math.sin(elapsed * 8) * 0.035, p.z, p.heading);
          }
          continue;
        }
        const t = clamp((now - person.started) / (person.until - person.started), 0, 1);
        const position = (person.incomingFirst ? t - 0.5 : 0.5 - t) * edge * 2;
        const offset = (person.id % 5 - 2) * 0.46;
        people[person.id % people.length].put(p.x + p.dx * position + p.dz * offset, Math.sin(t * 24) * 0.04, p.z + p.dz * position - p.dx * offset, heading + (person.incomingFirst ? 0 : halfTurn));
      }
      let i = 0;
      for (const person of lane.waiting) {
        const position = person.id % 2 ? edge : -edge;
        const offset = (i++ % 11 - 5) * 0.65;
        people[person.id % people.length].put(p.x + p.dx * position + p.dz * offset, 0, p.z + p.dz * position - p.dx * offset, heading + (position > 0 ? halfTurn : 0));
      }
    }
    for (const batch of people) batch.update();
  }

  draw(state, fraction, seconds, conflict, ghost = null, ghostBox = null) {
    this.resize();
    this.fraction = fraction;
    if (this.mode === 'title' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.travel.copy(this.camera.position).sub(this.controls.target).applyAxisAngle(UP, seconds * 0.058);
      this.camera.position.copy(this.controls.target).add(this.travel);
    }
    if (this.transition.active) {
      const easing = 1 - Math.exp(-seconds * 9);
      this.camera.position.lerp(this.transition.position, easing);
      this.controls.target.lerp(this.transition.target, easing);
      if (this.camera.position.distanceToSquared(this.transition.position) < 0.05) this.transition.active = false;
    }
    if (this.selected && !state.vehicles.includes(this.selected)) {
      this.selected = null;
      this.follow = false;
    }
    if (this.follow) {
      const v = this.selected;
      this.followPoint.set(blend(v.renderPreviousX ?? v.x, v.x, fraction), 1.2, blend(v.renderPreviousZ ?? v.z, v.z, fraction));
      this.travel.copy(this.followPoint).sub(this.controls.target).multiplyScalar(1 - Math.exp(-seconds * 10));
      this.camera.position.add(this.travel);
      this.controls.target.add(this.travel);
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    const gameplay = this.mode === 'game' || this.mode === 'report';
    this.overlay.root.visible = gameplay;
    if (gameplay) {
      this.overlay.updateRules(state);
      if (state.tick !== this.lastTick) {
        this.overlay.updateTick(state);
        this.lastTick = state.tick;
      }
      this.overlay.startFrame(performance.now() / 1000, conflict && conflict.time + 7 > state.time ? conflict : null);
    }
    this.selection.hidden = true;
    this.actorsAt(state, fraction, gameplay);
    if (gameplay) this.overlay.endFrame();
    for (const label of Object.values(this.portalLabels)) label.hidden = true;
    this.skybridgeLabel.hidden = true;
    if (gameplay && this.skybridges.root.visible) {
      const { x, y, z } = this.skybridges.labelPoint;
      this.project(x, y, z, this.skybridgeLabel, 78);
    }
    if (gameplay && this.tunnel.root.visible) {
      for (const { arm, x, z } of this.tunnel.portals) {
        this.project(x + 13, 2, blend(z, this.centre.z, 0.16), this.portalLabels[arm], 70);
      }
    }
    if (this.hover?.arm) this.project(this.hover.x, 3.5, this.hover.z, this.hoverLabel);
    for (const { x, z, element } of this.anchors) this.project(x, 1.75, z, element);
    const now = performance.now();
    for (const popup of this.popups) {
      if (popup.until <= now || !gameplay) {
        popup.element.hidden = true;
      } else {
        this.project(popup.x, 4.9 + (1 - (popup.until - now) / 1900) * 3, popup.z, popup.element);
      }
    }
    const { w, h } = this.dimensions;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    if (!ghost || !ghostBox || ghostBox.hidden) return;
    const bounds = ghostBox.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.ghostCamera.copy(this.camera, false);
    this.ghostCamera.aspect = bounds.width / bounds.height;
    this.ghostCamera.fov = 53;
    this.ghostCamera.updateProjectionMatrix();
    const bottom = h - bounds.bottom;
    this.overlay.root.visible = false;
    const tunnelShown = this.tunnel?.root.visible;
    const skybridgesShown = this.skybridges.root.visible;
    if (this.tunnel) this.tunnel.root.visible = false;
    this.skybridges.root.visible = false;
    this.actorsAt(ghost, fraction, false);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(bounds.left, bottom, bounds.width, bounds.height);
    this.renderer.setViewport(bounds.left, bottom, bounds.width, bounds.height);
    this.renderer.render(this.scene, this.ghostCamera);
    this.renderer.setScissorTest(false);
    if (this.tunnel) this.tunnel.root.visible = tunnelShown;
    this.skybridges.root.visible = skybridgesShown;
  }
}

export function anchorsFor(state, tool, options) {
  const far = tool === 'moveStop' && options.side === 'far';
  const crossing = tool === 'zebra';
  const arms = tool === 'moveStop' && !far ? [options.sourceArm] : ARM_IDS;
  return arms.filter(arm => !(crossing && options.pedSignal && arm === 'west')).map(arm => {
    const road = state.network.arms[arm];
    const site = crossing ? crossingSite(road) : curbSite(road, tool === 'freeLeft' ? 4 : far ? 44 : 17, far ? 'far' : 'near');
    return { ...site, arm, name: { north: 'Ring Rd N', south: 'Ring Rd SW', east: 'Araniko Hwy', west: 'Seti O.P. Marg' }[arm] };
  });
}
