// Client-fetch + transforms: haalt de bestaande API's op en vormt ze om naar de
// inputs die de Tocht-planner en de sim verwachten. Geen nieuwe endpoints — puur
// aansluiten op /api/forecast, /api/tide, /api/week, /api/route-stroom.
import { bearing, projectAlongRoute, type AlongSample } from "./route";
import type { WindSample } from "./tripsim";
import type { CorrectedPoint, WeatherSeries, WeekDay, TideData, Location } from "./types";
import type { HavenInfo } from "./haven-info";

// Standaard-havenroute: Den Helder → Oudeschild over het Marsdiep (R09).
export const DEFAULT_ROUTE_ID = "R09";

export type ForecastResponse = { location: Location; points: CorrectedPoint[]; weather: WeatherSeries };
export type WeekResponse = { location: Location; days: WeekDay[] };

// ── bekende havenroutes (uit /api/routes) ─────────────────────────────
// `key` = dichtstbijzijnde weerstation (bron van de wind); stationNaam/stationKm
// vertellen eerlijk welk station en hoe ver.
export type RouteHaven = {
  haven: string; naam: string; lat: number; lon: number;
  key: string; stationNaam: string; stationKm: number;
  havenInfo: HavenInfo | null;
};
export type RouteInfo = {
  id: string; via: string | null; lengte_nm: number; stroom: boolean;
  van: RouteHaven; naar: RouteHaven;
};

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export const fetchRoutes = () => getJSON<{ routes: RouteInfo[] }>("/api/routes").then((d) => d.routes);

export const fetchForecast = (key: string) => getJSON<ForecastResponse>(`/api/forecast/${key}`);
export const fetchWeek = (key: string) => getJSON<WeekResponse>(`/api/week/${key}`);
export const fetchTide = (key: string) => getJSON<TideData | { tide: null }>(`/api/tide/${key}`);

// Windreeks per waypoint zoals de sim die leest (richting = waaruit de wind komt).
export function toWindSamples(points: CorrectedPoint[]): WindSample[] {
  return points.map((p) => ({ time: p.time, speed_kn: p.speed_kn, dir_deg: p.dir_deg }));
}

// ── route-stroom → stroom langs de route ──────────────────────────────
type RouteStroomPoint = { volgnr: number; afstand_nm: number; lat: number; lon: number; u: (number | null)[]; v: (number | null)[] };
type RouteStroomRoute = { route_id: string; analysis_time: string | null; times: string[]; points: RouteStroomPoint[] };
export type RouteStroomResponse = { model_unvalidated: boolean; units: string; source: string; routes: RouteStroomRoute[] };

export type RouteCurrent = {
  series: AlongSample[];        // scalaire stroom langs de route (kn; >0 mee)
  bearingDeg: number;           // route-peiling waarop geprojecteerd is
  analysisTime: string | null;
  modelUnvalidated: boolean;
  source: string;
};

// desiredBearingDeg: grove peiling van de GEKOZEN vaarrichting (van→naar), enkel om
// om te bepalen of de keuze de opslagrichting van de route omkeert. De projectie zelf
// blijft op de ECHTE route-geometrie (samplepunt-peiling), zodat de magnitude klopt;
// bij een omgekeerde keuze draait alleen het teken mee/tegen om.
export async function fetchRouteCurrent(routeId = DEFAULT_ROUTE_ID, desiredBearingDeg?: number): Promise<RouteCurrent | null> {
  const d = await getJSON<RouteStroomResponse>(`/api/route-stroom?routes=${routeId}`);
  const r = d.routes.find((x) => x.route_id === routeId);
  if (!r || !r.points.length || !r.times.length) return null;

  // route-peiling uit het eerste en laatste samplepunt (route loopt van volgnr 0 → n)
  const first = r.points[0], last = r.points[r.points.length - 1];
  const storeBrg = bearing({ lat: first.lat, lon: first.lon }, { lat: last.lat, lon: last.lon });
  // omgekeerde keuze? (> 90° tussen opslag- en gekozen richting) → teken draaien
  const reversed = desiredBearingDeg != null &&
    Math.abs(((storeBrg - desiredBearingDeg + 540) % 360) - 180) > 90;
  const sign = reversed ? -1 : 1;

  // per tijdstip: gemiddelde stroomcomponent langs de route over de niet-lege punten.
  // Een tijdstip zonder enkele bruikbare cel → alongKn null (blijft een gat).
  const series: AlongSample[] = r.times.map((t, ti) => {
    const vals: number[] = [];
    for (const p of r.points) {
      const u = p.u[ti], v = p.v[ti];
      if (u == null || v == null) continue;
      vals.push(projectAlongRoute(u, v, storeBrg) * sign);
    }
    return { t, alongKn: vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null };
  });

  return {
    series, bearingDeg: reversed ? (storeBrg + 180) % 360 : storeBrg,
    analysisTime: r.analysis_time, modelUnvalidated: d.model_unvalidated, source: d.source,
  };
}
