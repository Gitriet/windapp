// Advies-afleidingen (lib/tocht.ts): de vijf toestanden, de LET OP-drempels uit
// WARN.hardWind, het stroomeffect-label en het weer-uur-sample.
import { adviesState, letOp, effectLabel, weatherAt, stroomVerloop, type DepOption } from "../lib/tocht";
import { WARN } from "../lib/constants";
import type { SimResult, SimStep } from "../lib/tripsim";
import type { WeatherSeries } from "../lib/types";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 18, 10, 0);
const best = (depMs: number, voorbijHorizon = false): DepOption =>
  ({ depMs, result: { voorbijHorizon } as SimResult });

console.log("— adviesState —");
ok("geen beste → geen-venster", adviesState(null, T0, true) === "geen-venster");
ok("geen stroom → zonder-stroom", adviesState(best(T0), T0, false) === "zonder-stroom");
ok("onzeker gaat voor ga-nu", adviesState(best(T0, true), T0, true) === "onzeker");
ok("eerste slot → ga-nu", adviesState(best(T0), T0, true) === "ga-nu");
ok("later slot → vertrek", adviesState(best(T0 + H), T0, true) === "vertrek");

console.log("— letOp —");
const step = (tMs: number, wSpd: number, cur = 0, wDir = 0): SimStep =>
  ({ tMs, prog: 0, stw: 5, sog: 5, cur, twa: 90, wSpd, wDir });
const trip = (wSpds: number[], cur = 0, wDir = 0): SimResult => {
  const steps = wSpds.map((w, i) => step(T0 + i * 15 * 60000, w, cur, wDir));
  return { steps, departMs: T0, arrMs: steps[steps.length - 1].tMs } as SimResult;
};
const { amberKn, amberGust } = WARN.hardWind;
ok("onder de drempel → geen harde wind", !letOp(trip([10, amberKn - 0.1, 12]), 0, []).hardWind);
ok("wind = amberKn ergens in de tocht → harde wind", letOp(trip([10, amberKn, 12]), 0, []).hardWind);
ok("vlaag ≥ amberGust binnen de tocht → harde wind", letOp(trip([10, 12]), 0, [{ ms: T0, gustKn: amberGust }]).hardWind);
ok("vlaag buiten de tocht telt niet", !letOp(trip([10, 12]), 0, [{ ms: T0 + 5 * H, gustKn: 40 }]).hardWind);
// koers 0 (noord), stroom mee (noordwaarts), wind UIT het noorden 20 kn → wind tegen stroom
ok("wind tegen stroom", letOp(trip([20, 20, 20], 1, 0), 0, []).windTegenStroom);
ok("wind mee met stroom", !letOp(trip([20, 20, 20], 1, 180), 0, []).windTegenStroom);

console.log("— effectLabel —");
ok("sneller", effectLabel(-12) === "12 min sneller dan bij stilstaand water");
ok("tegen", effectLabel(9) === "stroom tegen, 9 min langer dan bij stilstaand water");
ok("gelijk", effectLabel(0) === "even snel als bij stilstaand water");

console.log("— weatherAt —");
const w = { time: ["2026-09-18T10:00", "2026-09-18T11:00"], temp: [17, 18], code: [2, 3], precip: [0, 0.4] } as unknown as WeatherSeries;
ok("uur waarin ms valt", weatherAt(w, T0 + 59 * 60000)?.temp === 17);
ok("volgend uur", weatherAt(w, T0 + H)?.precip === 0.4);
ok("buiten reeks → null", weatherAt(w, T0 + 5 * H) === null);

console.log("— stroomVerloop —");
const sv = (cur: number, kentMs: number | null, extra: Partial<SimResult> = {}) =>
  stroomVerloop({ steps: [step(T0, 10, cur)], departMs: T0, arrMs: T0 + 2 * H, kentMs, voorbijHorizon: false, ...extra } as SimResult, true);
ok("mee tot kentering", JSON.stringify(sv(1, T0 + H)) === JSON.stringify({ kind: "mee", totMs: T0 + H }));
ok("tegen hele tocht", JSON.stringify(sv(-1, null)) === JSON.stringify({ kind: "tegen", totMs: null }));
ok("kentering na aankomst telt niet", JSON.stringify(sv(1, T0 + 3 * H)) === JSON.stringify({ kind: "mee", totMs: null }));
ok("onzeker", sv(1, null, { voorbijHorizon: true }).kind === "onzeker");
ok("geen stroomdata", stroomVerloop({ steps: [] } as unknown as SimResult, false).kind === "geen");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
