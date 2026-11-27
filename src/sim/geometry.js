export function polyline(points) {
  const vertices = points.filter(([x, z], i) => !i || x !== points[i - 1][0] || z !== points[i - 1][1]);
  const distances = [0];
  for (let i = 1; i < vertices.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(vertices[i][0] - vertices[i - 1][0], vertices[i][1] - vertices[i - 1][1]));
  }
  if (vertices.length < 2) throw new RangeError('A road path requires two distinct points');
  return { points: vertices, distances, length: distances.at(-1) };
}

export function sample(path, s, target = {}) {
  const distance = Math.max(0, Math.min(s, path.length));
  let low = 0;
  let high = path.distances.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (distance < path.distances[middle]) high = middle;
    else low = middle;
  }
  const [x, z] = path.points[low];
  const [nextX, nextZ] = path.points[high];
  const length = path.distances[high] - path.distances[low];
  const fraction = (distance - path.distances[low]) / length;
  target.x = distance === path.length ? nextX : x + (nextX - x) * fraction;
  target.z = distance === path.length ? nextZ : z + (nextZ - z) * fraction;
  target.dx = (nextX - x) / length;
  target.dz = (nextZ - z) / length;
  target.heading = Math.atan2(target.dx, target.dz); // Three.js yaw for a +Z-facing model.
  return target;
}

export function crossingSite(road) {
  const roadEnd = sample(road.incoming[0].path, road.incoming[0].path.length);
  const across = sample(road.outgoing[0].path, 0);
  let dx = across.x - roadEnd.x;
  let dz = across.z - roadEnd.z;
  const along = dx * roadEnd.dx + dz * roadEnd.dz;
  dx -= along * roadEnd.dx;
  dz -= along * roadEnd.dz;
  const length = Math.hypot(dx, dz);
  const width = Math.max(road.crossing.length, length + road.incoming[0].width * 0.8);
  return { x: (roadEnd.x + across.x) / 2, z: (roadEnd.z + across.z) / 2, dx: dx / length, dz: dz / length, width };
}

export function slicePath(path, from, to) {
  const start = sample(path, from);
  const end = sample(path, to);
  const interior = path.points.filter((_, i) => path.distances[i] > from && path.distances[i] < to);
  return polyline([[start.x, start.z], ...interior, [end.x, end.z]]);
}

export function offsetPath(path, offset) {
  return polyline(path.points.map(([x, z], i, points) => {
    const [prevX, prevZ] = points[Math.max(0, i - 1)];
    const [nextX, nextZ] = points[Math.min(points.length - 1, i + 1)];
    const dx = nextX - prevX;
    const dz = nextZ - prevZ;
    const length = Math.hypot(dx, dz);
    return [x + dz / length * offset, z - dx / length * offset];
  }));
}

export function projectToPath(path, [x, z]) {
  let best = { s: 0, distance: Infinity };
  for (let i = 1; i < path.points.length; i++) {
    const [ax, az] = path.points[i - 1];
    const [bx, bz] = path.points[i];
    const dx = bx - ax;
    const dz = bz - az;
    const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - ax - dx * fraction, z - az - dz * fraction);
    if (distance < best.distance) best = { s: path.distances[i - 1] + fraction * (path.distances[i] - path.distances[i - 1]), distance };
  }
  return best;
}

export function connector(incoming, outgoing, subdivisions) {
  const start = sample(incoming, incoming.length);
  const end = sample(outgoing, 0);
  const handle = Math.hypot(start.x - end.x, start.z - end.z) / 3;
  const points = [];
  for (let i = 0; i <= subdivisions; i++) {
    const t = i / subdivisions;
    const u = 1 - t;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    points.push([
      u ** 3 * start.x + b * (start.x + start.dx * handle) + c * (end.x - end.dx * handle) + t ** 3 * end.x,
      u ** 3 * start.z + b * (start.z + start.dz * handle) + c * (end.z - end.dz * handle) + t ** 3 * end.z,
    ]);
  }
  return polyline(points);
}

export function conflictInterval(path, other, clearance) {
  const count = Math.ceil(path.length / (clearance / 2));
  let start = Infinity;
  let end = -Infinity;
  for (let i = 0; i <= count; i++) {
    const s = path.length * i / count;
    const point = sample(path, s);
    if (projectToPath(other, [point.x, point.z]).distance < clearance) {
      start = Math.min(start, s);
      end = s;
    }
  }
  return { start, end };
}
