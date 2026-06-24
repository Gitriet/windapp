// WMO weather-code helpers + sun/day-night helpers for the weather overlay.
// Display only — no calibration; this sits lighter than the wind in the UI.

export type WxGroup =
  | "clear" | "fewclouds" | "overcast" | "fog"
  | "drizzle" | "rain" | "showers" | "snow" | "thunder";

export function wxGroup(code: number | null): WxGroup {
  if (code == null) return "overcast";
  if (code >= 95) return "thunder";
  if (code >= 85) return "snow";
  if (code >= 80) return "showers";
  if (code >= 71) return "snow";
  if (code >= 61) return "rain";
  if (code >= 51) return "drizzle";
  if (code >= 45) return "fog";
  if (code === 3) return "overcast";
  if (code === 1 || code === 2) return "fewclouds";
  return "clear";
}

const LABELS: Record<number, string> = {
  0: "onbewolkt", 1: "licht bewolkt", 2: "half bewolkt", 3: "bewolkt",
  45: "mist", 48: "mist", 51: "motregen", 53: "motregen", 55: "motregen",
  56: "ijzel", 57: "ijzel", 61: "lichte regen", 63: "regen", 65: "zware regen",
  66: "ijzel", 67: "ijzel", 71: "lichte sneeuw", 73: "sneeuw", 75: "zware sneeuw",
  77: "sneeuwkorrels", 80: "buien", 81: "buien", 82: "zware buien",
  85: "sneeuwbuien", 86: "sneeuwbuien", 95: "onweer", 96: "onweer met hagel", 99: "onweer met hagel",
};
export function wxLabel(code: number | null): string {
  return code == null ? "—" : LABELS[code] ?? "bewolkt";
}

export const isThunder = (code: number | null) => code != null && code >= 95;

// Visibility thresholds (metres): a soft warning under 5 km, stronger under 1 km.
export const VIS_LOW = 5000;
export const VIS_VERYLOW = 1000;

// Sun events as a sorted timeline, for day/night shading.
type SunEvent = { ms: number; rise: boolean };
export function sunEvents(sunrise: string[], sunset: string[]): SunEvent[] {
  const z = (s: string) => Date.parse(s + (s.endsWith("Z") ? "" : "Z"));
  return [
    ...sunrise.map((s) => ({ ms: z(s), rise: true })),
    ...sunset.map((s) => ({ ms: z(s), rise: false })),
  ].sort((a, b) => a.ms - b.ms);
}
export function isNight(ms: number, ev: SunEvent[]): boolean {
  let last: SunEvent | null = null;
  for (const e of ev) { if (e.ms <= ms) last = e; else break; }
  if (!last) return ev.length ? ev[0].rise : false;   // before first event
  return !last.rise;                                   // after a sunset => night
}
