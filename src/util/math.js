export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Signed smallest difference a - b, in [-PI, PI].
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
