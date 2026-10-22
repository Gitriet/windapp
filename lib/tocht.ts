// Pure afleidingen voor de Tocht-planner (client-safe). Verplaatst uit app/page.tsx
// zodat data/logica los van de presentatie staat; gedrag ongewijzigd.
import type { SimResult, SimStep } from "./tripsim";
import type { RouteCurrent, RouteHaven } from "./planner-data";
import type { WeatherSeries } from "./types";
import { localHM } from "./tz";
import { dirLabel16, fmtDuurKort, sailPhrase, windErnst, type WindErnst } from "./format";
import { gladReeks } from "./grafiek";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export type DepOption = { depMs: number; result: SimResult };
export type LegTimeline = { label: string; cur: RouteCurrent | null; distNm: number };
export type ViaHaven = { haven: RouteHaven; nmFromStart: number };

// Route-descriptor voor de UI: padnamen, doorgang, stroom-dekking en de stroom per leg.
export type RouteMeta = {
  pathNamen: string[]; viaPassage: string | null;
  stroomComplete: boolean; stroomPartial: boolean; legTimelines: LegTimeline[];
};

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

// beste vertrek = het DICHTSTBIJZIJNDE goede venster (niet de globale snelste, die vaak
// ver weg + in de onzeker-zone ligt). Regel: het vroegste betrouwbare (niet voorbij de
// horizon) lokale duur-minimum. Een lokaal minimum = een echt gunstig vertrekvenster;
// het vroegste = eerstvolgende. Snellere-maar-latere en onzekere vensters blijven in de
// "andere vensters"-lijst zichtbaar.
// Met stroomdata telt alleen een vertrek waar de stroom netto tijd wint (effectMin < 0)
// als venster; is er binnen de horizon geen, dan het snelste vertrek (minst slecht, zie
// adviesState "minst-slecht").
export function pickBest(depOptions: DepOption[]): DepOption | null {
  const reach = depOptions.filter((o) => o.result?.arrMs != null);
  if (!reach.length) return null;
  // alleen op onzekere (voorbij-horizon) vertrekken terugvallen als er niets zekers is
  const certain = reach.filter((o) => !o.result.voorbijHorizon);
  const base = certain.length ? certain : reach;
  const metStroom = base.some((o) => (o.result.effectMin ?? 0) !== 0);
  const gunstig = (o: DepOption) => !metStroom || o.result.effectMin < 0;
  if (!base.some(gunstig)) return base.reduce((b, o) => (o.result.tripMin < b.result.tripMin ? o : b));
  // lokale duur-minima = de echte vensters (plateau-tolerant, zoals de venster-lijst)
  const windows = base.filter((o, i, a) => {
    const L = a[i - 1], R = a[i + 1];
    const lok = !L || o.result.tripMin <= L.result.tripMin;
    const rok = !R || o.result.tripMin <= R.result.tripMin;
    return lok && rok && gunstig(o);
  });
  const pool = windows.length ? windows : base.filter(gunstig);
  return pool.reduce((b, o) => (o.depMs < b.depMs ? o : b));   // vroegste = dichtstbij
}

