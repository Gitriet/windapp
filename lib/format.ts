// Small presentation helpers. Knots is the primary (and only) wind unit.
const COMPASS = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
export function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function fmtDay(iso: string): string {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
