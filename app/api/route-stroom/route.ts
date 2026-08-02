import { NextResponse } from "next/server";
import { buildStroom } from "@/lib/stroom";
import { getLocations } from "@/lib/serving";
import { bearing, midpoint, projectAlongRoute, pointAlongRoute, KN_PER_MS } from "@/lib/route";
import type { StroomData } from "@/lib/types";

export const dynamic = "force-dynamic";

// Bekende stroom-boxen. Alleen `marsdiep` is ingelezen; de box wordt gekozen als de
// route-midden binnen (bbox + marge) valt. Buiten elke box: available:false — geen
// verzonnen stroom, de UI toont dan "geen stroomdata voor deze route".
const BOXES = ["marsdiep"];
const MARGIN = 0.06;   // graden speling rond de box-bbox

// GET /api/route-stroom?keys=a,b,c&from=ISO&to=ISO[&at=ISO]
//  → along-route stroomcomponent per uur (>0 mee, <0 tegen, kn) + optioneel een
//    grof pijlenveld (bij `at`) voor de kaart.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const keys = (q.get("keys") ?? "").split(",").filter(Boolean);
    const from = q.get("from"), to = q.get("to"), at = q.get("at");
    if (keys.length < 2 || !from || !to)
      return NextResponse.json({ error: "keys (≥2), from en to verplicht" }, { status: 400 });

    const locs = await getLocations();
    const byKey = new Map(locs.map((l) => [l.location_key, l]));
    const pts = keys.map((k) => byKey.get(k)).filter(Boolean) as { lat: number; lon: number }[];
    if (pts.length < 2) return NextResponse.json({ available: false, reason: "onbekende waypoints" });

    const first = pts[0], last = pts[pts.length - 1];
    const brg = bearing(first, last);
    const mid = midpoint(first, last);

    // kies de eerste box die het route-midden dekt
    let data: StroomData | null = null;
    let box: string | null = null;
    for (const b of BOXES) {
      const d = await buildStroom(b, new Date(from).toISOString(), new Date(to).toISOString());
      if (!d) continue;
      const [loMinL, laMinL, loMaxL, laMaxL] = d.grid.bbox;
      if (mid.lon >= loMinL - MARGIN && mid.lon <= loMaxL + MARGIN &&
          mid.lat >= laMinL - MARGIN && mid.lat <= laMaxL + MARGIN) { data = d; box = b; break; }
    }
    if (!data) return NextResponse.json({ available: false, reason: "route buiten stroom-box", bearing: brg });

    const { nx, ny, lat, lon } = data.grid;
    const nearestIdx = (la: number, lo: number) => {
      let li = 0, lj = 0, bd = Infinity, bd2 = Infinity;
      for (let i = 0; i < ny; i++) { const d = Math.abs(lat[i] - la); if (d < bd) { bd = d; li = i; } }
      for (let j = 0; j < nx; j++) { const d = Math.abs(lon[j] - lo); if (d < bd2) { bd2 = d; lj = j; } }
      return { li, lj };
    };
    // sample u/v bij (la,lo): naaste cel, met kleine spiraalzoektocht als die droog (null) is
    const sample = (slice: { u: (number | null)[]; v: (number | null)[] }, la: number, lo: number) => {
      const { li, lj } = nearestIdx(la, lo);
      for (let r = 0; r <= 6; r++) {
        for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = li + di, j = lj + dj;
          if (i < 0 || i >= ny || j < 0 || j >= nx) continue;
          const u = slice.u[i * nx + j], v = slice.v[i * nx + j];
          if (u != null && v != null) return { u, v };
        }
      }
      return null;
    };

    const series = data.times.map((s) => {
      const uv = sample(s, mid.lat, mid.lon);
      return {
        t: s.valid_time,
        alongKn: uv ? Math.round(projectAlongRoute(uv.u, uv.v, brg) * 100) / 100 : null,
        magKn: uv ? Math.round(Math.hypot(uv.u, uv.v) * KN_PER_MS * 100) / 100 : null,
      };
    });

    // optioneel: grof pijlenveld voor de kaart, op de slice het dichtst bij `at`
    let arrows: { lat: number; lon: number; u: number; v: number }[] | undefined;
    if (at && data.times.length) {
      const atMs = Date.parse(at);
      let sl = data.times[0], bd = Infinity;
      for (const s of data.times) { const d = Math.abs(Date.parse(s.valid_time) - atMs); if (d < bd) { bd = d; sl = s; } }
      arrows = [];
      const stepI = Math.max(1, Math.round(ny / 9)), stepJ = Math.max(1, Math.round(nx / 9));
      for (let i = Math.floor(stepI / 2); i < ny; i += stepI)
        for (let j = Math.floor(stepJ / 2); j < nx; j += stepJ) {
          const u = sl.u[i * nx + j], v = sl.v[i * nx + j];
          if (u == null || v == null) continue;
          arrows.push({ lat: lat[i], lon: lon[j], u, v });
        }
    }

    // optioneel: stroomVECTOREN per sample-punt langs de route × per valid_time.
    // De ETA-integratie (lib/passage.ts) heeft u/v nodig op elke positie op elk moment;
    // de `series` hierboven is één scalair op het route-midden en is daarvoor te grof.
    // Droge/ontbrekende cellen blijven null — een gat wordt nooit opgevuld.
    let vectors: {
      points: { f: number; lat: number; lon: number }[];
      times: string[]; u: (number | null)[][]; v: (number | null)[][];
    } | undefined;
    const nSamples = Number(q.get("vectors") ?? 0);
    if (nSamples >= 2 && data.times.length) {
      const n = Math.min(33, Math.floor(nSamples));
      const points = Array.from({ length: n }, (_, i) => {
        const f = i / (n - 1);
        return { f, ...pointAlongRoute(pts, f) };
      });
      vectors = {
        points,
        times: data.times.map((s) => s.valid_time),
        u: points.map((p) => data.times.map((s) => sample(s, p.lat, p.lon)?.u ?? null)),
        v: points.map((p) => data.times.map((s) => sample(s, p.lat, p.lon)?.v ?? null)),
      };
    }

    return NextResponse.json({
      available: true, box, bearing: brg, model_unvalidated: true,
      analysis_time: data.analysis_time, series, arrows, vectors,
      mid, route: pts.map((p) => [p.lat, p.lon]),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
