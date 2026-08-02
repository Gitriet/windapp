// Deterministische snapshot van de reken-kern (Stap 0c van de strip). Draait de
// volledige client-side rekenketen op BEVROREN fixtures — vaste route, vaste polaire,
// hardgecodeerde wind- en stroomreeksen, en een vaste klok als constante. GEEN Date.now,
// GEEN fetch, GEEN Math.random: twee runs moeten byte-voor-byte hetzelfde bestand geven.
//
// Doel: bewijzen dat de strip de reken-kern (passage/gates/route) niet verandert. Na
// elke stripstap opnieuw draaien; de output moet identiek blijven aan
// baseline/core-snapshot.json.
//
//   npx tsx scripts/snapshot-core.ts            -> schrijft baseline/core-snapshot.json
//   npx tsx scripts/snapshot-core.ts --check     -> vergelijkt met dat bestand (exit 1 bij verschil)
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { computePassage, type PassageWind, type PassageCurrent, type PassagePoint } from "../lib/passage";
import { evaluateGate, gateWindows, requiredDepthM, type GateDatum } from "../lib/gates";
import { classifyVenster, combineVenster, certaintyLabel, bearing, haversineKm, routeDistanceNm } from "../lib/route";
import { DEFAULT_BOAT } from "../lib/polar";
import type { TideData } from "../lib/types";

// ── bevroren fixtures ─────────────────────────────────────────────────
// Vaste klok: hardgecodeerde epoch, geen Date.now.
const DEPART_ISO = "2026-08-02T12:00:00Z";
const DEPART_MS = Date.parse(DEPART_ISO);
const H = 3_600_000;
const iso = (msOffsetH: number) => new Date(DEPART_MS + msOffsetH * H).toISOString();

// Vaste route: Marsdiep-oversteek De Kooy -> Texel.
const WAYPOINTS: PassagePoint[] = [
  { location_key: "dekooy", name: "De Kooy", lat: 52.928, lon: 4.781 },
  { location_key: "texel", name: "Texel", lat: 52.995, lon: 4.72 },
];

// Vaste windreeks per waypoint (dir_deg = richting WAARUIT de wind komt).
const WIND: PassageWind = {
  dekooy: [
    { time: iso(0), speed_kn: 12, dir_deg: 225 },
    { time: iso(2), speed_kn: 14, dir_deg: 230 },
    { time: iso(4), speed_kn: 16, dir_deg: 240 },
    { time: iso(6), speed_kn: 15, dir_deg: 250 },
  ],
  texel: [
    { time: iso(0), speed_kn: 13, dir_deg: 220 },
    { time: iso(2), speed_kn: 15, dir_deg: 235 },
    { time: iso(4), speed_kn: 17, dir_deg: 245 },
    { time: iso(6), speed_kn: 16, dir_deg: 255 },
  ],
};

// Vaste stroomreeks langs de route (u=oost, v=noord, m/s).
const CURRENT: PassageCurrent = {
  points: [
    { f: 0, lat: 52.928, lon: 4.781 },
    { f: 1, lat: 52.995, lon: 4.72 },
  ],
  times: [iso(0), iso(2), iso(4), iso(6)],
  u: [
    [0.4, 0.2, -0.2, -0.4],
    [0.5, 0.25, -0.25, -0.5],
  ],
  v: [
    [0.3, 0.15, -0.15, -0.3],
    [0.35, 0.2, -0.2, -0.35],
  ],
};

// Vaste getijcurve (cm NAP) + synthetisch referentievlak, zodat gateWindows/evaluateGate
// deterministisch een echt venster opleveren (de echte GATE_DATUMS-registry is bewust leeg).
const GATE_DATUM: GateDatum = { sillDepthChartM: 2.0, reductievlakOnderNapM: 1.0 };
const TIDE: TideData = {
  code: "fixture",
  name: "Fixture (Marsdiep)",
  expected: [
    { t: iso(0), v: -60 },
    { t: iso(1), v: 20 },
    { t: iso(2), v: 90 },
    { t: iso(3), v: 40 },
    { t: iso(4), v: -30 },
    { t: iso(5), v: -75 },
    { t: iso(6), v: -20 },
  ],
  astro: [],
  extremes: [],
};

// ── afronden (determinisme + leesbaarheid) ────────────────────────────
const r6 = (n: number | null | undefined): number | null =>
  n == null ? null : Math.round(n * 1e6) / 1e6;

