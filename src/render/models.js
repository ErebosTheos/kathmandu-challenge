import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const vehicleModels = ['Motorcycle', 'Car', 'CarSilver', 'CarRed', 'CarGrey', 'Taxi', 'Microbus', 'SajhaBus', 'OldBus', 'SafaTempo', 'Truck'];
export const peopleModels = ['Pedestrian', 'PedestrianWoman', 'PedestrianStudent', 'PedestrianElder', 'PolicePerson'];
const byType = { motorcycle: 0, taxi: 5, microbus: 6, sajha: 7, bus: 8, tempo: 9, truck: 10 };
export const vehicleModel = vehicle => vehicle.type === 'car'
  ? 1 + ((Math.imul(vehicle.id, 0x9e3779b1) >>> 27) % 4) : byType[vehicle.type];

export function assetGeometry(root, name) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error('Model is missing from the asset library: ' + name);
  const origin = object.getWorldPosition(new T.Vector3());
  const parts = [];
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let source = mesh.geometry;
    const temporary = source.index !== null;
    if (temporary) source = source.toNonIndexed();
    const position = source.attributes.position;
    const normal = source.attributes.normal;
    const originalColor = source.attributes.color;
    const transform = mesh.matrixWorld.clone();
    transform.elements[12] -= origin.x;
    transform.elements[13] -= origin.y;
    transform.elements[14] -= origin.z;
    const groups = materials.length > 1 ? source.groups : [{ start: 0, count: position.count, materialIndex: 0 }];
    for (const { start, count, materialIndex } of groups) {
      const geo = new T.BufferGeometry();
      const material = materials[materialIndex];
      const tint = material.color ?? new T.Color(0xffffff);
      const p = new Float32Array(count * 3);
      const n = new Float32Array(count * 3);
      const color = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const at = start + i;
        const offset = i * 3;
        p[offset] = position.getX(at);
        p[offset + 1] = position.getY(at);
        p[offset + 2] = position.getZ(at);
        if (normal) {
          n[offset] = normal.getX(at);
          n[offset + 1] = normal.getY(at);
          n[offset + 2] = normal.getZ(at);
        }
        const glow = material.emissiveIntensity ?? 0;
        color[offset] = tint.r * (originalColor?.getX(at) ?? 1) + (material.emissive?.r ?? 0) * glow;
        color[offset + 1] = tint.g * (originalColor?.getY(at) ?? 1) + (material.emissive?.g ?? 0) * glow;
        color[offset + 2] = tint.b * (originalColor?.getZ(at) ?? 1) + (material.emissive?.b ?? 0) * glow;
      }
      geo.setAttribute('position', new T.BufferAttribute(p, 3));
      if (normal) geo.setAttribute('normal', new T.BufferAttribute(n, 3));
      else geo.computeVertexNormals();
      geo.setAttribute('color', new T.BufferAttribute(color, 3));
      geo.applyMatrix4(transform);
      parts.push(geo);
    }
    if (temporary) source.dispose();
  });
  if (!parts.length) throw new Error('Empty model: ' + name);
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

const modelMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.73, metalness: 0.06 });
const pose = new T.Object3D();

export class Batch {
  constructor(geometry, parent, capacity = 512, material = modelMaterial) {
    this.capacity = capacity;
    this.geometry = geometry;
    this.material = material;
    this.parent = parent;
    this.mesh = this.create(capacity);
  }

  create(capacity) {
    const mesh = new T.InstancedMesh(this.geometry, this.material, capacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = this.material === modelMaterial;
    this.parent.add(mesh);
    return mesh;
  }

  put(x, y, z, heading, sx = 1, sy = 1, sz = 1) {
    if (this.mesh.count === this.capacity) {
      const previous = this.mesh;
      this.capacity *= 2;
      this.mesh = this.create(this.capacity);
      this.mesh.instanceMatrix.array.set(previous.instanceMatrix.array);
      this.mesh.count = previous.count;
      this.parent.remove(previous);
      previous.dispose();
    }
    pose.position.set(x, y, z);
    pose.rotation.set(0, heading, 0);
    pose.scale.set(sx, sy, sz);
    pose.updateMatrix();
    this.mesh.setMatrixAt(this.mesh.count++, pose.matrix);
  }

  update() {
    if (!this.mesh.count) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.mesh.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
