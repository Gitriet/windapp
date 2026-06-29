// Vaarcondities — pure, testable logic ported from windapp-prototype.html. No
// rendering, no fetching: the /varen route feeds these the real CorrectedPoint /
// TideData and the procedural stroom model. The prototype's two honesty gaps are
// encoded here as clearly-marked TEMPORARY ASSUMPTIONS (see REPORT in the route):
//   (open 1) the stream vector is the procedural model from lib/stroom.ts — there
//            is no real RWS/HP33 current vector in the app yet;
//   (open 2) the per-hour sailing judgment + the low-water passage rule are
//            heuristics; no real judgment or passage rule exists in the data.

import { signedDelta } from "./sailing";
import { localMidnight, localWeekdayShort, localDayLabel } from "./tz";
import { findPoint, currentAt } from "./stroom";
import type { CorrectedPoint, TideData } from "./types";

export type Verdict = "g" | "a" | "r"; // goed / marginaal / te veel wind

// ---- (open point 2) thresholds — TEMPORARY ASSUMPTION, not a real passage rule ----
// tooMuchKn matches the wind-strip cutoff (WINDBAR_RED_KN) for consistency.
export const SAIL = {
  marginalKn: 16, // goed below this
  tooMuchKn: 22, // te veel wind at/above this
  gustTooMuchKn: 28, // a gust this hard alone caps the hour at 'te veel wind'
  lowWaterWindowH: 1.5, // ± hours around LW counted as "tij beperkt"
};

// wind-only verdict from sustained speed + gust
export function windVerdict(speedKn: number, gustKn: number): Verdict {
  if (speedKn >= SAIL.tooMuchKn || gustKn >= SAIL.gustTooMuchKn) return "r";
  if (speedKn >= SAIL.marginalKn) return "a";
  return "g";
}

// combine wind with the low-water passage rule: a 'goed' hour near LW drops to
// 'marginaal' (tij beperkt). 'te veel wind' is never softened.
export function verdictWithTide(speedKn: number, gustKn: number, tideLimited: boolean): Verdict {
  const w = windVerdict(speedKn, gustKn);
  return w === "g" && tideLimited ? "a" : w;
}

export type HourV = { h: number; v: Verdict };

// Longest run of CONSECUTIVE 'g' hours → [startHour, endHourExclusive] in clock
// hours (so it reads as "08:00 – 14:00"), or null. Ported from the prototype's
// bestWindow, but returns real clock hours instead of array indices, since the
// real hourly series can start mid-day (today begins at "nu").
export function bestWindow(hours: HourV[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestLen = 0;
  let i = 0;
  while (i < hours.length) {
    if (hours[i].v === "g") {
      let j = i;
      while (j + 1 < hours.length && hours[j + 1].v === "g" && hours[j + 1].h === hours[j].h + 1) j++;
      const len = hours[j].h - hours[i].h + 1;
      if (len > bestLen) { bestLen = len; best = [hours[i].h, hours[j].h + 1]; }
      i = j + 1;
    } else i++;
  }
  return best;
}

// ---- wind op je koers ----
export type PoBucket = "aan de wind" | "halve wind" | "ruime wind" | "voor de wind";

// True wind angle (0..180) between where the wind comes FROM and the course.
export function twa(windFromDeg: number, course: number): number {
  return Math.abs(signedDelta(course, windFromDeg));
}

// Bucket the angle to the sailing point. Thresholds straight from the prototype.
export function poBucket(angle: number): PoBucket {
  return angle < 50 ? "aan de wind" : angle < 115 ? "halve wind" : angle < 160 ? "ruime wind" : "voor de wind";
}

// Arrow rotation per bucket (degrees), used to draw the little wind-angle vane.
export const PO_ANGLE: Record<PoBucket, number> = {
  "aan de wind": 50, "halve wind": 95, "ruime wind": 140, "voor de wind": 180,
};

// ---- stroom op je koers ----
// Project a current vector (mag in kn, toward = the bearing the water flows TO)
// onto the course: along (mee +, tegen −) and cross (stuurboord +, bakboord −).
// Ported from the prototype's curComp.
export function streamComp(mag: number, towardDeg: number, course: number): { along: number; cross: number } {
  const delta = ((towardDeg - course) * Math.PI) / 180;
  return { along: mag * Math.cos(delta), cross: mag * Math.sin(delta) };
}

export type AlongState = "mee" | "tegen" | "slap";
export type CrossState = "SB" | "BB" | "slap";
const SLACK = 0.2; // kn below which a component reads as slap water (prototype)

export function alongState(along: number): AlongState {
  return along > SLACK ? "mee" : along < -SLACK ? "tegen" : "slap";
}
export function crossState(cross: number): CrossState {
  return cross > SLACK ? "SB" : cross < -SLACK ? "BB" : "slap";
}

// ---- run-length zones on the shared hour axis ----
// Collapse consecutive same-key, consecutive-hour samples into zones spanning
// [a, b) in clock hours, keeping the peak magnitude. Drives both the wind and
// stroom strips. Items must be sorted by h ascending.
export type Zone = { a: number; b: number; key: string; peak: number };
export function zones(items: { h: number; key: string; val: number }[]): Zone[] {
  const out: Zone[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.key === it.key && it.h === last.b) {
      last.b = it.h + 1;
      last.peak = Math.max(last.peak, it.val);
    } else out.push({ a: it.h, b: it.h + 1, key: it.key, peak: it.val });
  }
  return out;
}

