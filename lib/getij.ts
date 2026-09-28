// WEER & GETIJ / VAARPLAN: pure afleidingen: datumbereik, dagstrip en de
// 24-uurs stroomkromme. Client-safe. Datums zijn lokale kalenderdagen "YYYY-MM-DD"
// (Europe/Amsterdam); rekenen op datums gebeurt in UTC-middag zodat zomertijd niet stoort.
import { localDateISO } from "./tz";
import type { AlongSample } from "./route";

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

// ── dagstrip ─────────────────────────────────────────────────────────────
// Zeven dagen vanaf `van`; `van` nooit vóór vandaag (geen oude dagen tonen).
export const stripDagen = (van: string, vandaag: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(van < vandaag ? vandaag : van, i));

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
