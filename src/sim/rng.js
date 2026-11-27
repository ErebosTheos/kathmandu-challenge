// A seeded 32-bit Mulberry stream, using only integer arithmetic before scaling.
export function createRng(seed = 1) {
  let state = typeof seed === 'number' ? seed >>> 0 : 2166136261;
  if (typeof seed !== 'number') {
    for (const character of String(seed)) state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
  }
  const random = () => {
    let value = state = (state + 0x6D2B79F5) >>> 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.state = () => state;
  return random;
}

export function exponential(random, perSecond) {
  return perSecond > 0 ? -Math.log(1 - random()) / perSecond : Infinity;
}