// ── keten doorrekenen ─────────────────────────────────────────────────
function build() {
  // 1. ETA-integratie (passage)
  const passage = computePassage({ waypoints: WAYPOINTS, departMs: DEPART_MS, boat: DEFAULT_BOAT, wind: WIND, current: CURRENT });
  const passageOut = {
    etaArrival: passage.etaArrival ? passage.etaArrival.toISOString() : null,
    currentSource: passage.currentSource,
    legs: passage.legs.map((l) => ({
      fromId: l.fromId, toId: l.toId,
      etaArrival: l.etaArrival ? l.etaArrival.toISOString() : null,
      distanceNm: r6(l.distanceNm), tacking: l.tacking,
      currentSource: l.currentSource, avgSogKn: r6(l.avgSogKn), unreachable: l.unreachable,
    })),
  };

  // 2. Poortuitkomsten (gates) — passagetijd komt uit stap 1.
  const passageMs = passage.etaArrival ? passage.etaArrival.getTime() : null;
  const windows = gateWindows(TIDE, GATE_DATUM, requiredDepthM(DEFAULT_BOAT), DEPART_MS, DEPART_MS + 12 * H);
  const verdict = evaluateGate(TIDE, GATE_DATUM, DEFAULT_BOAT, passageMs, DEPART_MS, DEPART_MS + 12 * H);
  const gateOut = {
    requiredM: r6(verdict.requiredM),
    passageMs: verdict.passageMs, passageIso: verdict.passageMs ? new Date(verdict.passageMs).toISOString() : null,
    status: verdict.status, marginM: r6(verdict.marginM), reason: verdict.reason ?? null,
    windows: windows.map((w) => ({ fromIso: new Date(w.fromMs).toISOString(), toIso: new Date(w.toMs).toISOString() })),
  };

  // 3. Vensterclassificatie (route) — vaste rooster van (wind,gust) + poortcombinatie + zekerheid.
  const windGrid = [
    { windKn: 10, gustKn: 15 }, { windKn: 16, gustKn: 20 }, { windKn: 18, gustKn: 24 },
    { windKn: 22, gustKn: 28 }, { windKn: 25, gustKn: 34 },
  ];
  const gateStates = ["gehaald", "net-aan", "niet-gehaald", "onbekend"] as const;
  const classifyOut = windGrid.map((g) => {
    const base = classifyVenster(g.windKn, g.gustKn);
    return {
      windKn: g.windKn, gustKn: g.gustKn, base,
      combined: Object.fromEntries(gateStates.map((s) => [s, combineVenster(base, s)])),
    };
  });
  const certaintyGrid = [
    { spreadKn: 1.0, hoursAhead: 6 }, { spreadKn: 2.0, hoursAhead: 12 },
    { spreadKn: 1.0, hoursAhead: 30 }, { spreadKn: 4.0, hoursAhead: 6 }, { spreadKn: 1.0, hoursAhead: 40 },
  ];
  const certaintyOut = certaintyGrid.map((c) => ({ ...c, label: certaintyLabel(c.spreadKn, c.hoursAhead) }));

  // route-geometrie (locks bearing/haversine/routeDistance)
  const geo = {
    bearing: r6(bearing(WAYPOINTS[0], WAYPOINTS[1])),
    legKm: r6(haversineKm(WAYPOINTS[0], WAYPOINTS[1])),
    routeNm: r6(routeDistanceNm(WAYPOINTS)),
  };

  return {
    _note: "Deterministische reken-kern-snapshot (Stap 0c). Reproduceerbaar via `npx tsx scripts/snapshot-core.ts`. Bevroren fixtures, vaste klok " + DEPART_ISO + ".",
    depart: DEPART_ISO, boat: DEFAULT_BOAT,
    passage: passageOut, gate: gateOut, geo,
    classifyVenster: classifyOut, certainty: certaintyOut,
  };
}

const OUT = "baseline/core-snapshot.json";
const json = JSON.stringify(build(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!existsSync(OUT)) { console.error("geen baseline om tegen te checken: " + OUT); process.exit(1); }
  const prev = readFileSync(OUT, "utf8");
  if (prev === json) { console.log("core-snapshot identiek aan baseline ✓"); }
  else { console.error("core-snapshot WIJKT AF van baseline ✗"); process.exit(1); }
} else {
  writeFileSync(OUT, json);
  console.log("geschreven: " + OUT + " (" + json.length + " bytes)");
}
