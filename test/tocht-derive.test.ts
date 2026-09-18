// Afleidingen uit lib/tocht.ts + lib/verdict.ts: beste vertrek = vroegste zekere lokale
// duur-minimum, stroomgaten blijven null, en de verdict-grenzen.
import { pickBest, pickSnelste, pickVensters, combineLegTimelines, type DepOption } from "../lib/tocht";
import { verdict } from "../lib/verdict";
import type { SimResult } from "../lib/tripsim";
import type { RouteCurrent } from "../lib/planner-data";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const H = 3_600_000;
const opt = (i: number, tripMin: number, voorbijHorizon = false, reach = true): DepOption => ({
  depMs: i * H,
  result: { tripMin, arrMs: reach ? i * H + tripMin * 60000 : null, voorbijHorizon } as SimResult,
});

console.log("— pickSnelste —");
ok("kortste zekere tocht", pickSnelste([opt(0, 56), opt(7, 36), opt(19, 35), opt(40, 20, true)])?.depMs === 19 * H);
ok("onzeker alleen als niets zeker is", pickSnelste([opt(0, 60, true), opt(1, 50, true)])?.depMs === 1 * H);
ok("niets bereikbaar → null", pickSnelste([opt(0, 60, false, false)]) === null);

console.log("— pickBest —");
// duur: 60 55 70 50 65 40(onzeker) → lokale minima 55 (i=1), 50 (i=3); vroegste = i=1
const sweep = [opt(0, 60), opt(1, 55), opt(2, 70), opt(3, 50), opt(4, 65), opt(5, 40, true)];
ok("vroegste zekere lokale minimum", pickBest(sweep)?.depMs === 1 * H, String(pickBest(sweep)?.depMs));
ok("onzeker alleen als niets zeker is", pickBest([opt(0, 60, true), opt(1, 50, true)])?.depMs === 1 * H);
ok("niets bereikbaar → null", pickBest([opt(0, 60, false, false)]) === null);
const v = pickVensters(sweep, pickBest(sweep));
ok("vensters sluiten beste uit", !v.some((o) => o.depMs === 1 * H), v.map((o) => o.depMs / H).join(","));

console.log("— combineLegTimelines —");
const cur = (vals: (number | null)[]): RouteCurrent => ({
  series: vals.map((alongKn, i) => ({ t: `2026-01-01T0${i}:00:00Z`, alongKn })),
  bearingDeg: 0, analysisTime: null, modelUnvalidated: true, source: "x",
});
const c = combineLegTimelines([{ cur: cur([1, null, 2]), distNm: 3 }, { cur: cur([3, null, 0]), distNm: 1 }]);
ok("gewogen gemiddelde", c.series[0].alongKn === 1.5, String(c.series[0].alongKn));
ok("gat blijft null (nooit 0)", c.series[1].alongKn === null);

console.log("— verdict —");
ok("null wind → null", verdict(null, 10) === null);
ok("25 kn → fris", verdict(25, 0) === "fris");
ok("25,1 kn → letop", verdict(25.1, 0) === "letop");
ok("vlaag 35,1 → letop", verdict(10, 35.1) === "letop");
ok("16 kn → fris", verdict(16, 0) === "fris");
ok("vlaag 25 → fris", verdict(10, 25) === "fris");
ok("5,9 kn → licht", verdict(5.9, 0) === "licht");
ok("6 kn → goed", verdict(6, 10) === "goed");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
