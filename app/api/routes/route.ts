import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getLocations } from "@/lib/serving";
import { haversineKm } from "@/lib/route";

export const dynamic = "force-dynamic";

// GET /api/routes → alle bekende havenroutes (netwerk_routes). Elk uiteinde krijgt
// het DICHTSTBIJZIJNDE weerstation (voor de wind-forecast), plus de afstand tot dat
// station — geen filter meer op station-beschikbaarheid, dus alle 19 havens komen mee.
// Per ongeordend haven-paar blijft de kortste route over. De stroom-flag is
// onafhankelijk van het weer en blijft per route staan.
export async function GET() {
  try {
    const [rowsRaw, stations] = await Promise.all([
      sql`
        SELECT r.id, r.van_haven, r.naar_haven, r.via, r.lengte_nm,
               hv.naam AS van_naam, hv.lat AS van_lat, hv.lon AS van_lon,
               hn.naam AS naar_naam, hn.lat AS naar_lat, hn.lon AS naar_lon,
               EXISTS (SELECT 1 FROM stroom_punt_forecast s WHERE s.route_id = r.id) AS stroom
        FROM netwerk_routes r
        JOIN netwerk_havens hv ON hv.id = r.van_haven
        JOIN netwerk_havens hn ON hn.id = r.naar_haven
        ORDER BY r.lengte_nm`,
      getLocations(),
    ]);
    const rows = rowsRaw as {
      id: string; van_haven: string; naar_haven: string; via: string | null; lengte_nm: number;
      van_naam: string; van_lat: number; van_lon: number;
      naar_naam: string; naar_lat: number; naar_lon: number; stroom: boolean;
    }[];

    // dichtstbijzijnde weerstation bij een haven-coördinaat (km, 1 decimaal)
    const nearest = (lat: number, lon: number) => {
      let best = stations[0], bd = Infinity;
      for (const s of stations) {
        const d = haversineKm({ lat, lon }, { lat: s.lat, lon: s.lon });
        if (d < bd) { bd = d; best = s; }
      }
      return { key: best.location_key, stationNaam: best.name, stationKm: Math.round(bd * 10) / 10 };
    };
    const havenEnd = (haven: string, naam: string, lat: number, lon: number) =>
      ({ haven, naam, lat, lon, ...nearest(lat, lon) });

    // per ongeordend haven-paar de kortste route (rows zijn al op lengte gesorteerd)
    const seen = new Set<string>();
    const routes = rows.filter((r) => {
      const key = [r.van_haven, r.naar_haven].sort().join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((r) => ({
      id: r.id, via: r.via, lengte_nm: r.lengte_nm, stroom: r.stroom,
      van: havenEnd(r.van_haven, r.van_naam, r.van_lat, r.van_lon),
      naar: havenEnd(r.naar_haven, r.naar_naam, r.naar_lat, r.naar_lon),
    }));

    return NextResponse.json({ routes });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
