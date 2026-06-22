// Course-relative (point-of-sail) logic, ported from the mockup. Wind direction
// is the direction the wind comes FROM; course is the direction sailed TO.

// The "in de wind" (close-hauled) limit is BOAT-DEPENDENT: a racing yacht points
// higher than a cruiser or a flat-bottom. 35° is a reasonable default, NOT a
// universal truth — "niet zeilbaar" is always relative to the boat, never an
// absolute fact. Per-boat configuration is a later step.
export const CLOSE_HAULED_DEG = 35;

// Cyclic direction hue: no fake jump at the 360->0 wrap.
export function dirColor(deg: number): string {
  return `hsl(${((deg + 20) % 360 + 360) % 360} 62% 60%)`;
}

// Relative wind angle off the bow, folded to 0..180.
export function relAngle(windDir: number, course: number): number {
  return Math.abs((((windDir - course) % 360) + 540) % 360 - 180);
}

export type Sail = { label: string; color: string; sailable: boolean };

export function sail(rel: number): Sail {
  if (rel < CLOSE_HAULED_DEG) return { label: "in de wind", color: "#df4b4b", sailable: false };
  if (rel < 65) return { label: "aan de wind", color: "#f4a259", sailable: true };
  if (rel < 115) return { label: "halve wind", color: "#5fd0a6", sailable: true };
  if (rel < 155) return { label: "ruimschoots", color: "#3fb6c9", sailable: true };
  return { label: "voor de wind", color: "#6f9fe0", sailable: true };
}

// Signed change in direction (degrees), folded to -180..180 (for "veering").
export function signedDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export const COURSES: [string, number | null][] = [
  ["Geen", null], ["N", 0], ["NO", 45], ["O", 90], ["ZO", 135],
  ["Z", 180], ["ZW", 225], ["W", 270], ["NW", 315],
];
