// Small presentation helpers. Knots is the primary unit; Beaufort is shown small.
const BFT_MAX_KN = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];

export function ktsToBft(kn: number): number {
  for (let b = 0; b < BFT_MAX_KN.length; b++) if (kn <= BFT_MAX_KN[b]) return b;
  return 12;
}

const COMPASS = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
export function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function fmtDay(iso: string): string {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
