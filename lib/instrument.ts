// Reken-/afleidingslaag voor de instrumentweergave (docs/instrument-prototype.html).
// Zet de bestaande datalaag (points/weather/tide/week) om naar exact wat het
// instrument tekent — niets meer. Geen sampledata.
import type { TideData, WeatherSeries, CorrectedPoint } from "./types";
import { wxGroup } from "./weather";

const msZ = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// ── weercode → glyph-categorie (zon / zon-wolk / wolk / regen) ──
export type Glyph = "sun" | "suncloud" | "cloud" | "rain";
export function glyphOf(code: number | null): Glyph {
  switch (wxGroup(code)) {
    case "clear": return "sun";
    case "fewclouds": return "suncloud";
    case "overcast":
    case "fog": return "cloud";
    default: return "rain";   // drizzle / rain / showers / snow / thunder
  }
}

// ── weerveld (temp/druk/neerslagkans) op een timestamp, dichtstbijzijnde uur ──
export function weatherAt(w: WeatherSeries | undefined, targetMs: number):
  { temp: number | null; pressure: number | null; pop: number | null } {
  if (!w || !w.time.length) return { temp: null, pressure: null, pop: null };
  let bi = 0, best = Infinity;
  for (let i = 0; i < w.time.length; i++) {
    const d = Math.abs(msZ(w.time[i]) - targetMs);
    if (d < best) { best = d; bi = i; }
  }
  return { temp: w.temp[bi] ?? null, pressure: w.pressure[bi] ?? null, pop: w.pop[bi] ?? null };
}

// ── wind-punt op een timestamp, dichtstbijzijnde uur ──
export function pointAtMs(points: CorrectedPoint[], targetMs: number): CorrectedPoint | null {
  if (!points.length) return null;
  let bp = points[0], best = Infinity;
  for (const p of points) {
    const d = Math.abs(msZ(p.time) - targetMs);
    if (d < best) { best = d; bp = p; }
  }
  return bp;
}

// ── getij-nu: huidige waterstand, stijgend/dalend, eerstvolgende kentering ──
// `next` = het eerstvolgende getij waar het water naartoe loopt (HW als het stijgt,
// LW als het daalt), met tijd — voor het label op de getijmeter.
export type TideNow = {
  level: number; rising: boolean;
  next: { kind: "HW" | "LW"; ms: number } | null;
};
export function tideNow(tide: TideData, nowMs: number): TideNow | null {
  const s = tide.expected.length ? tide.expected : tide.astro;
  if (!s.length) return null;

  // lineair interpoleren op de verwachtingscurve
  let level = s[0].v, slope = 0;
  for (let i = 1; i < s.length; i++) {
    const a = msZ(s[i - 1].t), b = msZ(s[i].t);
    if (nowMs >= a && nowMs <= b) {
      const f = (nowMs - a) / Math.max(1, b - a);
      level = s[i - 1].v + f * (s[i].v - s[i - 1].v);
      slope = s[i].v - s[i - 1].v;
      break;
    }
    level = s[i].v; slope = s[i].v - s[i - 1].v;
  }

  // het getij waar het water naartoe loopt: stijgt het → de eerstvolgende HW,
  // daalt het → de eerstvolgende LW. Op de richting kiezen (niet simpelweg de eerste
  // extreme) houdt label en stijg/daal-pijl consistent, ook als de RWS-extrema rond
  // nu wat rommelig achter elkaar liggen.
  const wantKind: "HW" | "LW" = slope >= 0 ? "HW" : "LW";
  const nextEv = tide.extremes.find((e) => e.kind === wantKind && msZ(e.t) > nowMs);
  return {
    level, rising: slope >= 0,
    next: nextEv ? { kind: wantKind, ms: msZ(nextEv.t) } : null,
  };
}

// ── kentermomenten binnen ~26u, met een gedeelde LW→HW schaal ──
export type TideEvent = { kind: "HW" | "LW"; ms: number; v: number };
export type TideDay = { events: TideEvent[]; lo: number; hi: number };
export function tideDay(tide: TideData, nowMs: number, level?: number): TideDay | null {
  const win = tide.extremes
    .map((e) => ({ kind: e.kind, ms: msZ(e.t), v: e.v }))
    .filter((e) => e.ms > nowMs - 3600000 && e.ms < nowMs + 26 * 3600000)
    .slice(0, 4);
  if (!win.length) return null;
  const vs = win.map((e) => e.v);
  if (level != null) vs.push(level);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1) { lo -= 50; hi += 50; }         // vlakke reeks: geef de schaal lucht
  return { events: win, lo, hi };
}
