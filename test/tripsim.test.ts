// simulateTrip: wind voor tussenpunten zonder eigen voorspelling wordt over de route
// geïnterpoleerd tussen de dichtstbijzijnde punten mét wind (eerst alleen van/naar geladen).
import { simulateTrip, type SimWind, type WindSample } from "../lib/tripsim";
import { DEFAULT_BOAT } from "../lib/polar";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const dep = Date.parse("2026-10-07T10:00:00Z");
const reeks = (kn: number): WindSample[] => Array.from({ length: 24 }, (_, i) => ({
  time: new Date(dep + i * 3_600_000).toISOString().slice(0, 16), speed_kn: kn, dir_deg: 0,
}));
// vier punten oostwaarts, wind uit het noorden (halve wind)
const wp = [0, 1, 2, 3].map((i) => ({ location_key: `p${i}`, lat: 53, lon: 4.6 + i * 0.1 }));
const sim = (wind: SimWind) => simulateTrip({ waypoints: wp, departMs: dep, boat: DEFAULT_BOAT, wind, along: [] });

const vol = sim({ p0: reeks(12), p1: reeks(12), p2: reeks(12), p3: reeks(12) });
const eind = sim({ p0: reeks(12), p3: reeks(12) });
ok("alleen eindpunten → bereikbaar", !eind.unreachable && eind.arrMs != null);
ok("gelijke wind → zelfde vaartijd als met alle punten", Math.abs(eind.tripMin - vol.tripMin) < 0.01,
  `${eind.tripMin.toFixed(2)} vs ${vol.tripMin.toFixed(2)}`);

// 6 kn bij vertrek, 18 kn bij aankomst: midden van de route ≈ 12 kn
const grad = sim({ p0: reeks(6), p3: reeks(18) });
const mid = grad.steps.find((s) => s.prog >= grad.distanceNm / 2)!;
ok("route-interpolatie halverwege ≈ gemiddelde", Math.abs(mid.wSpd - 12) < 0.5, mid.wSpd.toFixed(2));

const geen = sim({});
ok("geen wind → onbereikbaar", geen.unreachable);

if (fail) process.exit(1);
