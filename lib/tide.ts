// Tide layer: expected (incl. wind setup) + astronomical water level vs NAP,
// straight from RWS WaterWebservices — the new services live since 5 Dec 2025
// (host ddapi20-waterwebservices). This is a separate data layer beside the wind:
// no bias correction, no model comparison, no blend. WATHTE / Hoedanigheid NAP,
// ProcesType "verwachting" (incl. windopzet) and "astronomisch".
import type { TideData, TidePoint, TideExtreme } from "./types";

const RWS =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";

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
  vlieland: { code: "vlieland.haven", name: "Vlieland (haven)" },
  hoorn: { code: "terschelling.noordzee", name: "Terschelling (Noordzee)" },
  lauwersoog: { code: "lauwersoog.waddenzee", name: "Lauwersoog (Waddenzee)" },
  huibertgat: { code: "huibertgat", name: "Huibertgat" },
  // Noordzee-kust
  ijmuiden: { code: "ijmuiden.buitenhaven", name: "IJmuiden (buitenhaven)" },
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

export async function buildTide(key: string): Promise<TideData | null> {
  const tgt = TIDE_STATIONS[key];
  if (!tgt) return null;                          // no coupled getij point -> no tide block
  const now = Date.now();
  const begin = now - 3600000;
  const end = now + 3 * 24 * 3600000 + 3600000;  // cover the widest (3-day) window
  const [expected, astro] = await Promise.all([
    fetchSeries(tgt.code, "verwachting", begin, end),
    fetchSeries(tgt.code, "astronomisch", begin, end),
  ]);
  // HW/LW from the expected curve where it reaches; from astronomical beyond it.
  const expEnd = expected.length ? Date.parse(expected[expected.length - 1].t) : 0;
  const merged = [...extrema(expected), ...extrema(astro).filter((e) => Date.parse(e.t) > expEnd)];
  const extremes = merged.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { code: tgt.code, name: tgt.name, expected, astro, extremes };
}
