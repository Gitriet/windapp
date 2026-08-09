// Tide layer: expected (incl. wind setup) + astronomical water level vs NAP,
// straight from RWS WaterWebservices — the new services live since 5 Dec 2025
// (host ddapi20-waterwebservices). This is a separate data layer beside the wind:
// no bias correction, no model comparison, no blend. WATHTE / Hoedanigheid NAP,
// ProcesType "verwachting" (incl. windopzet) and "astronomisch".
import type { TideData, TidePoint, TideExtreme } from "./types";
import { sql } from "./db";

const RWS =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";

const DAY = 24 * 3600000;

// Each coastal wind station -> nearest RWS getij location carrying BOTH the
// expected and astronomical water level. Codes verified live against the RWS
// catalogue; stations absent here get no tide block (inland IJsselmeer/Markermeer
// have no tide; K13-A is offshore — see below).
//
// K13-A is deliberately omitted: the K13-A platform points (k13a, k13a.1) return
// 204 No Content for WATHTE/NAP verwachting and astronomisch — offshore platforms
// carry measured data only, no modelled tide — and the nearest point that does
// model expected+astronomical tide is a coastal station ~100 km away, not
// representative of the open sea there.
export const TIDE_STATIONS: Record<string, { code: string; name: string }> = {
  // Waddenzee
  dekooy: { code: "denhelder.marsdiep", name: "Den Helder (Marsdiep)" },
  // Texel: own getij point (Oudeschild, verified verwachting + astronomisch). Wind is
  // the calibrated Texelhors station (a real `locations` row since the EDR migration).
  texel: { code: "texel.oudeschild", name: "Texel (Oudeschild)" },
  vlieland: { code: "vlieland.haven", name: "Vlieland (haven)" },
  hoorn: { code: "terschelling.noordzee", name: "Terschelling (Noordzee)" },
  lauwersoog: { code: "lauwersoog.waddenzee", name: "Lauwersoog (Waddenzee)" },
  huibertgat: { code: "huibertgat", name: "Huibertgat" },
  // Harlingen: getij point with UNCORRECTED local wind (no calibratable station —
  // see lib/borrowed.ts). RWS code verified live for verwachting + astronomisch.
  harlingen: { code: "harlingen.waddenzee", name: "Harlingen (Waddenzee)" },
  // Noordzee-kust
  ijmuiden: { code: "ijmuiden.buitenhaven", name: "IJmuiden (buitenhaven)" },
  // Zuidwestelijke kust — now calibrated wind stations (KNMI 310/330, EDR).
  // Both RWS codes verified live to carry verwachting + astronomisch WATHTE/NAP.
  hoekvanholland: { code: "hoekvanholland", name: "Hoek van Holland" },
  vlissingen: { code: "vlissingen", name: "Vlissingen" },
};

const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "+00:00");

async function fetchSeries(
  code: string, proc: "verwachting" | "astronomisch", beginMs: number, endMs: number,
): Promise<TidePoint[]> {
  const body = {
    Locatie: { Code: code },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: { Grootheid: { Code: "WATHTE" }, Hoedanigheid: { Code: "NAP" }, ProcesType: proc },
    },
    Periode: { Begindatumtijd: fmt(beginMs), Einddatumtijd: fmt(endMs) },
  };
  const res = await fetch(RWS, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  if (!res.ok) throw new Error(`RWS ${code}/${proc}: HTTP ${res.status}`);
  const j = await res.json();
  const list = j?.WaarnemingenLijst?.[0]?.MetingenLijst ?? [];
  const out: TidePoint[] = [];
  for (const m of list) {
    const v = m?.Meetwaarde?.Waarde_Numeriek;
    if (v == null || Math.abs(v) >= 1e5) continue;   // RWS missing-value sentinel
    out.push({ t: new Date(Date.parse(m.Tijdstip)).toISOString(), v });
  }
  return out;
}

// Slope-sign extrema on the (smooth) model curve, collapsing same-kind runs to
// the most extreme point so each tide gives exactly one HW or LW.
function extrema(series: TidePoint[]): TideExtreme[] {
  const raw: TideExtreme[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].v, b = series[i].v, c = series[i + 1].v;
    if (b >= a && b > c) raw.push({ kind: "HW", t: series[i].t, v: b });
    else if (b <= a && b < c) raw.push({ kind: "LW", t: series[i].t, v: b });
  }
  const out: TideExtreme[] = [];
  for (const e of raw) {
    const last = out[out.length - 1];
    if (last && last.kind === e.kind) {
      if (e.kind === "HW" ? e.v > last.v : e.v < last.v) out[out.length - 1] = e;
    } else out.push(e);
  }
  return out;
}

