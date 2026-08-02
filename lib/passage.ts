// Fase 2: ETA-integratie langs de route. Pure functies — geen fetches; alle data
// komt als argument binnen.
//
// Vanaf de vertrektijd stapt de integratie in stappen van 5 minuten langs de route:
// kijk wind en stroom op voor dít moment op déze positie, corrigeer de wind naar
// wind over water, lees een bootsnelheid uit de polaire, en schuif positie én klok
// samen op. Daar komt een ETA per waypoint uit.
//
// Een ETA hieruit is nooit inkt: er gaan modelstroom, modelwind en een archetype-
// polaire in. De herkomst reist mee in `currentSource` en `tacking`.
import { boatSpeed, bestVmgUpwind, bestVmgDownwind, type BoatProfile } from "./polar";
import { bearing, haversineKm, KN_PER_MS } from "./route";

export const STEP_MIN = 5;                 // integratiestap, geen instelling
export const MIN_SOG_KN = 0.3;             // daaronder: onhaalbaar, geen ETA van 40 uur
export const MAX_PASSAGE_HOURS = 48;       // voorbij de voorspelhorizon is elk getal verzonnen

const KM_PER_NM = 1.852;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export type PassagePoint = { location_key: string; name: string; lat: number; lon: number };

// Windreeks per waypoint-key, zoals /api/forecast levert (dir_deg = richting WAARUIT
// de wind komt). Alleen de velden die de integratie gebruikt.
export type WindSample = { time: string; speed_kn: number; dir_deg: number };
export type PassageWind = Record<string, WindSample[]>;

// Stroomvectoren langs de route: per sample-punt (fractie langs de route) een
// tijdreeks van u/v in m/s. null = droog/ontbrekend — een gat blijft een gat.
export type PassageCurrent = {
  points: { f: number; lat: number; lon: number }[];
  times: string[];
  u: (number | null)[][];   // [pointIdx][timeIdx]
  v: (number | null)[][];
} | null;

export type PassageLeg = {
  fromId: string;                       // location_key van het vertrekpunt
  toId: string;                         // location_key van het aankomstpunt
  etaArrival: Date | null;              // null wanneer het been onhaalbaar is
  distanceNm: number;
  tacking: boolean;                     // kruisrak (of gijprak)
  currentSource: "model" | "none";
  avgSogKn: number;
  unreachable: boolean;                 // voortgang zakte onder MIN_SOG_KN, of buiten de horizon
};

export type PassageResult = {
  legs: PassageLeg[];
  etaArrival: Date | null;              // eindbestemming
  currentSource: "model" | "partial" | "none";
};

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// Herkomst van een ETA, in gewone taal. Een ETA is nooit inkt: er gaan modelstroom,
// modelwind en een archetype-polaire in. Deze regel reist mee met élk getoond tijdstip.
export function passageOrigin(boat: BoatProfile, source: PassageResult["currentSource"]): string {
  const stroom = source === "model" ? "met stroom"
    : source === "partial" ? "deels met stroom" : "zonder stroomdata";
  return `geschat · ${boat.archetype} · ${stroom}`;
}

// ── wind ──────────────────────────────────────────────────────────────
// Windvector (kn, oost/noord) die WIJST WAARHEEN de wind waait, uit snelheid +
// richting-waaruit. Vectoren i.p.v. graden zodat interpoleren niet over 360° struikelt.
function windToVec(speedKn: number, dirFromDeg: number): { e: number; n: number } {
  const toward = rad(dirFromDeg + 180);
  return { e: Math.sin(toward) * speedKn, n: Math.cos(toward) * speedKn };
}

