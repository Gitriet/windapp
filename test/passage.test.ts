// Fase 2: ETA-integratie. Synthetische wind/stroom, zodat elk acceptatiecriterium
// exact narekenbaar is.
import { computePassage, type PassageWind, type PassageCurrent, type PassagePoint } from "../lib/passage";
import { boatSpeed, DEFAULT_BOAT, type BoatProfile } from "../lib/polar";
import { haversineKm } from "../lib/route";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const BOAT: BoatProfile = { ...DEFAULT_BOAT, performance: 1 };
const T0 = Date.parse("2026-07-24T06:00:00Z");
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Twee punten pal noord van elkaar: koers over de grond = 000°.
const A: PassagePoint = { location_key: "a", name: "A", lat: 53.0, lon: 5.0 };
const B: PassagePoint = { location_key: "b", name: "B", lat: 53.2, lon: 5.0 };
const DIST_NM = haversineKm(A, B) / 1.852;

// constante wind over 48u, gelijk op beide punten
function steadyWind(speedKn: number, dirFromDeg: number): PassageWind {
  const s = Array.from({ length: 49 }, (_, h) => ({
    time: iso(T0 + h * HOUR), speed_kn: speedKn, dir_deg: dirFromDeg,
  }));
  return { a: s, b: s };
}

console.log(`route A→B = ${DIST_NM.toFixed(2)} nm, koers 000°\n`);

console.log("— 1. nul stroom + constante wind: ETA = afstand ÷ bootsnelheid —");
{
  // wind uit 090° (pal oost) op een noordelijke koers = TWA 90, halve wind
  const res = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(12, 90), current: null });
  const expectKn = boatSpeed(BOAT, 90, 12);
  const expectMs = T0 + (DIST_NM / expectKn) * HOUR;
  const got = res.legs[0].etaArrival!.getTime();
  const errPct = Math.abs(got - expectMs) / (expectMs - T0) * 100;
  ok("ETA binnen 1%", errPct < 1, `afwijking ${errPct.toFixed(4)}% (boot ${expectKn.toFixed(2)} kn)`);
  ok("geen kruisrak bij halve wind", res.legs[0].tacking === false);
  ok("currentSource none zonder stroom", res.currentSource === "none");
  ok("avgSog ≈ bootsnelheid", Math.abs(res.legs[0].avgSogKn - expectKn) < 0.01,
    `${res.legs[0].avgSogKn.toFixed(3)} vs ${expectKn.toFixed(3)}`);
}

console.log("\n— 2. stroomfase telt echt mee: andere vertrektijd → andere vaartijd —");
{
  // Halfdaagse (M2) getijstroom langs de route, periode 12.42 u.
  //
  // De opdracht noemt een verschuiving van 12 uur als proef op de som. Bij een
  // SEMIDIURNAAL getij is 12 u echter bijna precies één hele periode, dus de fase is
  // dan juist bíjna gelijk — een klein verschil is daar fysisch correct, geen bug.
  // De echte proef is een halve periode (~6.2 u): dan staat de stroom omgekeerd.
  const PERIOD_H = 12.42;
  const times = Array.from({ length: 49 }, (_, h) => iso(T0 + h * HOUR));
  const v = times.map((_, h) => Math.cos((h / PERIOD_H) * 2 * Math.PI) * 1.2);   // m/s noord
  const cur: PassageCurrent = {
    points: [{ f: 0.5, lat: 53.1, lon: 5.0 }],
    times, u: [times.map(() => 0)], v: [v],
  };
  const wind = steadyWind(12, 90);
  const sail = (offsetH: number) => {
    const dep = T0 + offsetH * HOUR;
    const r = computePassage({ waypoints: [A, B], departMs: dep, boat: BOAT, wind, current: cur });
    return { min: (r.legs[0].etaArrival!.getTime() - dep) / 60000, res: r };
  };
  const a0 = sail(0), aHalf = sail(PERIOD_H / 2), a12 = sail(12);
  console.log(`     vertrek +0u = ${a0.min.toFixed(1)} min · +${(PERIOD_H / 2).toFixed(1)}u (tegenfase) = ` +
    `${aHalf.min.toFixed(1)} min · +12u = ${a12.min.toFixed(1)} min`);
  ok("halve getijperiode verschuift de vaartijd fors", Math.abs(a0.min - aHalf.min) > 5,
    `verschil ${Math.abs(a0.min - aHalf.min).toFixed(1)} min`);
  ok("mee-stroom is sneller dan tegen-stroom", a0.min < aHalf.min,
    `${a0.min.toFixed(1)} < ${aHalf.min.toFixed(1)}`);
  ok("ook 12u verschuiven verandert de ETA (tijd wordt echt gesampled)",
    Math.abs(a0.min - a12.min) > 0.01, `verschil ${Math.abs(a0.min - a12.min).toFixed(2)} min`);
  ok("stroom is gebruikt", a0.res.currentSource === "model");
}

