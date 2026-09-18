// Pure afleidingen voor de Tocht-planner (client-safe). Verplaatst uit app/page.tsx
// zodat data/logica los van de presentatie staat; gedrag ongewijzigd.
import type { SimResult, SimWind } from "./tripsim";
import type { RouteCurrent } from "./planner-data";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export type DepOption = { depMs: number; result: SimResult };
export type WindTLSample = { t: string; speedKn: number; dirDeg: number };
export type LegTimeline = { label: string; cur: RouteCurrent | null; distNm: number };

// Route-descriptor voor de planner-UI: het pad, per-segment stroomtijdlijnen en de
// stroom-dekkingsvlaggen. Bij 1 leg gedraagt dit zich als de oude directe route.
export type RouteMeta = {
  hasRoute: boolean; legCount: number; pathNamen: string[]; viaHavens: string[];
  viaPassage: string | null; stroomComplete: boolean; stroomPartial: boolean;
  legsZonderStroom: string[]; legTimelines: LegTimeline[];
  windSeries: WindTLSample[]; windStations: string[];
};

// Combineert de wind-per-station (SimWind) tot één route-reeks voor de windtijdlijn:
// per tijdstip de scalaire gemiddelde snelheid + vector-gemiddelde richting over de
// stations die op dat moment data hebben. De stations delen hetzelfde forecast-grid.
export function combineWindStations(wind: SimWind | null): WindTLSample[] {
  if (!wind) return [];
  const series = Object.values(wind).filter((s) => s.length);
  if (!series.length) return [];
  const times = Array.from(new Set(series.flatMap((s) => s.map((x) => x.time)))).sort();
  const maps = series.map((s) => new Map(s.map((x) => [x.time, x])));
  return times.map((t) => {
    let e = 0, n = 0, spd = 0, k = 0;
    for (const m of maps) {
      const x = m.get(t);
      if (!x) continue;
      const r = (x.dir_deg * Math.PI) / 180;
      e += Math.sin(r); n += Math.cos(r); spd += x.speed_kn; k++;
    }
    if (!k) return { t, speedKn: 0, dirDeg: 0 };
    return { t, speedKn: spd / k, dirDeg: ((Math.atan2(e / k, n / k) * 180) / Math.PI + 360) % 360 };
  });
}

// Combineert de per-leg stroomreeksen tot ÉÉN gewogen-gemiddelde tijdlijn langs de
// hele tocht. Weging = beenlengte (nm): een langer been telt zwaarder mee. Per tijdstip
// middelen we alleen de legs met echte data (>0 gewicht); een tijdstip zonder enkel
// been met data blijft een gat (alongKn null). Bij 1 been = die reeks ongewijzigd.
export function combineLegTimelines(
  legs: { cur: RouteCurrent | null; distNm: number }[],
): { series: { t: string; alongKn: number | null }[]; modelUnvalidated: boolean } {
  const withData = legs.filter((l) => l.cur && l.cur.series.length);
  if (!withData.length) return { series: [], modelUnvalidated: false };
  const modelUnvalidated = withData.some((l) => l.cur!.modelUnvalidated);

  // per been een tijd→waarde-map; de tijdstippen zijn het hetzelfde forecast-grid
  const maps = withData.map((l) => ({
    w: l.distNm > 0 ? l.distNm : 1,
    m: new Map(l.cur!.series.map((s) => [s.t, s.alongKn])),
  }));
  // vereniging van alle tijdstippen, chronologisch
  const times = Array.from(new Set(withData.flatMap((l) => l.cur!.series.map((s) => s.t)))).sort();

  const series = times.map((t) => {
    let sum = 0, wsum = 0;
    for (const { w, m } of maps) {
      const v = m.get(t);
      if (v == null) continue;
      sum += v * w; wsum += w;
    }
    return { t, alongKn: wsum > 0 ? sum / wsum : null };
  });
  return { series, modelUnvalidated };
}

