// GETIJDEN — pure afleidingen: datumbereik, ISO-week, vertrek-ranking op stroom en de
// 24-uurs stroomkromme. Client-safe. Datums zijn lokale kalenderdagen "YYYY-MM-DD"
// (Europe/Amsterdam); rekenen op datums gebeurt in UTC-middag zodat zomertijd niet stoort.
import { simulateTrip, type SimWaypoint, type SimWind } from "./tripsim";
import { DEFAULT_BOAT, type BoatProfile } from "./polar";
import { localDateISO } from "./tz";
import type { AlongSample } from "./route";
import type { DepOption } from "./tocht";

const H = 3_600_000;
const DAY = 24 * H;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => isoOf(noon(d) + n * DAY);

// ── datumbereik ─────────────────────────────────────────────────────────
// ENIGE bron voor welke dagen kiesbaar zijn. Fase 1: de dagen die de nu geladen
// stroom- en getijreeksen raken. Fase 2 sluit hier het R2-hindcastbereik aan (extra
// span in `spans`); de weekstrip hoeft dan niet te veranderen.
export type DagBereik = { eerste: string; laatste: string };
export function datumBereik(spans: ({ first: number; last: number } | null)[]): DagBereik | null {
  const s = spans.filter((x): x is { first: number; last: number } => x != null);
  if (!s.length) return null;
  return {
    eerste: localDateISO(Math.min(...s.map((x) => x.first))),
    laatste: localDateISO(Math.max(...s.map((x) => x.last))),
  };
}
export const binnenBereik = (d: string, b: DagBereik | null) => !!b && d >= b.eerste && d <= b.laatste;

// ── ISO-week (ma–zo) ────────────────────────────────────────────────────
export function maandagVan(d: string): string {
  const dow = (new Date(noon(d)).getUTCDay() + 6) % 7;   // 0 = maandag
  return addDays(d, -dow);
}
export const weekDagen = (d: string) => Array.from({ length: 7 }, (_, i) => addDays(maandagVan(d), i));
// ISO-weeknummer: de week met de donderdag erin bepaalt jaar en nummer.
export function isoWeek(d: string): number {
  const donderdag = addDays(maandagVan(d), 3);
  const jan1 = `${donderdag.slice(0, 4)}-01-01`;
  return Math.floor((noon(donderdag) - noon(jan1)) / DAY / 7) + 1;
}

// ── vertrek-ranking op stroom (zonder wind) ─────────────────────────────
// Bestaande tripsim-integratie met een motorprofiel op vaste STW: de wind speelt dan
// geen rol in de snelheid (tripsim eist wel een windvector → één 0-kn-sample).
export const RANKING_STW_KN = 5;
const RANKING_BOAT: BoatProfile = { ...DEFAULT_BOAT, archetype: "motor", motorSpeedKn: RANKING_STW_KN };

export function rankOpStroom(input: {
  dag: string; waypoints: SimWaypoint[]; along: AlongSample[][]; legDistNm?: number[];
}): { beste: DepOption | null; overige: DepOption[]; gedekt: boolean } {
  const { dag, waypoints, along, legDistNm } = input;
  if (waypoints.length < 2) return { beste: null, overige: [], gedekt: false };
  const wind: SimWind = Object.fromEntries(waypoints.map((w) => [w.location_key, [{ time: "2000-01-01T00:00", speed_kn: 0, dir_deg: 0 }]]));
  // kandidaten: elk half uur van de lokale dag
  const start = Date.parse(`${addDays(dag, -1)}T12:00:00Z`);
  const opts: DepOption[] = [];
  for (let ms = start; ms < start + 2 * DAY; ms += H / 2) {
    if (localDateISO(ms) !== dag) continue;
    const r = simulateTrip({ waypoints, departMs: ms, boat: RANKING_BOAT, wind, along, legDistNm });
    if (r.arrMs != null && !r.voorbijHorizon) opts.push({ depMs: ms, result: r });
  }
  // lokale duur-minima (plateau-tolerant) waarbij de stroom helpt (sneller dan
  // stilstaand water); de 3 kortste, ≥4u uit elkaar, chronologisch
  const minima = opts.filter((o, i, a) => (!a[i - 1] || o.result.tripMin <= a[i - 1].result.tripMin)
    && (!a[i + 1] || o.result.tripMin <= a[i + 1].result.tripMin) && o.result.effectMin < 0);
  const gekozen: DepOption[] = [];
  for (const o of [...minima].sort((a, b) => a.result.tripMin - b.result.tripMin)) {
    if (gekozen.some((g) => Math.abs(g.depMs - o.depMs) < 4 * H)) continue;
    gekozen.push(o);
    if (gekozen.length >= 3) break;
  }
  const beste = gekozen[0] ?? null;
  // gedekt = de dag heeft stroomdata (minstens één vertrek volledig binnen de reeks)
  return { beste, overige: gekozen.slice(1).sort((a, b) => a.depMs - b.depMs), gedekt: opts.length > 0 };
}

// ── stroomkromme ────────────────────────────────────────────────────────
// Segmenten van de reeks binnen [fromMs, toMs]; een null breekt de lijn (gat blijft gat).
export type KrommePunt = { ms: number; v: number };
export function krommeSegmenten(series: AlongSample[], fromMs: number, toMs: number): KrommePunt[][] {
  const out: KrommePunt[][] = [];
  let cur: KrommePunt[] = [];
  for (const p of series) {
    const ms = tms(p.t);
    if (ms < fromMs || ms > toMs) continue;
    if (p.alongKn == null) { if (cur.length) out.push(cur); cur = []; continue; }
    cur.push({ ms, v: p.alongKn });
  }
  if (cur.length) out.push(cur);
  return out;
}
// Pieken per getijfase: lokaal maximum > 0 (meestroom) of lokaal minimum < 0 (tegenstroom).
export type KrommePiek = KrommePunt & { soort: "mee" | "tegen" };
export function krommePieken(seg: KrommePunt[]): KrommePiek[] {
  return seg.flatMap((p, i): KrommePiek[] => {
    const l = seg[i - 1], r = seg[i + 1];
    if (!l || !r) return [];
    if (p.v > 0 && p.v >= l.v && p.v > r.v) return [{ ...p, soort: "mee" }];
    if (p.v < 0 && p.v <= l.v && p.v < r.v) return [{ ...p, soort: "tegen" }];
    return [];
  });
}
