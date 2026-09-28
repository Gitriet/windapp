// WEER & GETIJ: welke gecorrigeerde uren horen bij de gekozen dag. Vandaag = vanaf nu
// (de reeks begint bij het huidige uur); een andere dag = vanaf DAG_START_UUR lokaal.
// Leeg venster = de dag valt buiten de gecorrigeerde uurreeks (~3 dagen).
import type { CorrectedPoint } from "./types";
import { localDateISO, localHourDecimal } from "./tz";

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
export const DAG_START_UUR = 9;
const VENSTER_UREN = 13;   // 12 uur vooruit, beide randen inclusief

export function dagVenster(points: CorrectedPoint[], date: string, vandaag: string): CorrectedPoint[] {
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
