// Direction helpers. Wind direction is the direction the wind comes FROM.

// Cyclic direction hue: no fake jump at the 360->0 wrap.
export function dirColor(deg: number): string {
  return `hsl(${((deg + 20) % 360 + 360) % 360} 62% 60%)`;
}

// Signed change in direction (degrees), folded to -180..180 (for "veering").
export function signedDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

// Circular mean of a set of bearings (degrees) — the right way to average wind
// direction, so 350° and 10° average to 0°, not 180°.
export function circMeanDeg(degs: number[]): number {
  let sx = 0, sy = 0;
  for (const d of degs) { const r = (d * Math.PI) / 180; sx += Math.cos(r); sy += Math.sin(r); }
  if (sx === 0 && sy === 0) return 0;
  return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
}
