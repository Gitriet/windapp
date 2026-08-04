import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const SOURCE = "dcsm7_harmonie_bf_f2w";

// GET /api/route-stroom?routes=R09,R10[&from=ISO&to=ISO]
//  → per gevraagde route de forecast-stroom (u/v m/s) op de netwerk_samplepunten,
//    uit de Neon-puntreeksen (stroom_punt_forecast). Grids leven in R2; deze API
//    raakt ze niet meer aan.
//
//  Contract (A-vorm): meerdere route_id's in de gevraagde VOLGORDE; per route de
//  reeksen los teruggegeven — aaneenrijgen tot een geschakelde tocht is aan de caller.
//  Herkomst reist mee: model_unvalidated + de analysis_time van de gebruikte run.
//  Geen data = null (nooit nul), tot in de JSON.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const routes = (q.get("routes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!routes.length)
      return NextResponse.json({ error: "routes (≥1 route_id) verplicht" }, { status: 400 });
    const from = q.get("from"), to = q.get("to");
    if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to))))
      return NextResponse.json({ error: "from/to moeten geldige ISO-tijden zijn" }, { status: 400 });

    // samplepunten (geometrie + volgorde) voor alle gevraagde routes
    const pts = (await sql`
      SELECT route_id, volgnr, afstand_nm, lat, lon
      FROM netwerk_samplepunten
      WHERE route_id = ANY(${routes})
      ORDER BY route_id, volgnr`) as
      { route_id: string; volgnr: number; afstand_nm: number; lat: number; lon: number }[];

    // per route de NIEUWSTE run; z'n u/v-reeks over de samplepunten (in het venster)
    const ser = (await sql`
      WITH latest AS (
        SELECT route_id, max(analysis_time) AS at
        FROM stroom_punt_forecast
        WHERE route_id = ANY(${routes})
        GROUP BY route_id
      )
      SELECT p.route_id AS route_id, p.volgnr AS volgnr,
             to_char(p.valid_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS valid_time,
             p.u AS u, p.v AS v,
             to_char(l.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS analysis_time
      FROM stroom_punt_forecast p
      JOIN latest l ON p.route_id = l.route_id AND p.analysis_time = l.at
      WHERE (${from}::timestamptz IS NULL OR p.valid_time >= ${from}::timestamptz)
        AND (${to}::timestamptz   IS NULL OR p.valid_time <= ${to}::timestamptz)
      ORDER BY p.route_id, p.valid_time, p.volgnr`) as
      { route_id: string; volgnr: number; valid_time: string;
        u: number | null; v: number | null; analysis_time: string }[];

    // punten per route (in volgorde)
    const ptsByRoute = new Map<string, typeof pts>();
    for (const p of pts) {
      let arr = ptsByRoute.get(p.route_id);
      if (!arr) ptsByRoute.set(p.route_id, (arr = []));
      arr.push(p);
    }

    // reeks: per route de gesorteerde unieke valid_times + lookup (route|volgnr|tijd)->u/v
    const timesByRoute = new Map<string, string[]>();
    const analByRoute = new Map<string, string>();
    const uv = new Map<string, { u: number | null; v: number | null }>();
    for (const r of ser) {
      analByRoute.set(r.route_id, r.analysis_time);
      let ts = timesByRoute.get(r.route_id);
      if (!ts) timesByRoute.set(r.route_id, (ts = []));
      if (ts[ts.length - 1] !== r.valid_time) ts.push(r.valid_time);   // ser is per tijd gegroepeerd
      uv.set(`${r.route_id}|${r.volgnr}|${r.valid_time}`, { u: r.u, v: r.v });
    }

    // assembleren in de GEVRAAGDE volgorde; ontbrekende data -> null
    const out = routes.map((route_id) => {
      const times = timesByRoute.get(route_id) ?? [];
      const points = (ptsByRoute.get(route_id) ?? []).map((p) => ({
        volgnr: p.volgnr, afstand_nm: p.afstand_nm, lat: p.lat, lon: p.lon,
        u: times.map((t) => uv.get(`${route_id}|${p.volgnr}|${t}`)?.u ?? null),
        v: times.map((t) => uv.get(`${route_id}|${p.volgnr}|${t}`)?.v ?? null),
      }));
      return { route_id, analysis_time: analByRoute.get(route_id) ?? null, times, points };
    });

    return NextResponse.json({
      model_unvalidated: true, units: "m/s", source: SOURCE, routes: out,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
