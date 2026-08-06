// Trip-simulatie mét stap-uitvoer voor de Tocht-planner-grafiek.
//
// lib/passage.ts levert een ETA maar geen tussenstappen; de trip chart heeft per
// 5-min stap SOG/STW/stroom/wind nodig. Deze module rekent dezelfde integratie
// (zelfde polaire uit lib/polar.ts, zelfde koers/stroom-projectie uit lib/route.ts,
// zelfde 5-min stap en wind-over-water-aftrek als passage.ts) maar registreert elke
// stap. Zo blijft er één waarheid voor de natuurkunde en krijgt het scherm zijn reeks.
//
// De stroom komt hier binnen als scalaire component LANGS de route (kn; >0 mee, <0
// tegen) — de AlongSample-vorm die lib/route.ts al hanteert, maar PER LEG: `along[li]`
// hoort bij been `li`. Elke leg heeft een eigen koers, dus een eigen projectie; een
// directe route van één leg geeft simpelweg `[reeks]`. De aftrek wind-over-water
// gebruikt die component als vector langs de koers.
import { boatSpeed, bestVmgUpwind, bestVmgDownwind, type BoatProfile } from "./polar";
import { bearing, haversineKm } from "./route";
import type { AlongSample } from "./route";

export const STEP_MIN = 5;
export const MIN_SOG_KN = 0.3;
export const MAX_PASSAGE_HOURS = 48;
const KM_PER_NM = 1.852;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export type SimWaypoint = { location_key: string; lat: number; lon: number };
export type WindSample = { time: string; speed_kn: number; dir_deg: number };
export type SimWind = Record<string, WindSample[]>;

export type SimStep = {
  tMs: number;
  prog: number;   // nm langs de hele route
  stw: number;    // kn door het water (polaire × performance, of VMG)
  sog: number;    // kn over de grond
  cur: number;    // kn stroom langs de koers (>0 mee)
  twa: number;    // ware windhoek, 0–180
  wSpd: number;   // ware windsnelheid over de grond (kn)
  wDir: number;   // windrichting waaruit (graden)
};

export type SimResult = {
  steps: SimStep[];
  departMs: number;
  arrMs: number | null;      // null = onhaalbaar binnen de horizon / stroomdata
  tripMin: number;
  tripNcMin: number;         // zonder stroom
  effectMin: number;         // tripMin − tripNcMin (afgerond); <0 = stroom hielp
  avgSog: number;
  avgStw: number;
  kentMs: number | null;     // eerste tekenwissel van de stroom binnen de tocht
  distanceNm: number;
  unreachable: boolean;
};

// Windvector (kn, oost/noord) die WIJST WAARHEEN de wind waait.
function windToVec(speedKn: number, dirFromDeg: number) {
  const toward = rad(dirFromDeg + 180);
  return { e: Math.sin(toward) * speedKn, n: Math.cos(toward) * speedKn };
}
function windVecAt(series: WindSample[], ms: number): { e: number; n: number } | null {
  if (!series.length) return null;
  const lo = series[0], hi = series[series.length - 1];
  if (ms <= tms(lo.time)) return windToVec(lo.speed_kn, lo.dir_deg);
  if (ms >= tms(hi.time)) return windToVec(hi.speed_kn, hi.dir_deg);
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    const ta = tms(a.time), tb = tms(b.time);
    if (ms >= ta && ms <= tb) {
      const f = tb === ta ? 0 : (ms - ta) / (tb - ta);
      const va = windToVec(a.speed_kn, a.dir_deg), vb = windToVec(b.speed_kn, b.dir_deg);
      return { e: va.e + (vb.e - va.e) * f, n: va.n + (vb.n - va.n) * f };
    }
  }
  return null;
}

