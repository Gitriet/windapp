// WIND & GETIJ: welke gecorrigeerde uren horen bij de gekozen dag. Vandaag = vanaf nu
// (de reeks begint bij het huidige uur); een andere dag = vanaf DAG_START_UUR lokaal.
// Leeg venster = de dag valt buiten de gecorrigeerde uurreeks (~3 dagen).
import type { CorrectedPoint } from "./types";
import { localDateISO, localHourDecimal } from "./tz";

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
export const DAG_START_UUR = 9;
const VENSTER_UREN = 13;   // 12 uur vooruit, beide randen inclusief

// ankerMs (vertrek of ETA van de tocht): het venster begint dan bij het uur van dat moment, ongeacht de dag.
export function dagVenster(points: CorrectedPoint[], date: string, vandaag: string, ankerMs?: number | null): CorrectedPoint[] {
  if (ankerMs != null) {
    const uur = Math.floor(ankerMs / 3_600_000) * 3_600_000;
    const i = points.findIndex((p) => tms(p.time) >= uur);
    return i < 0 ? [] : points.slice(i, i + VENSTER_UREN);
  }
  const i0 = date === vandaag ? (points.length ? 0 : -1)
    : points.findIndex((p) => localDateISO(tms(p.time)) === date && localHourDecimal(tms(p.time)) >= DAG_START_UUR);
  return i0 < 0 ? [] : points.slice(i0, i0 + VENSTER_UREN);
}

// Wind over de (resterende) uren van de dag uit de gecorrigeerde reeks.
export function dagWind(points: CorrectedPoint[], date: string): { min: number; max: number; gust: number } | null {
  const ps = points.filter((p) => localDateISO(tms(p.time)) === date);
  if (!ps.length) return null;
  return {
    min: Math.min(...ps.map((p) => p.speed_kn)),
    max: Math.max(...ps.map((p) => p.speed_kn)),
    gust: Math.max(...ps.map((p) => p.gust_kn)),
  };
}