// Melding "nog steeds gunstig": VENSTER_MARGE_MIN minuten voor en na het beste vertrek, binnen
// de gerekende vertrekken (niet vóór het eerste kandidaat-tijdstip).
export const VENSTER_MARGE_MIN = 30;
export function vertrekVenster(depOptions: DepOption[], best: DepOption | null): { vanMs: number; totMs: number } | null {
  if (!best || !depOptions.length) return null;
  const m = VENSTER_MARGE_MIN * 60_000;
  return { vanMs: Math.max(best.depMs - m, depOptions[0].depMs), totMs: Math.min(best.depMs + m, depOptions[depOptions.length - 1].depMs) };
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

// snelste = kortste tocht onder de zekere vertrekken; onzeker alleen als niets zeker is.
export function pickSnelste(opts: DepOption[]): DepOption | null {
  const reach = opts.filter((o) => o.result?.arrMs != null);
  const certain = reach.filter((o) => !o.result.voorbijHorizon);
  const pool = certain.length ? certain : reach;
  return pool.length ? pool.reduce((b, o) => (o.result.tripMin < b.result.tripMin ? o : b)) : null;
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
// Zes toestanden, puur afgeleid van het beste vertrek — geen gaan/niet-gaan-oordeel.
// Volgorde: geen venster > zonder stroom > onzeker > minst slecht > ga nu > vertrek later.
// "Ga nu" = het beste vertrek is het eerste kandidaat-tijdstip (≤ 30 min vanaf nu).
// "Minst slecht" = ook het beste vertrek heeft de stroom per saldo tegen (pickBest viel
// terug op het snelste vertrek).
export type AdviesKind = "ga-nu" | "vertrek" | "onzeker" | "geen-venster" | "zonder-stroom" | "minst-slecht";
export function adviesState(best: DepOption | null, firstDepMs: number | null, anyStroom: boolean): AdviesKind {
  if (!best) return "geen-venster";
  if (!anyStroom) return "zonder-stroom";
  if (best.result.voorbijHorizon) return "onzeker";
  if (best.result.effectMin > 0) return "minst-slecht";
  if (firstDepMs != null && best.depMs === firstDepMs) return "ga-nu";
  return "vertrek";
}

// Stroomeffect t.o.v. dezelfde tocht bij stilstaand water (tripsim.effectMin).
export function effectLabel(effectMin: number): string {
  if (effectMin < 0) return `${fmtDuurKort(-effectMin)} sneller dan bij stilstaand water`;
  if (effectMin > 0) return `stroom tegen, ${fmtDuurKort(effectMin)} langer dan bij stilstaand water`;
  return "even snel als bij stilstaand water";
}

// Vlaag-sample van een station (uit de forecast-punten), voor de harde-wind-check.
export type GustSample = { ms: number; gustKn: number; key?: string; prog?: number };   // key = station; prog = positie langs de route (nm) bij een positiegebonden sample
// Station + positie langs de route (nm vanaf vertrek), zodat vlagen net als de sim-wind per positie
// tussen de stations geïnterpoleerd kunnen worden.
export type StationPos = { key: string; nm: number };

// Vlag van de boot langs de tocht: per sim-stap (positie + tijd) lineair tussen de twee
// omliggende stations (en per station tussen de uurwaarden). Zo telt een vlaag bij IJmuiden
// niet mee terwijl je nog bij Den Helder vaart — hetzelfde principe als de sim-wind.
export function gustsOnTrip(trip: SimResult, stations: StationPos[], gusts: GustSample[]): GustSample[] {
  const perKey = new Map<string, GustSample[]>();
  for (const g of gusts) if (g.key != null) perKey.set(g.key, [...(perKey.get(g.key) ?? []), g]);
  perKey.forEach((a) => a.sort((x, y) => x.ms - y.ms));
  const pos = stations.filter((p) => perKey.has(p.key)).sort((a, b) => a.nm - b.nm);
  if (!pos.length) return [];
  const at = (key: string, ms: number) => {
    const a = perKey.get(key)!;
    if (ms <= a[0].ms) return a[0].gustKn;
    const i = a.findIndex((g) => g.ms >= ms);
    if (i < 0) return a[a.length - 1].gustKn;
    const f = a[i].ms === a[i - 1].ms ? 0 : (ms - a[i - 1].ms) / (a[i].ms - a[i - 1].ms);
    return a[i - 1].gustKn + f * (a[i].gustKn - a[i - 1].gustKn);
  };
  const body = trip.steps.length > 1 ? trip.steps.slice(0, -1) : trip.steps;
  return body.map((st) => {
    const lo = [...pos].reverse().find((p) => p.nm <= st.prog) ?? pos[0];
    const hi = pos.find((p) => p.nm >= st.prog) ?? pos[pos.length - 1];
    const f = hi.nm > lo.nm ? Math.min(1, Math.max(0, (st.prog - lo.nm) / (hi.nm - lo.nm))) : 0;
    return { ms: st.tMs, gustKn: at(lo.key, st.tMs) * (1 - f) + at(hi.key, st.tMs) * f, prog: st.prog };
  });
}

export type WaveSample = { ms: number; m: number; key: string };          // golfhoogte (m) per station

// LET OP voor een gekozen venster: harde wind (ernst volgens windErnst(): de hardste stap van de
// tocht en de hardste vlaag binnen [vertrek-uur, aankomst]) en/of wind tegen stroom
// (windAgainstCurrent). Vlagen komen niet uit de sim (die kent alleen gemiddelde wind), dus uit
// de positiegebonden forecast-punten van de stations langs de route (gustsOnTrip).
export function letOp(trip: SimResult, courseDeg: number, gusts: GustSample[]): {
  hardWind: boolean; ernst: WindErnst; ernstWind: WindErnst; ernstVlaag: WindErnst; minVlaagKn: number; maxVlaagKn: number; windTegenStroom: boolean;
} {
  const maxWind = Math.max(0, ...trip.steps.map((s: SimStep) => s.wSpd));
  const from = Math.floor(trip.departMs / H) * H, to = trip.arrMs ?? trip.steps[trip.steps.length - 1]?.tMs ?? trip.departMs;
  const inTocht = gusts.filter((g) => g.ms >= from && g.ms <= to).map((g) => g.gustKn);
  const maxGust = Math.max(0, ...inTocht), minGust = inTocht.length ? Math.min(...inTocht) : 0;
  const ernst = windErnst(maxWind, maxGust);
  // wind en vlagen apart: een rustige wind met harde vlagen is een andere waarschuwing dan harde wind
  return {
    hardWind: ernst !== "rustig", ernst, ernstWind: windErnst(maxWind, null), ernstVlaag: windErnst(null, maxGust),
    minVlaagKn: minGust, maxVlaagKn: maxGust, windTegenStroom: windAgainstCurrent(trip.steps, courseDeg),
  };
}

// Wind en vlagen onderweg, vanaf het vertrekmoment: richting (gemiddeld) en bereik over de hele
// tocht. Eén bron voor de ROUTE-windchip en de WEER-hero; vlagen uit gustsOnTrip (positiegebonden).
export type WindOnderweg = {
  vanMs: number; totMs: number; dir: number;
  windMin: number; windMax: number; vlaagMin: number | null; vlaagMax: number | null;
};
export function windOnderweg(trip: SimResult, gusts: GustSample[]): WindOnderweg | null {
  const body = trip.steps.length > 1 ? trip.steps.slice(0, -1) : trip.steps;
  if (!body.length) return null;
  const e = body.reduce((a, q) => a + Math.sin((q.wDir * Math.PI) / 180), 0), n = body.reduce((a, q) => a + Math.cos((q.wDir * Math.PI) / 180), 0);
  const w = body.map((q) => q.wSpd);
  const g = gusts.filter((x) => x.ms >= trip.departMs && x.ms <= (trip.arrMs ?? trip.departMs)).map((x) => x.gustKn);
  return {
    vanMs: trip.departMs, totMs: trip.arrMs ?? trip.departMs, dir: ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360,
    windMin: Math.min(...w), windMax: Math.max(...w),
    vlaagMin: g.length ? Math.min(...g) : null, vlaagMax: g.length ? Math.max(...g) : null,
  };
}

// Wind en vlagen per klokuur langs de tocht, zoals de boot ze tegenkomt (sim-wind en positiegebonden vlagen),
// in de vorm van een uurpunt voor de uurstrook. Het eerste en laatste uur zijn deeluren van de tocht.
export type UurWeer = { code: number | null; temp: number | null; precip: number | null };
export type UurPunt = { time: string; speed_kn: number; gust_kn: number; dir_deg: number; weer?: UurWeer };
// weerOp: weer op een plek (nm vanaf vertrek) en tijdstip; zonder weerOp geen weer per uur.
export type WeerOp = (nm: number, ms: number) => UurWeer | null;
export function windPerUur(trip: SimResult, gusts: GustSample[], weerOp?: WeerOp): UurPunt[] {
  const body = trip.steps.length > 1 ? trip.steps.slice(0, -1) : trip.steps;
  const perUur = new Map<number, SimStep[]>();
  for (const st of body) {
    const u = Math.floor(st.tMs / H) * H;
    perUur.set(u, [...(perUur.get(u) ?? []), st]);
  }
  return [...perUur.entries()].sort((a, b) => a[0] - b[0]).map(([u, ss]) => {
    const e = ss.reduce((a, q) => a + Math.sin((q.wDir * Math.PI) / 180), 0), n = ss.reduce((a, q) => a + Math.cos((q.wDir * Math.PI) / 180), 0);
    const g = gusts.filter((x) => Math.floor(x.ms / H) * H === u).map((x) => x.gustKn);
    const speed = ss.reduce((a, q) => a + q.wSpd, 0) / ss.length;
    const weer = weerOp?.(ss.reduce((a, q) => a + q.prog, 0) / ss.length, u + H / 2) ?? undefined;
    return {
      time: new Date(u).toISOString().slice(0, 16), speed_kn: speed, gust_kn: g.length ? Math.max(...g) : speed,
      dir_deg: ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360, ...(weer ? { weer } : {}),
    };
  });
}

// Lange tocht: meerdere uren samenvoegen tot hooguit `max` staven zodat de uurstrook leesbaar blijft. Per blok
// van k opeenvolgende uren: gemiddelde wind, hardste vlaag, gemiddelde richting (vectorgemiddelde); de tijd is
// het begin van het blok. Tot `max` uren blijft alles zoals het is (k = 1).
export function bundelUren(pts: UurPunt[], max: number): { pts: UurPunt[]; uurPerStaaf: number } {
  const k = Math.max(1, Math.ceil(pts.length / max));
  if (k === 1) return { pts, uurPerStaaf: 1 };
  const uit: UurPunt[] = [];
  for (let i = 0; i < pts.length; i += k) {
    const g = pts.slice(i, i + k);
    const e = g.reduce((a, q) => a + Math.sin((q.dir_deg * Math.PI) / 180), 0), n = g.reduce((a, q) => a + Math.cos((q.dir_deg * Math.PI) / 180), 0);
    // weer van een blok: het natste uur bepaalt het icoon (regen telt zwaarder dan zon), temperatuur gemiddeld
    const wx = g.flatMap((q) => (q.weer ? [q.weer] : []));
    const nat = wx.reduce<UurWeer | null>((m, w) => (m == null || (w.precip ?? 0) > (m.precip ?? 0) ? w : m), null);
    const temps = wx.flatMap((w) => (w.temp != null ? [w.temp] : []));
    uit.push({
      ...(nat ? { weer: { code: nat.code, precip: Math.max(...wx.map((w) => w.precip ?? 0)), temp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null } } : {}),
      time: g[0].time,
      speed_kn: g.reduce((a, q) => a + q.speed_kn, 0) / g.length,
      gust_kn: Math.max(...g.map((q) => q.gust_kn)),
      dir_deg: ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360,
    });
  }
  return { pts: uit, uurPerStaaf: k };
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

// Windverloop langs de tocht (afgevlakt, voor de lijn) plus de hardste echte sim-stap. Eén bron
// voor de windgrafiek (VAARPLAN) én de uitlegzin (ROUTE): beide noemen dezelfde piek, niet
// de afgevlakte (die zou een korte piek lager en later tonen).
export function windPiek(steps: SimStep[], depMs: number, arrMs: number | null): { gl: { ms: number; v: number }[]; top: { ms: number; v: number } | null } {
  const eind = arrMs ?? depMs;
  const pts = steps.filter((q) => q.tMs >= depMs && q.tMs <= eind);
  if (pts.length < 2) return { gl: [], top: null };
  const gl = gladReeks(pts.map((q) => ({ ms: q.tMs, v: q.wSpd })), depMs, Math.max(eind, depMs + 1));
  const top = pts.reduce((m, q) => (q.wSpd > m.wSpd ? q : m), pts[0]);
  return { gl, top: { ms: top.tMs, v: top.wSpd } };
}

// Uitlegzin: stroom + wind uit de sim-stappen van een vertrek. Voor het beste vertrek met
// de slotzin waarom het het beste is; voor een ander gekozen vertrek zonder die claim.
export function adviesUitleg(b: SimResult, anyStroom: boolean, isBeste = true, horizonUur?: number): string | null {
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
  // zin 1: wind bij vertrek en zeilhoek; zin 2: hoe de wind onderweg verloopt
  const start = `wind uit ${dirLabel16(s0.wDir)} ${Math.round(s0.wSpd)}\u00A0kn, je vaart ${sailPhrase(s0.twa)}`;
  const piek = windPiek(b.steps, b.departMs, b.arrMs).top;
  const verschil = (d: number) => Math.abs(((d - s0.wDir + 540) % 360) - 180);
  const sDraai = body.find((s) => verschil(s.wDir) >= 40);
  const op = piek && piek.v - s0.wSpd >= 4 ? `loopt de wind op tot ${Math.round(piek.v)}\u00A0kn rond ${localHM(piek.ms)}` : null;
  const draai = sDraai ? `draait ${op ? "hij" : "de wind"} rond ${localHM(sDraai.tMs)} naar ${dirLabel16(sDraai.wDir)}` : null;
  const verloop = [op, draai].filter(Boolean).join(" en ") || "blijft de wind vrijwel gelijk";
  const windStr = `${cap(start)}. Onderweg ${verloop}`;
  const zin = stroomStr ? `${cap(stroomStr)}. ${windStr}` : windStr;
  if (!isBeste) return `${zin}.`;
  // slotzin alleen als de stroom per saldo tegen is: dan is er geen vertrek met meestroom
  return anyStroom && b.effectMin > 0 ? `${zin}. Geen vertrek met meestroom binnen ${horizonUur ?? 48} uur.` : `${zin}.`;
}

// ── etappes (VAARPLAN) ──────────────────────────────────────────────────
// Per leg: de stroom langs de koers in K segmenten (gemiddelde sim-cur per segment),
// de positie van de eerste kentering binnen de leg (0–1), en de wind/vlaag onderweg.
// Alles uit de al berekende SimResult + vlaag-samples; geen nieuwe fysica.
export type EtappeLeg = { label: string; distNm: number; keys: string[]; stroom: boolean };   // keys = weerstations langs de etappe
export type Etappe = {
  label: string; distNm: number; stroom: boolean;
  segmenten: number[];            // kn langs de koers per segment (>0 mee)
  kenteringFrac: number | null;   // 0–1 langs de leg, of null
  windDir: number | null; windKn: number | null; vlaagKn: number | null;
  golfM: number | null;          // hoogste golf onderweg (stations langs de etappe), null = geen golfdata
  vanMs: number | null;          // wanneer de boot aan deze leg begint
};
export function etappes(trip: SimResult, legs: EtappeLeg[], gusts: GustSample[], waves: WaveSample[] = []): Etappe[] {
  const body = trip.steps.length > 1 ? trip.steps.slice(0, -1) : trip.steps;
  let start = 0;
  return legs.map((leg) => {
    const van = start, tot = start + leg.distNm;
    start = tot;
    const st = body.filter((s) => s.prog >= van - 1e-9 && s.prog < tot - 1e-9);
    const K = Math.max(3, Math.min(8, Math.round(leg.distNm)));
    const segmenten = Array.from({ length: K }, (_, k) => {
      const a = van + (k * leg.distNm) / K, b = van + ((k + 1) * leg.distNm) / K;
      const inSeg = st.filter((s) => s.prog >= a && s.prog < b);
      if (inSeg.length) return inSeg.reduce((sum, s) => sum + s.cur, 0) / inSeg.length;
      // korte segmenten zonder eigen stap: dichtstbijzijnde stap
      const mid = (a + b) / 2;
      const near = st.reduce<SimStep | null>((n, s) => (!n || Math.abs(s.prog - mid) < Math.abs(n.prog - mid) ? s : n), null);
      return near?.cur ?? 0;
    });
    let kenteringFrac: number | null = null;
    for (let i = 1; i < st.length && leg.stroom; i++) {
      if ((st[i - 1].cur >= 0) !== (st[i].cur >= 0)) { kenteringFrac = (st[i].prog - van) / leg.distNm; break; }
    }
    let e = 0, n = 0, spd = 0;
    for (const s of st) { const r = (s.wDir * Math.PI) / 180; e += Math.sin(r); n += Math.cos(r); spd += s.wSpd; }
    const windDir = st.length ? ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360 : null;
    const windKn = st.length ? spd / st.length : null;
    const t0 = st.length ? Math.floor(st[0].tMs / H) * H : 0, t1 = st.length ? st[st.length - 1].tMs : 0;
    const vl = gusts.filter((g) => g.ms >= t0 && g.ms <= t1
      && (g.prog != null ? g.prog >= van - 1e-9 && g.prog <= tot + 1e-9 : g.key != null && leg.keys.includes(g.key))).map((g) => g.gustKn);
    const gf = waves.filter((w) => leg.keys.includes(w.key) && w.ms >= t0 && w.ms <= t1).map((w) => w.m);
    return {
      label: leg.label, distNm: leg.distNm, stroom: leg.stroom, segmenten: leg.stroom ? segmenten : [],
      kenteringFrac, windDir, windKn, vlaagKn: vl.length ? Math.max(...vl) : null, golfM: gf.length ? Math.max(...gf) : null,
      vanMs: st[0]?.tMs ?? null,
    };
  });
}

// Titel van de advieskaart. GA NU wordt "BESTE VERTREK HH:MM" zodra het venster een LET OP
// heeft (harde wind of wind tegen stroom) — de keuze van het venster verandert niet.
export function adviesTitel(kind: AdviesKind, depMs: number | null, letOpActief: boolean): string {
  const hm = depMs != null ? localHM(depMs) : "";
  switch (kind) {
    case "ga-nu": return letOpActief ? `BESTE VERTREK ${hm}` : "GA NU";
    case "vertrek": case "minst-slecht": return `VERTREK ${hm}`;
    case "onzeker": return "ONZEKER";
    case "geen-venster": return "GEEN VENSTER";
    case "zonder-stroom": return "ZONDER STROOM";
  }
}
