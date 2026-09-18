// Pure afleidingen voor de Tocht-planner (client-safe). Verplaatst uit app/page.tsx
// zodat data/logica los van de presentatie staat; gedrag ongewijzigd.
import type { SimResult, SimStep, SimWind } from "./tripsim";
import type { RouteCurrent } from "./planner-data";
import type { WeatherSeries } from "./types";
import { WARN } from "./constants";
import { localHM } from "./tz";
import { dirLabel16, sailPhrase } from "./format";

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

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Wind-tegen-stroom: waar wind > 15 kn EN |stroom| > 0,5 kn EN wind en stroom
// tegengesteld (hoek tussen wind-heen en stroom-heen > 90°). De stroomrichting leiden
// we af uit het teken van de langs-koers-component (cur ≥ 0 → met de koers mee) plus de
// routekoers — de sim levert geen stroomvector, dus dit is de eerlijkste benadering.
// Vlag de tocht als een noemenswaardig deel (≥ 25%) van de stappen eraan voldoet.
export function windAgainstCurrent(steps: SimStep[], courseDeg: number): boolean {
  const body = steps.length > 1 ? steps.slice(0, -1) : steps;
  if (!body.length) return false;
  let bad = 0;
  for (const s of body) {
    if (s.wSpd <= 15 || Math.abs(s.cur) <= 0.5) continue;
    const windToward = (s.wDir + 180) % 360;
    const curToward = s.cur >= 0 ? courseDeg : (courseDeg + 180) % 360;
    if (angleDiff(windToward, curToward) > 90) bad++;
  }
  return bad / body.length >= 0.25;
}

// ── advies (ROUTE) ─────────────────────────────────────────────────────
// Vijf toestanden, puur afgeleid van het beste vertrek — geen gaan/niet-gaan-oordeel.
// Volgorde: geen venster > zonder stroom > onzeker > ga nu > vertrek later.
// "Ga nu" = het beste vertrek is het eerste kandidaat-tijdstip (≤ 30 min vanaf nu).
export type AdviesKind = "ga-nu" | "vertrek" | "onzeker" | "geen-venster" | "zonder-stroom";
export function adviesState(best: DepOption | null, firstDepMs: number | null, anyStroom: boolean): AdviesKind {
  if (!best) return "geen-venster";
  if (!anyStroom) return "zonder-stroom";
  if (best.result.voorbijHorizon) return "onzeker";
  if (firstDepMs != null && best.depMs === firstDepMs) return "ga-nu";
  return "vertrek";
}

// Stroomeffect t.o.v. dezelfde tocht bij stilstaand water (tripsim.effectMin).
export function effectLabel(effectMin: number): string {
  if (effectMin < 0) return `${-effectMin} min sneller dan bij stilstaand water`;
  if (effectMin > 0) return `${effectMin} min langzamer dan bij stilstaand water`;
  return "even snel als bij stilstaand water";
}

// Vlaag-sample van een station (uit de forecast-punten), voor de harde-wind-check.
export type GustSample = { ms: number; gustKn: number };

// LET OP voor een gekozen venster: harde wind (maximum over alle stappen van de tocht
// ≥ WARN.hardWind.amberKn, of vlaag ≥ amberGust binnen [vertrek-uur, aankomst]) en/of
// wind tegen stroom (windAgainstCurrent). Vlagen komen niet uit de sim (die kent alleen
// gemiddelde wind), dus uit de forecast-punten van de stations langs de route.
export function letOp(trip: SimResult, courseDeg: number, gusts: GustSample[]): { hardWind: boolean; windTegenStroom: boolean } {
  const maxWind = Math.max(0, ...trip.steps.map((s: SimStep) => s.wSpd));
  const from = Math.floor(trip.departMs / H) * H, to = trip.arrMs ?? trip.steps[trip.steps.length - 1]?.tMs ?? trip.departMs;
  const maxGust = Math.max(0, ...gusts.filter((g) => g.ms >= from && g.ms <= to).map((g) => g.gustKn));
  return {
    hardWind: maxWind >= WARN.hardWind.amberKn || maxGust >= WARN.hardWind.amberGust,
    windTegenStroom: windAgainstCurrent(trip.steps, courseDeg),
  };
}

// Weer op een tijdstip: het uur-sample waarin `ms` valt (uurgrid, UTC).
export function weatherAt(w: WeatherSeries | null | undefined, ms: number): { temp: number | null; code: number | null; precip: number | null } | null {
  if (!w || !w.time.length) return null;
  const hour = Math.floor(ms / H) * H;
  const i = w.time.findIndex((t) => tms(t) === hour);
  if (i < 0) return null;
  return { temp: w.temp[i], code: w.code[i], precip: w.precip[i] };
}

// Stroomverloop van één vertrek: mee/tegen bij vertrek en tot wanneer (eerste kentering
// binnen de tocht), of onzeker/zonder data. Voedt de MEE TOT-chip en de rijnotitie.
export type StroomVerloop =
  | { kind: "mee" | "tegen"; totMs: number | null }   // totMs null = de hele tocht
  | { kind: "onzeker" | "geen" };
export function stroomVerloop(r: SimResult, anyStroom: boolean): StroomVerloop {
  if (!anyStroom) return { kind: "geen" };
  if (r.voorbijHorizon) return { kind: "onzeker" };
  const mee = (r.steps[0]?.cur ?? 0) >= 0;
  const kent = r.kentMs != null && r.kentMs > r.departMs && (r.arrMs == null || r.kentMs < r.arrMs);
  return { kind: mee ? "mee" : "tegen", totMs: kent ? r.kentMs : null };
}

// Uitlegzin bij het advies: stroom + wind uit de sim-stappen van het beste vertrek.
// (Tekst ongewijzigd overgenomen uit de oude antwoord-/redenregel.)
export function adviesUitleg(b: SimResult, anyStroom: boolean): string | null {
  if (!b.arrMs || !b.steps.length) return null;
  const s0 = b.steps[0];
  const body = b.steps.length > 1 ? b.steps.slice(0, -1) : b.steps;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  let stroomStr = "";
  if (anyStroom) {
    const startMee = (s0.cur ?? 0) >= 0;
    const kent = b.kentMs && b.kentMs > b.departMs && b.kentMs < b.arrMs;
    if (kent) {
      const hrs = Math.max(1, Math.round((b.kentMs! - b.departMs) / H));
      stroomStr = startMee
        ? `meestroom eerste ${hrs} uur, kentering om ${localHM(b.kentMs!)}`
        : `tegenstroom tot kentering ${localHM(b.kentMs!)}`;
    } else {
      stroomStr = startMee ? "stroom mee vrijwel de hele tocht" : "stroom overwegend tegen";
    }
  }
  let windStr = `${dirLabel16(s0.wDir)} ${Math.round(s0.wSpd)} kn ${sailPhrase(s0.twa)}`;
  const maxSpd = Math.max(...body.map((s) => s.wSpd));
  if (maxSpd - s0.wSpd >= 4) windStr += `, bouwt op naar ${Math.round(maxSpd)} kn`;
  const sEnd = body[body.length - 1];
  const veer = sEnd ? Math.abs(((sEnd.wDir - s0.wDir + 540) % 360) - 180) : 0;
  if (sEnd && veer >= 40) windStr += `, draait naar ${dirLabel16(sEnd.wDir)}`;
  const tail = anyStroom ? "snelste combinatie van stroom en zeilhoek" : "gunstigste zeilhoek van de dag";
  return (stroomStr ? `${cap(stroomStr)}. ${windStr}` : cap(windStr)) + ` — ${tail}.`;
}