// Fysiek onmogelijk dicht opeen liggende extrema zijn detectieruis (bv. De Kooy
// HW 15:50 / LW 16:00), vooral rond de expected→astro-grens waar de twee reeksen
// aan elkaar geplakt worden. Waddenzee is semidiurnaal (~12u25), dus een echte
// HW→LW ligt ~5–6u uiteen; alles onder een kwart getij is ruis. 3u is ruim onder
// het kortste echte been en ruim boven de ruis.
const MIN_EXTREMA_SPACING_MS = 3 * 3600000;

// Opschonen op een chronologisch gesorteerde reeks: voeg te dicht opeen liggende of
// gelijk-getypeerde buren samen tot de meest extreme (verste van gemiddeld niveau;
// bij gelijke amplitude de eerste). Zo blijft de reeks strikt HW/LW alterneren, ook
// als door verwijderen twee gelijke types naast elkaar komen (backward merge).
function dedupeExtrema(ex: TideExtreme[]): TideExtreme[] {
  if (ex.length < 2) return ex;
  const mid = ex.reduce((s, e) => s + e.v, 0) / ex.length;
  const amp = (e: TideExtreme) => Math.abs(e.v - mid);
  const out: TideExtreme[] = [];
  for (const e of ex) {
    let cur = e;
    while (out.length) {
      const last = out[out.length - 1];
      const tooClose = Date.parse(cur.t) - Date.parse(last.t) < MIN_EXTREMA_SPACING_MS;
      if (last.kind !== cur.kind && !tooClose) break;   // netjes gescheiden en alternerend
      cur = amp(cur) > amp(last) ? cur : last;           // grootste amplitude wint; gelijk -> eerste
      out.pop();
    }
    out.push(cur);
  }
  return out;
}