// Stroomcomponent langs de route (kn) op een tijdstip: lineair tussen de omliggende
// uren, maar NOOIT over een gat (null) heen.
function alongAt(series: AlongSample[], ms: number): number | null {
  const pts = series.filter((p) => p.alongKn != null).map((p) => ({ m: tms(p.t), v: p.alongKn as number }));
  if (pts.length < 1) return null;
  if (ms <= pts[0].m) return pts[0].v;
  if (ms >= pts[pts.length - 1].m) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i++) {
    if (ms >= pts[i - 1].m && ms <= pts[i].m) {
      // gat detecteren: zit er tussen deze twee samples een oorspronkelijke null?
      const gapCrossesNull = series.some((s) => {
        const sm = tms(s.t);
        return s.alongKn == null && sm > pts[i - 1].m && sm < pts[i].m;
      });
      if (gapCrossesNull) return null;
      const f = pts[i].m === pts[i - 1].m ? 0 : (ms - pts[i - 1].m) / (pts[i].m - pts[i - 1].m);
      return pts[i - 1].v + (pts[i].v - pts[i - 1].v) * f;
    }
  }
  return null;
}

function angleDiff(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Snelheid door het water uit wind-over-water + polaire (VMG bij kruis/gijp), plus de
// afgeleide TWA/TWS. `along` = stroomcomponent langs de koers (kn, >0 mee).
function throughWaterAt(
  boat: BoatProfile, wg: { e: number; n: number }, course: number, along: number,
) {
  if (boat.archetype === "motor") {
    const wsp = Math.hypot(wg.e, wg.n);
    const wdir = (deg(Math.atan2(-wg.e, -wg.n)) + 360) % 360;
    return { stw: boat.motorSpeedKn, twa: angleDiff(wdir, course), tws: wsp, wDir: wdir, wSpd: wsp };
  }
  // stroomvector langs de koers, van de windvector aftrekken → wind over water
  const cx = Math.sin(rad(course)) * along, cy = Math.cos(rad(course)) * along;
  const ww = { e: wg.e - cx, n: wg.n - cy };
  const tws = Math.hypot(ww.e, ww.n);
  const dirFrom = (deg(Math.atan2(-ww.e, -ww.n)) + 360) % 360;
  const twa = angleDiff(dirFrom, course);
  const up = bestVmgUpwind(boat, tws), dn = bestVmgDownwind(boat, tws);
  let stw: number;
  if (twa < up.twaDeg) stw = up.vmgKn;
  else if (twa > dn.twaDeg) stw = dn.vmgKn;
  else stw = boatSpeed(boat, twa, tws);
  // wind over de grond (voor het label): magnitude + richting-waaruit van wg
  const wSpd = Math.hypot(wg.e, wg.n);
  const wDir = (deg(Math.atan2(-wg.e, -wg.n)) + 360) % 360;
  return { stw, twa, tws, wDir, wSpd };
}

export function simulateTrip(input: {
  waypoints: SimWaypoint[];
  departMs: number;
  boat: BoatProfile;
  wind: SimWind;
  along: AlongSample[][];   // per leg (index = leg)
  legDistNm?: number[];     // echte beenlengte per leg (route.lengte_nm, langs de geul);
                            // zonder deze valt hij terug op de rechte-lijn haversine tussen
                            // de waypoints. Zo klopt de gevaren afstand met de getoonde afstand.
}): SimResult {
  const { waypoints, departMs, boat, wind, along, legDistNm } = input;
  const legDist = legDistNm ?? waypoints.slice(1).map((w, i) => haversineKm(waypoints[i], w) / KM_PER_NM);
  const totalNm = legDist.reduce((s, d) => s + d, 0);
  const cumBefore: number[] = [];
  legDist.reduce((acc, d, i) => { cumBefore[i] = acc; return acc + d; }, 0);

  const stepH = STEP_MIN / 60;
  const deadline = departMs + MAX_PASSAGE_HOURS * 3600_000;
  const steps: SimStep[] = [];
  let t = departMs, unreachable = false;

  outer: for (let li = 0; li < legDist.length; li++) {
    const from = waypoints[li], to = waypoints[li + 1];
    const dist = legDist[li];
    const course = bearing(from, to);
    const sA = wind[from.location_key] ?? [], sB = wind[to.location_key] ?? [];
    let progLeg = 0;
    while (progLeg < dist - 1e-9) {
      if (t > deadline) { unreachable = true; break outer; }
      const fLeg = dist > 0 ? progLeg / dist : 0;
      const va = windVecAt(sA, t), vb = windVecAt(sB, t);
      const wg = va && vb ? { e: va.e + (vb.e - va.e) * fLeg, n: va.n + (vb.n - va.n) * fLeg } : (va ?? vb);
      if (!wg) { unreachable = true; break outer; }
      const cur = alongAt(along[li] ?? [], t) ?? 0;
      const { stw, twa, wDir, wSpd } = throughWaterAt(boat, wg, course, cur);
      const sog = stw + cur;                         // cur is al langs de koers
      if (sog < MIN_SOG_KN) { unreachable = true; break outer; }
      steps.push({ tMs: t, prog: cumBefore[li] + progLeg, stw, sog, cur, twa, wSpd, wDir });
      const remain = dist - progLeg, stepNm = sog * stepH;
      if (stepNm >= remain) { t += (remain / sog) * 3600_000; progLeg = dist; }
      else { progLeg += stepNm; t += STEP_MIN * 60_000; }
    }
  }

  // eindpunt-stap (aankomst) toevoegen zodat de lijn de volle afstand raakt
  const last = steps[steps.length - 1];
  if (last) steps.push({ ...last, tMs: t, prog: totalNm });

  // zonder stroom: dezelfde integratie, along = 0
  let tNc = departMs, pNc = 0, ncUnreach = false;
  ncOuter: for (let li = 0; li < legDist.length; li++) {
    const from = waypoints[li], to = waypoints[li + 1];
    const dist = legDist[li], course = bearing(from, to);
    const sA = wind[from.location_key] ?? [], sB = wind[to.location_key] ?? [];
    let progLeg = 0;
    while (progLeg < dist - 1e-9) {
      if (tNc > deadline) { ncUnreach = true; break ncOuter; }
      const fLeg = dist > 0 ? progLeg / dist : 0;
      const va = windVecAt(sA, tNc), vb = windVecAt(sB, tNc);
      const wg = va && vb ? { e: va.e + (vb.e - va.e) * fLeg, n: va.n + (vb.n - va.n) * fLeg } : (va ?? vb);
      if (!wg) { ncUnreach = true; break ncOuter; }
      const { stw } = throughWaterAt(boat, wg, course, 0);
      if (stw < MIN_SOG_KN) { ncUnreach = true; break ncOuter; }
      const remain = dist - progLeg, stepNm = stw * stepH;
      if (stepNm >= remain) { tNc += (remain / stw) * 3600_000; progLeg = dist; }
      else { progLeg += stepNm; tNc += STEP_MIN * 60_000; }
      pNc = progLeg;
    }
  }

  const arrMs = unreachable ? null : t;
  const tripMin = (t - departMs) / 60000;
  const tripNcMin = (tNc - departMs) / 60000;
  const effectMin = Math.round(tripMin - tripNcMin);
  const body = steps.slice(0, Math.max(1, steps.length - 1));
  const avgSog = body.reduce((s, p) => s + p.sog, 0) / body.length;
  const avgStw = body.reduce((s, p) => s + p.stw, 0) / body.length;
  let kentMs: number | null = null;
  for (let i = 1; i < steps.length; i++) {
    if ((steps[i - 1].cur >= 0) !== (steps[i].cur >= 0)) {
      const a = Math.abs(steps[i - 1].cur), b = Math.abs(steps[i].cur);
      const f = a + b === 0 ? 0 : a / (a + b);
      kentMs = steps[i - 1].tMs + f * (steps[i].tMs - steps[i - 1].tMs);
      break;
    }
  }
  return {
    steps, departMs, arrMs, tripMin, tripNcMin, effectMin,
    avgSog, avgStw, kentMs, distanceNm: totalNm,
    unreachable: unreachable || ncUnreach,
  };
}