console.log("\n— 3. pal tegen de wind = kruisrak en langzamer dan ruimschoots —");
{
  const up = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(12, 0), current: null });
  const down = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(12, 150), current: null });
  const tUp = up.legs[0].etaArrival!.getTime() - T0;
  const tDown = down.legs[0].etaArrival!.getTime() - T0;
  console.log(`     tegen: ${(tUp / 60000).toFixed(1)} min (kruisrak=${up.legs[0].tacking}) · ` +
    `ruim: ${(tDown / 60000).toFixed(1)} min (kruisrak=${down.legs[0].tacking})`);
  ok("been pal tegen wordt kruisrak", up.legs[0].tacking === true);
  ok("ruimschoots geen kruisrak", down.legs[0].tacking === false);
  ok("kruisrak duurt aantoonbaar langer", tUp > tDown * 1.2, `${(tUp / tDown).toFixed(2)}×`);
}

console.log("\n— 4. buiten de stroom-box: none, geen foutmelding —");
{
  const res = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(12, 90), current: null });
  ok("currentSource = none", res.currentSource === "none");
  ok("wel gewoon een ETA", res.etaArrival instanceof Date);

  // stroomstructuur met uitsluitend gaten (droge cellen) telt óók als geen stroom
  const times = [iso(T0), iso(T0 + HOUR), iso(T0 + 2 * HOUR)];
  const gap: PassageCurrent = {
    points: [{ f: 0.5, lat: 53.1, lon: 5.0 }], times,
    u: [[null, null, null]], v: [[null, null, null]],
  };
  const r2 = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(12, 90), current: gap });
  ok("gat wordt niet opgevuld", r2.currentSource === "none");
  ok("gat levert nog steeds een ETA", r2.etaArrival instanceof Date);
}

console.log("\n— 5. onhaalbaar in plaats van een ETA van veertig uur —");
{
  // tegenstroom van 4 m/s (≈7.8 kn) pal zuid tegen een noordelijke koers
  const times = Array.from({ length: 49 }, (_, h) => iso(T0 + h * HOUR));
  const cur: PassageCurrent = {
    points: [{ f: 0.5, lat: 53.1, lon: 5.0 }], times,
    u: [times.map(() => 0)], v: [times.map(() => -4)],
  };
  const res = computePassage({ waypoints: [A, B], departMs: T0, boat: BOAT, wind: steadyWind(6, 90), current: cur });
  ok("been gemarkeerd als onhaalbaar", res.legs[0].unreachable === true);
  ok("geen verzonnen ETA", res.legs[0].etaArrival === null);
  ok("eind-ETA is null", res.etaArrival === null);
}

console.log("\n— 6. motor negeert de polaire —");
{
  const motor: BoatProfile = { ...BOAT, archetype: "motor", motorSpeedKn: 6 };
  const res = computePassage({ waypoints: [A, B], departMs: T0, boat: motor, wind: steadyWind(20, 0), current: null });
  const expectMs = T0 + (DIST_NM / 6) * HOUR;
  const errPct = Math.abs(res.legs[0].etaArrival!.getTime() - expectMs) / (expectMs - T0) * 100;
  ok("ETA = afstand ÷ motorsnelheid", errPct < 1, `afwijking ${errPct.toFixed(4)}%`);
  ok("motor kruist niet", res.legs[0].tacking === false);
}

console.log("\n— 7. 24 vertrekuren doorrekenen < 100 ms —");
{
  const times = Array.from({ length: 49 }, (_, h) => iso(T0 + h * HOUR));
  const cur: PassageCurrent = {
    points: [{ f: 0.25, lat: 53.05, lon: 5.0 }, { f: 0.75, lat: 53.15, lon: 5.0 }], times,
    u: [times.map(() => 0.2), times.map(() => 0.2)],
    v: [times.map((_, h) => Math.cos((h / 12.42) * 2 * Math.PI)), times.map((_, h) => Math.cos((h / 12.42) * 2 * Math.PI))],
  };
  const wind = steadyWind(12, 45);
  const t0 = performance.now();
  for (let h = 0; h < 24; h++) {
    computePassage({ waypoints: [A, B], departMs: T0 + h * HOUR, boat: BOAT, wind, current: cur });
  }
  const ms = performance.now() - t0;
  ok("24 integraties < 100 ms", ms < 100, `${ms.toFixed(1)} ms`);
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
