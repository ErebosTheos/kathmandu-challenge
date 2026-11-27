import { polyline } from './geometry.js';
import { TOOLS } from './params.js';

export const TUNNEL_SPEED = 13.5; // Assumed free-flow speed in metres per second.

export function tunnelRoutes(network) {
  return Object.fromEntries(TOOLS.gradeSeparation.corridor.map(([arm, turn]) => {
    const entry = network.arms[arm].incoming.at(-1);
    const movement = entry.moves[turn].variants.at(-1);
    const path = polyline([...entry.path.points, ...movement.path.points, ...movement.to.path.points]);
    return [arm, path];
  }));
}