// Astronomical tide is weather-independent and valid for weeks, so we cache the
// last good series per getij code (self-provisioning table) and serve it when RWS
// is unreachable. Both cache ops are best-effort — a DB hiccup must never break
// the tide response.
let cacheEnsured = false;
async function ensureAstroCache(): Promise<void> {
  if (cacheEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS tide_astro_cache (
    code TEXT PRIMARY KEY, payload JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL)`;
  cacheEnsured = true;
}
async function writeAstroCache(code: string, astro: TidePoint[]): Promise<void> {
  try {
    await ensureAstroCache();
    await sql`INSERT INTO tide_astro_cache (code, payload, fetched_at)
      VALUES (${code}, ${JSON.stringify(astro)}, now())
      ON CONFLICT (code) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`;
  } catch { /* cache is best-effort */ }
}
async function readAstroCache(code: string): Promise<TidePoint[] | null> {
  try {
    const rows = (await sql`SELECT payload FROM tide_astro_cache WHERE code = ${code}`) as
      { payload: TidePoint[] }[];
    return rows.length ? rows[0].payload : null;
  } catch { return null; }
}

// Per-harbour tide station (keyed by haven slug), used for the arrival-harbour
// tide in the vaarplan. Unlike TIDE_STATIONS (keyed by the shared wind-station
// location_key), this resolves each harbour to its OWN nearest RWS getij station
// — so Delfzijl uses `delfzijl`, not the offshore Huibertgat wind-station key.
// Codes verified live 2026-08-08 (nearest station carrying verwachting+astronomisch,
// or — where none exists — astronomisch only, which still yields HW/LW times):
//   astronomisch-only: cadzand-bad, eemshaven.
export const HAVEN_TIDE_STATIONS: Record<string, { code: string; name: string }> = {
  "den-helder": { code: "denhelder.marsdiep", name: "Den Helder (Marsdiep)" },
  "oudeschild": { code: "texel.oudeschild", name: "Texel (Oudeschild)" },
  "lauwersoog": { code: "lauwersoog.waddenzee", name: "Lauwersoog (Waddenzee)" },
  "schiermonnikoog": { code: "schiermonnikoog.waddenzee", name: "Schiermonnikoog (Waddenzee)" },
  "vlieland": { code: "vlieland.haven", name: "Vlieland (haven)" },
  "west-terschelling": { code: "terschelling.west", name: "West-Terschelling" },
  "kornwerderzand": { code: "kornwerderzand.waddenzee.buitenhaven", name: "Kornwerderzand (buitenhaven)" },
  "harlingen": { code: "harlingen.waddenzee", name: "Harlingen (Waddenzee)" },
  "cadzand-bad": { code: "cadzand.2", name: "Cadzand" },
  "breskens": { code: "vlissingen", name: "Vlissingen" },
  "vlissingen": { code: "vlissingen", name: "Vlissingen" },
  "den-oever": { code: "denoever.waddenzee.voorhaven", name: "Den Oever (voorhaven)" },
  "eemshaven": { code: "eemshaven.waddenzee", name: "Eemshaven (Waddenzee)" },
  "delfzijl": { code: "delfzijl", name: "Delfzijl" },
  "terneuzen": { code: "terneuzen", name: "Terneuzen" },
  "roompotsluis": { code: "oosterschelde.roompotsluis.buiten", name: "Roompotsluis (buiten)" },
  "scheveningen": { code: "scheveningen", name: "Scheveningen" },
  "ijmuiden": { code: "ijmuiden.buitenhaven", name: "IJmuiden (buitenhaven)" },
  "stellendam": { code: "stellendam.buitenhaven", name: "Stellendam (buitenhaven)" },
  "nes-ameland": { code: "ameland.nes", name: "Ameland (Nes)" },
};

// Resolve a coastal wind-station key to its curated RWS getij station.
export async function buildTide(key: string): Promise<TideData | null> {
  const tgt = TIDE_STATIONS[key];
  if (!tgt) return null;                          // no coupled getij point -> no tide block
  return buildTideForStation(tgt.code, tgt.name);
}

// Resolve a haven slug to its own nearest RWS getij station (arrival-harbour tide).
export async function buildHavenTide(havenSlug: string): Promise<TideData | null> {
  const tgt = HAVEN_TIDE_STATIONS[havenSlug];
  if (!tgt) return null;                          // no coupled getij station for this harbour
  return buildTideForStation(tgt.code, tgt.name);
}

async function buildTideForStation(code: string, name: string): Promise<TideData | null> {
  const now = Date.now();
  const begin = now - 3600000;
  // the last day-tab (za) reaches into the 4th day ahead, so the visible slice +
  // extrema must cover 4 days — not just the 3-day (3d) overview window.
  const end = now + 4 * DAY + 3600000;
  const astroEnd = now + 11 * DAY;                // fetch astronomical wider so a cached copy stays useful for ~8 days into an outage

  // each series independently — one failing must not take down the other (RWS can
  // 204/error per ProcesType), and a total RWS outage falls back to the cache.
  const [expRes, astroRes] = await Promise.allSettled([
    fetchSeries(code, "verwachting", begin, end),
    fetchSeries(code, "astronomisch", begin, astroEnd),
  ]);
  const expected = expRes.status === "fulfilled" ? expRes.value : [];
  let astroFull = astroRes.status === "fulfilled" ? astroRes.value : [];
  let astroStale = false;

  if (astroFull.length) {
    await writeAstroCache(code, astroFull);   // refresh last-known on success
  } else {
    const cached = await readAstroCache(code);
    if (cached && cached.length) { astroFull = cached; astroStale = true; }
  }
  // client only needs the visible window slice (cache holds the wider series)
  const astro = astroFull.filter((p) => { const m = Date.parse(p.t); return m >= begin && m <= end; });

  if (!expected.length && !astro.length) {
    // tide station, but nothing to show (RWS down and no cache yet) — render a
    // clear "unavailable" card rather than silently dropping the whole section.
    return { code, name, expected: [], astro: [], extremes: [], unavailable: true };
  }

  // HW/LW from the expected curve where it reaches; from astronomical beyond it.
  const expEnd = expected.length ? Date.parse(expected[expected.length - 1].t) : 0;
  const merged = [...extrema(expected), ...extrema(astro).filter((e) => Date.parse(e.t) > expEnd)];
  const extremes = dedupeExtrema(merged.sort((a, b) => Date.parse(a.t) - Date.parse(b.t)));
  return {
    code, name, expected, astro, extremes,
    expectedMissing: expected.length === 0, astroStale,
  };
}