// Windvector op een tijdstip uit één waypoint-reeks: lineair tussen de omliggende
// uren, geklemd op de randen van de reeks.
function windVecAt(series: WindSample[], ms: number): { e: number; n: number } | null {
  if (!series.length) return null;
  let lo = series[0], hi = series[series.length - 1];
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

// ── stroom ────────────────────────────────────────────────────────────
// Stroomvector (kn) op fractie f langs de route en tijdstip ms. Dichtstbijzijnde
// sample-punt; in de tijd lineair, maar NOOIT over een gat heen: is een van de twee
// omliggende waarden null, dan is er geen stroom bekend.
function currentVecKn(cur: PassageCurrent, f: number, ms: number): { e: number; n: number } | null {
  if (!cur || !cur.points.length || !cur.times.length) return null;
  let pi = 0, bd = Infinity;
  for (let i = 0; i < cur.points.length; i++) {
    const d = Math.abs(cur.points[i].f - f);
    if (d < bd) { bd = d; pi = i; }
  }
  const ts = cur.times.map(tms);
  if (ms < ts[0] || ms > ts[ts.length - 1]) return null;
  for (let i = 1; i < ts.length; i++) {
    if (ms >= ts[i - 1] && ms <= ts[i]) {
      const ua = cur.u[pi]?.[i - 1], ub = cur.u[pi]?.[i];
      const va = cur.v[pi]?.[i - 1], vb = cur.v[pi]?.[i];
      if (ua == null || ub == null || va == null || vb == null) return null;
      const t = ts[i] === ts[i - 1] ? 0 : (ms - ts[i - 1]) / (ts[i] - ts[i - 1]);
      return { e: (ua + (ub - ua) * t) * KN_PER_MS, n: (va + (vb - va) * t) * KN_PER_MS };
    }
  }
  return null;
}

// hoekverschil tussen twee peilingen, 0–180
function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function computePassage(input: {
  waypoints: PassagePoint[];
  departMs: number;
  boat: BoatProfile;
  wind: PassageWind;
  current: PassageCurrent;
}): PassageResult {
  const { waypoints, departMs, boat, wind, current } = input;
  const legs: PassageLeg[] = [];
  if (waypoints.length < 2) return { legs, etaArrival: null, currentSource: "none" };

  // cumulatieve afstanden, om de positie als fractie van de hele route uit te drukken
  const legDist = waypoints.slice(1).map((w, i) => haversineKm(waypoints[i], w) / KM_PER_NM);
  const totalNm = legDist.reduce((s, d) => s + d, 0);
  const cumBefore: number[] = [];
  legDist.reduce((acc, d, i) => { cumBefore[i] = acc; return acc + d; }, 0);

  const stepH = STEP_MIN / 60;
  const deadline = departMs + MAX_PASSAGE_HOURS * 3600_000;
  let t = departMs;
  let stopped = false;

  for (let i = 0; i < legDist.length; i++) {
    const from = waypoints[i], to = waypoints[i + 1];
    const dist = legDist[i];
    const course = bearing(from, to);          // gewenste koers over de grond
    const seriesA = wind[from.location_key] ?? [];
    const seriesB = wind[to.location_key] ?? [];

    if (stopped) {
      legs.push({ fromId: from.location_key, toId: to.location_key, etaArrival: null,
        distanceNm: dist, tacking: false, currentSource: "none", avgSogKn: 0, unreachable: true });
      continue;
    }

    let progress = 0;                          // nm langs dit been
    let tacked = false, sawCurrent = false;
    let sogSum = 0, sogN = 0;
    let unreachable = false;

    while (progress < dist - 1e-9) {
      if (t > deadline) { unreachable = true; stopped = true; break; }

      const fLeg = dist > 0 ? progress / dist : 0;
      const fRoute = totalNm > 0 ? (cumBefore[i] + progress) / totalNm : 0;

      // wind over de grond: tussen de twee waypoints van dit been, en in de tijd
      const va = windVecAt(seriesA, t), vb = windVecAt(seriesB, t);
      const wg = va && vb ? { e: va.e + (vb.e - va.e) * fLeg, n: va.n + (vb.n - va.n) * fLeg }
        : (va ?? vb);
      if (!wg) { unreachable = true; stopped = true; break; }

      const cv = currentVecKn(current, fRoute, t);
      if (cv) sawCurrent = true;
      const cur = cv ?? { e: 0, n: 0 };

      let throughWater: number;
      if (boat.archetype === "motor") {
        throughWater = boat.motorSpeedKn;
      } else {
        // Wind over water = wind over grond − stroomvector. Niet optioneel: bij 2,5 kn
        // stroom en 12 kn wind scheelt dit makkelijk een halve bft en tien graden.
        const ww = { e: wg.e - cur.e, n: wg.n - cur.n };
        const tws = Math.hypot(ww.e, ww.n);
        const dirFrom = (deg(Math.atan2(-ww.e, -ww.n)) + 360) % 360;
        const twa = angleDiff(dirFrom, course);

        const up = bestVmgUpwind(boat, tws);
        const dn = bestVmgDownwind(boat, tws);
        if (twa < up.twaDeg) {
          throughWater = up.vmgKn;            // kruisrak: voortgang is de VMG
          tacked = true;
        } else if (twa > dn.twaDeg) {
          throughWater = dn.vmgKn;            // gijprak
          tacked = true;
        } else {
          throughWater = boatSpeed(boat, twa, tws);
        }
      }

      // snelheid over de grond langs de gewenste koers = bootvector + stroomcomponent
      const curAlong = cur.e * Math.sin(rad(course)) + cur.n * Math.cos(rad(course));
      const sog = throughWater + curAlong;

      if (sog < MIN_SOG_KN) { unreachable = true; stopped = true; break; }
      sogSum += sog; sogN++;

      const remain = dist - progress;
      const stepNm = sog * stepH;
      if (stepNm >= remain) {                  // laatste, gedeeltelijke stap: exact uitrekenen
        t += (remain / sog) * 3600_000;
        progress = dist;
      } else {
        progress += stepNm;
        t += STEP_MIN * 60_000;
      }
    }

    legs.push({
      fromId: from.location_key, toId: to.location_key,
      etaArrival: unreachable ? null : new Date(t),
      distanceNm: dist, tacking: tacked,
      currentSource: sawCurrent ? "model" : "none",
      avgSogKn: sogN ? sogSum / sogN : 0,
      unreachable,
    });
  }

  const done = legs.filter((l) => !l.unreachable);
  const withCur = done.filter((l) => l.currentSource === "model").length;
  const currentSource: PassageResult["currentSource"] =
    done.length === 0 ? "none" : withCur === done.length ? "model" : withCur === 0 ? "none" : "partial";

  const last = legs[legs.length - 1];
  return { legs, etaArrival: last && !last.unreachable ? last.etaArrival : null, currentSource };
}