// wind-op-je-koers samples → zones (key = sailing-point bucket)
export function poItems(hours: { h: number; dir: number }[], course: number) {
  return hours.map(({ h, dir }) => {
    const a = twa(dir, course);
    return { h, key: poBucket(a) as string, val: a };
  });
}

// stroom-op-je-koers samples → zones (key = mee/tegen/slap or SB/BB/slap)
export function streamItems(
  hours: { h: number; mag: number; toward: number }[], course: number, which: "along" | "cross",
) {
  return hours.map(({ h, mag, toward }) => {
    const c = streamComp(mag, toward, course);
    const v = which === "along" ? c.along : c.cross;
    const key = which === "along" ? alongState(v) : crossState(v);
    return { h, key: key as string, val: Math.abs(v) };
  });
}

// ---- (open point 1) location → procedural stroom point ----
// No real RWS/HP33 current vector arrives in the app. We reuse the procedural
// model in lib/stroom.ts (it carries real flood/ebb axes per point), behind a
// clear "benadering" flag. The location→point map lives in lib/stroom.ts as the
// single source of truth; re-exported here under the name the route uses.
export { STROOM_BY_LOCATION as VAREN_STREAM } from "./stroom";

// ---- day model: reshape the real series into the prototype's per-day shape ----
const HOUR = 3_600_000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type DayHour = {
  h: number; ms: number; speed: number; gust: number; dir: number;
  verdict: Verdict; tideLimited: boolean;
  curMag: number | null; curToward: number | null; // procedural stroom (null = no point)
};
export type DayTide = { kind: "HW" | "LW"; h: number; t: string; v: number };
export type DayModel = {
  idx: number; title: string; sub: string;
  hours: DayHour[];
  tideCurve: { h: number; v: number }[]; // expected (else astro) cm NAP, this day
  tideMarks: DayTide[];
  hasExpected: boolean;
  dirStart: number; dirEnd: number;
  loKn: number; hiKn: number;
  best: [number, number] | null;
  isToday: boolean; nowH: number | null;
  h0: number; h1: number; // available hour span, for axis clipping
};

// Build up to 4 NL-local days from the corrected hourly points + tide. streamKey
// resolves the procedural stroom point (or null). Pure given Date.now().
export function buildDayModels(
  points: CorrectedPoint[], tide: TideData | null, streamKey: string | null,
): DayModel[] {
  const sp = streamKey ? findPoint(streamKey) : null;
  const lwMs = (tide?.extremes ?? []).filter((e) => e.kind === "LW").map((e) => Date.parse(e.t));
  const tideLimited = (ms: number) =>
    lwMs.some((m) => Math.abs(ms - m) <= SAIL.lowWaterWindowH * HOUR);

  // group points by local-midnight key, preserving day order
  const groups = new Map<number, CorrectedPoint[]>();
  for (const p of points) {
    const ms = Date.parse(p.time + (p.time.endsWith("Z") ? "" : "Z"));
    const key = localMidnight(ms);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const dayKeys = [...groups.keys()].sort((a, b) => a - b).slice(0, 4);
  const now = Date.now();

  return dayKeys.map((dayKey, idx) => {
    const ps = groups.get(dayKey)!;
    const hours: DayHour[] = ps.map((p) => {
      const ms = Date.parse(p.time + (p.time.endsWith("Z") ? "" : "Z"));
      const h = Math.round((ms - dayKey) / HOUR);
      const tl = tideLimited(ms);
      const cur = sp ? currentAt(sp, h) : null;
      return {
        h, ms, speed: p.speed_kn, gust: p.gust_kn, dir: p.dir_deg,
        verdict: verdictWithTide(p.speed_kn, p.gust_kn, tl), tideLimited: tl,
        curMag: cur ? cur.speed : null, curToward: cur ? cur.deg : null,
      };
    });

    const inDay = (t: string) => { const m = Date.parse(t); return m >= dayKey && m < dayKey + 24 * HOUR; };
    const exp = (tide?.expected ?? []).filter((p) => inDay(p.t));
    const ast = (tide?.astro ?? []).filter((p) => inDay(p.t));
    const src = exp.length ? exp : ast;
    const tideCurve = src.map((p) => ({ h: (Date.parse(p.t) - dayKey) / HOUR, v: p.v }));
    const tideMarks: DayTide[] = (tide?.extremes ?? [])
      .filter((e) => inDay(e.t))
      .map((e) => ({ kind: e.kind, h: (Date.parse(e.t) - dayKey) / HOUR, t: e.t, v: e.v }));

    const speeds = hours.map((x) => x.speed);
    return {
      idx,
      title: idx === 0 ? "Vandaag" : cap(localWeekdayShort(dayKey)),
      sub: localDayLabel(dayKey),
      hours,
      tideCurve, tideMarks, hasExpected: exp.length > 0,
      dirStart: hours[0]?.dir ?? 0, dirEnd: hours[hours.length - 1]?.dir ?? 0,
      loKn: speeds.length ? Math.round(Math.min(...speeds)) : 0,
      hiKn: speeds.length ? Math.round(Math.max(...speeds)) : 0,
      best: bestWindow(hours.map((x) => ({ h: x.h, v: x.verdict }))),
      isToday: idx === 0,
      nowH: idx === 0 ? (now - dayKey) / HOUR : null,
      h0: hours[0]?.h ?? 0, h1: hours[hours.length - 1]?.h ?? 23,
    };
  });
}
