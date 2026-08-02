// Route-afleidingslaag (client-safe: geen DB-import). Zet de bestaande per-punt
// datalaag (forecast/tide/stroom) om naar de route-begrippen die het ontwerp tekent:
// vertrekvensters (go/tight/no), getijpoort, zekerheidslabel en stroom-langs-route.
// Alles afgeleid uit echte data; geen sampledata.
import type { Location } from "./types";
import type { GateStatus } from "./gates";

export const MS_HOUR = 3_600_000;
export const KN_PER_MS = 1.94384;

// Default-route = de Marsdiep-oversteek De Kooy → Texel: beide gekalibreerde
// windstations én Wad-getijpunten, en de stroom-box `marsdiep` dekt de kruising,
// zodat wind, getij én stroom met echte data oplichten. Alleen keys die in
// /api/locations bestaan; ontbrekende keys worden bij het laden weggefilterd.
export const DEFAULT_ROUTE_KEYS = ["dekooy", "texel"];

export type Waypoint = Location;
export type WaypointRole = "van" | "via" | "naar";
export function roleOf(index: number, total: number): WaypointRole {
  if (index === 0) return "van";
  if (index === total - 1) return "naar";
  return "via";
}

export type Trip = {
  waypointKeys: string[];   // ordered location_keys
  date: string;             // local "YYYY-MM-DD"
  time: string;             // "HH:MM"
};

// ── vensterclassificatie ──────────────────────────────────────────────
// Recreatieve drempels op de zwaarste wind langs de route (worst-case waypoint).
// Bewust centraal — nooit hardgecodeerd in een scherm.
export const VENSTER = {
  tightKn: 16, tightGust: 22,   // vanaf hier: let op
  noKn: 22, noGust: 28,         // vanaf hier: niet
};
export type VensterStatus = "go" | "tight" | "no";
export function classifyVenster(windKn: number, gustKn: number): VensterStatus {
  if (windKn >= VENSTER.noKn || gustKn >= VENSTER.noGust) return "no";
  if (windKn >= VENSTER.tightKn || gustKn >= VENSTER.tightGust) return "tight";
  return "go";
}

// De poortstatus is een extra ingrediënt náást de wind: te weinig water sluit een uur
// af, krap water haalt een groen uur terug naar oranje. Een onbekende poort (geen
// referentievlak) verandert niets — dat gat wordt apart getoond, niet weggerekend.
export function combineVenster(wind: VensterStatus, gate: GateStatus): VensterStatus {
  if (gate === "niet-gehaald") return "no";
  if (gate === "net-aan" && wind === "go") return "tight";
  return wind;
}

// ── zekerheidslabel ───────────────────────────────────────────────────
// Uit modelspreiding (band_high − band_low, kn) én horizon (u vooruit). Nooit
// een numerieke score naar de gebruiker — alleen deze drie labels.
export type Certainty = "betrouwbaar" | "wisselend" | "onzeker";
export function certaintyLabel(spreadKn: number, hoursAhead: number): Certainty {
  if (spreadKn > 3 || hoursAhead > 36) return "onzeker";
  if (spreadKn > 1.5 || hoursAhead > 24) return "wisselend";
  return "betrouwbaar";
}

// De getijpoort woont sinds fase 3 in lib/gates.ts: hij volgt uit de eigen diepgang
// en de referentievlakken van het station, niet uit een vaste waterstand-proxy.

// ── geo ───────────────────────────────────────────────────────────────
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// Peiling (bearing) van a naar b in graden (0 = noord, met de klok mee).
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), dλ = rad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export function midpoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, dφ = rad(b.lat - a.lat), dλ = rad(b.lon - a.lon);
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Stroomvector (u=oost, v=noord, m/s) geprojecteerd op de route-peiling. Levert de
// component langs de route: >0 = mee (met de vaarrichting), <0 = tegen. In knopen.
export function projectAlongRoute(u: number, v: number, routeBearingDeg: number): number {
  // eenheidsvector van de route-richting (0°=noord): (sin, cos) in (oost, noord).
  const bx = Math.sin(rad(routeBearingDeg)), by = Math.cos(rad(routeBearingDeg));
  return (u * bx + v * by) * KN_PER_MS;
}

// Totale route-lengte in zeemijl (1 nm = 1.852 km).
export function routeDistanceNm(pts: { lat: number; lon: number }[]): number {
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  return km / 1.852;
}

// Positie op fractie f (0–1) van de totale route-lengte, lineair binnen het been.
export function pointAlongRoute(
  pts: { lat: number; lon: number }[], f: number,
): { lat: number; lon: number } {
  if (pts.length === 1) return { lat: pts[0].lat, lon: pts[0].lon };
  const seg = pts.slice(1).map((p, i) => haversineKm(pts[i], p));
  const total = seg.reduce((s, d) => s + d, 0);
  if (total === 0) return { lat: pts[0].lat, lon: pts[0].lon };
  let want = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] === 0 ? 0 : Math.min(1, want / seg[i]);
      return {
        lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t,
        lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * t,
      };
    }
    want -= seg[i];
  }
  return { lat: pts[pts.length - 1].lat, lon: pts[pts.length - 1].lon };
}
