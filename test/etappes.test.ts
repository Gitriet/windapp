// etappes() (lib/tocht.ts): stroom per segment per leg, kentering-positie, wind + vlaag
// per leg uit de eigen stations.
import { etappes, type EtappeLeg } from "../lib/tocht";
import type { SimResult, SimStep } from "../lib/tripsim";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const H = 3_600_000, T0 = Date.UTC(2026, 8, 18, 10, 0);
// 2 legs: 4 nm + 2 nm; stap per 0,5 nm (6 min). Leg 1: mee, kentering op 3 nm → tegen.
const steps: SimStep[] = Array.from({ length: 13 }, (_, i) => ({
  tMs: T0 + i * 6 * 60000, prog: i * 0.5, stw: 5, sog: 5, cur: i * 0.5 < 3 ? 1 : -0.5, twa: 90,
  wSpd: i * 0.5 < 4 ? 14 : 18, wDir: 315,
}));
const trip = { steps: [...steps, { ...steps[12], prog: 6 }], departMs: T0, arrMs: T0 + 80 * 60000 } as SimResult;
const legs: EtappeLeg[] = [
  { label: "A → B", distNm: 4, vanKey: "a", naarKey: "b", stroom: true },
  { label: "B → C", distNm: 2, vanKey: "b", naarKey: "c", stroom: false },
];
const [l1, l2] = etappes(trip, legs, [
  { ms: T0, gustKn: 19, key: "a" }, { ms: T0 + H, gustKn: 25, key: "c" }, { ms: T0, gustKn: 40, key: "x" },
]);
ok("leg 1: 4 segmenten (1 per nm, min 3)", l1.segmenten.length === 4, String(l1.segmenten.length));
ok("leg 1: eerst mee, laatste segment tegen", l1.segmenten[0] > 0 && l1.segmenten[3] < 0, l1.segmenten.join(","));
ok("leg 1: kentering op 3/4", l1.kenteringFrac === 0.75, String(l1.kenteringFrac));
ok("leg 1: wind NW 14", Math.round(l1.windDir!) === 315 && l1.windKn === 14);
ok("leg 1: vlaag alleen eigen stations", l1.vlaagKn === 19, String(l1.vlaagKn));
ok("leg 2 zonder stroomdata: geen segmenten, geen kentering", l2.segmenten.length === 0 && l2.kenteringFrac === null);
ok("leg 2: vlaag van station c binnen de tijd", l2.vlaagKn === 25, String(l2.vlaagKn));

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