// Stroom-dekkingsvenster [first,last] uit de gecombineerde leg-tijdlijnen: het
// bereik waar er échte stroomdata is (alongKn != null). Buiten dit venster toont
// de tijdlijn-strip '—' i.p.v. een verzonnen 0. Gedeeld door Tocht + Vaarplan.
export function stroomSpanOf(legTimelines: { cur: RouteCurrent | null; distNm: number }[]): { first: number; last: number } | null {
  const ms = combineLegTimelines(legTimelines).series.filter((p) => p.alongKn != null).map((p) => tms(p.t));
  return ms.length ? { first: Math.min(...ms), last: Math.max(...ms) } : null;
}

// kentering-momenten = nuldoorgangen van de gecombineerde stroom-langs-reeks.
export function kenteringTicks(legTimelines: { cur: RouteCurrent | null; distNm: number }[]): number[] {
  const s = combineLegTimelines(legTimelines).series
    .filter((p) => p.alongKn != null).map((p) => ({ m: tms(p.t), v: p.alongKn as number }));
  const out: number[] = [];
  for (let i = 1; i < s.length; i++) {
    if ((s[i - 1].v >= 0) !== (s[i].v >= 0)) {
      const a = Math.abs(s[i - 1].v), b = Math.abs(s[i].v);
      const f = a + b === 0 ? 0 : a / (a + b);
      out.push(s[i - 1].m + f * (s[i].m - s[i - 1].m));
    }
  }
  return out;
}

// beste vertrek = het DICHTSTBIJZIJNDE goede venster (niet de globale snelste, die vaak
// ver weg + in de onzeker-zone ligt). Regel: het vroegste betrouwbare (niet voorbij de
// horizon) lokale duur-minimum. Een lokaal minimum = een echt gunstig vertrekvenster;
// het vroegste = eerstvolgende. Snellere-maar-latere en onzekere vensters blijven in de
// "andere vensters"-lijst zichtbaar.
export function pickBest(depOptions: DepOption[]): DepOption | null {
  const reach = depOptions.filter((o) => o.result?.arrMs != null);
  if (!reach.length) return null;
  // alleen op onzekere (voorbij-horizon) vertrekken terugvallen als er niets zekers is
  const certain = reach.filter((o) => !o.result.voorbijHorizon);
  const base = certain.length ? certain : reach;
  // lokale duur-minima = de echte vensters (plateau-tolerant, zoals de venster-lijst)
  const windows = base.filter((o, i, a) => {
    const L = a[i - 1], R = a[i + 1];
    const lok = !L || o.result.tripMin <= L.result.tripMin;
    const rok = !R || o.result.tripMin <= R.result.tripMin;
    return lok && rok;
  });
  const pool = windows.length ? windows : base;
  return pool.reduce((b, o) => (o.depMs < b.depMs ? o : b));   // vroegste = dichtstbij
}

// andere vensters = lokale duur-minima (excl. de beste), ≥4u uit elkaar, kortste eerst
// gekozen (max 4), chronologisch teruggegeven.
export function pickVensters(sweep: DepOption[], best: DepOption | null): DepOption[] {
  const locMin = sweep.filter((o, i, a) => {
    if (o.result.arrMs == null) return false;
    const L = a[i - 1], R = a[i + 1];
    const lok = !L || L.result.arrMs == null || o.result.tripMin <= L.result.tripMin;
    const rok = !R || R.result.arrMs == null || o.result.tripMin <= R.result.tripMin;
    return lok && rok;
  });
  const picked: DepOption[] = [];
  for (const o of [...locMin].sort((a, b) => a.result.tripMin - b.result.tripMin)) {
    if (best && o.depMs === best.depMs) continue;
    if (picked.some((p) => Math.abs(p.depMs - o.depMs) < 4 * H)) continue;
    picked.push(o);
    if (picked.length >= 4) break;
  }
  return picked.sort((a, b) => a.depMs - b.depMs);
}
