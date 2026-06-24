// Direction helpers. Wind direction is the direction the wind comes FROM.

// Cyclic direction hue: no fake jump at the 360->0 wrap.
export function dirColor(deg: number): string {
  return `hsl(${((deg + 20) % 360 + 360) % 360} 62% 60%)`;
}

// Signed change in direction (degrees), folded to -180..180 (for "veering").
export function signedDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}
