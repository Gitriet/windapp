// Deterministic Punt insights — recap sentences + warning chips, computed purely
// from the forecast window. No language model: every string is derived from the
// numbers, so it changes with the selected tab. Thresholds live in constants.
import { compass } from "./format";
import { circMeanDeg } from "./sailing";
import { localWeekdayShort } from "./tz";
import { RECAP, WARN } from "./constants";
import type { CorrectedPoint } from "./types";

const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export type Recap = {
  knMin: number; knMax: number; gustMax: number;
  veer: "ruimt" | "krimpt" | null;   // null = no meaningful turn
  dirStart: string; dirEnd: string;
};

// mode "day" = a single calendar day; "range" = the 3-day overview.
export function buildRecap(points: CorrectedPoint[], mode: "day" | "range"): Recap | null {
  if (!points.length) return null;
  const kn = points.map((p) => p.speed_kn);
  const knMin = Math.round(Math.min(...kn));
  const knMax = Math.round(Math.max(...kn));
  const gustMax = Math.round(Math.max(...points.map((p) => p.gust_kn)));
  const edge = Math.min(RECAP.edgeHours, Math.max(1, Math.floor(points.length / 2)));
  const dStart = circMeanDeg(points.slice(0, edge).map((p) => p.dir_deg));
  const dEnd = circMeanDeg(points.slice(-edge).map((p) => p.dir_deg));
  const diff = ((dEnd - dStart + 540) % 360) - 180;
  const thr = mode === "range" ? RECAP.veer3d : RECAP.veerDay;
  const veer = diff > thr ? "ruimt" : diff < -thr ? "krimpt" : null;
  return { knMin, knMax, gustMax, veer, dirStart: compass(dStart), dirEnd: compass(dEnd) };
}

// The warning zone always shows exactly one chip so the hero never changes height:
// the heaviest danger (red before amber) when there is one, otherwise a calm
// fallback. Only hard wind is active; wind-against-current stays behind its flag.
export type Warning = { level: "amber" | "red" | "calm"; text: string };

export function buildWarning(points: CorrectedPoint[], mode: "day" | "range"): Warning {
  const calm: Warning = { level: "calm", text: "Rustig · geen waarschuwingen" };
  if (!points.length) return calm;
  const out: Warning[] = [];
  const hw = WARN.hardWind;

  if (mode === "day") {
    const knMax = Math.max(...points.map((p) => p.speed_kn));
    const gustMax = Math.max(...points.map((p) => p.gust_kn));
    if (knMax >= hw.amberKn || gustMax >= hw.amberGust) {
      const red = knMax >= hw.redKn || gustMax >= hw.redGust;
      out.push({ level: red ? "red" : "amber",
        text: `Harde wind tot ${Math.round(knMax)} kn · vlagen ${Math.round(gustMax)} kn` });
    }
  } else {
    // group the hard-wind days for the 3-day overview
    const byDay = new Map<string, CorrectedPoint[]>();
    for (const p of points) {
      const d = localWeekdayShort(ms(p.time));
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(p);
    }
    const days: string[] = [];
    let red = false;
    for (const [d, ps] of byDay) {
      const k = Math.max(...ps.map((p) => p.speed_kn));
      const g = Math.max(...ps.map((p) => p.gust_kn));
      if (k >= hw.amberKn || g >= hw.amberGust) {
        days.push(d);
        if (k >= hw.redKn || g >= hw.redGust) red = true;
      }
    }
    if (days.length) out.push({ level: red ? "red" : "amber", text: `Harde wind: ${days.join(", ")}` });
  }

  // wind-against-current: only with verified per-location current direction (see
  // constants). Off by default — we deliberately add nothing rather than guess.
  if (WARN.windVsCurrent.enabled) {
    /* requires real current data; intentionally not derived from tide slope */
  }

  out.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  return out[0] ?? calm;
}
