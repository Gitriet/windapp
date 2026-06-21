// Geometry + lead mapping for the route view. Passage time per waypoint follows
// from a fixed boat speed (v1: no routing/tide engine), and the lead per
// waypoint follows from how far ahead that passage is — so a far waypoint is
// read day2/day3 and automatically uses that lead's model + correction.

const KMH_PER_KN = 1.852;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function hoursToLead(hoursAhead: number): 1 | 2 | 3 {
  const lead = Math.ceil(hoursAhead / 24);
  return (Math.min(3, Math.max(1, lead)) as 1 | 2 | 3);
}

// Cumulative passage epoch-ms per waypoint: start at departure, add travel time
// (distance / boat speed) between consecutive points.
export function routePassages(
  coords: { lat: number; lon: number }[],
  departureMs: number,
  boatSpeedKn: number,
): number[] {
  const kmh = Math.max(0.1, boatSpeedKn * KMH_PER_KN);
  const out: number[] = [];
  let t = departureMs;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const km = haversineKm(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon);
      t += (km / kmh) * 3600_000;
    }
    out.push(t);
  }
  return out;
}
