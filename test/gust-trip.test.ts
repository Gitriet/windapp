// gustsOnTrip() (lib/tocht.ts): vlagen per positie en tijd, geen maximum over alle stations.
import { gustsOnTrip, etappes, letOp, windPerUur, type EtappeLeg } from "../lib/tocht";
import type { SimResult, SimStep } from "../lib/tripsim";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const H = 3_600_000, T0 = Date.UTC(2026, 9, 22, 13, 0);
// 10 nm in 2 uur, 5 kn; wind 10 kn (laag, ruim onder de drempel)
const steps: SimStep[] = Array.from({ length: 5 }, (_, i) => ({
  tMs: T0 + i * 0.5 * H, prog: i * 2.5, stw: 5, sog: 5, cur: 0, twa: 90, wSpd: 10, wDir: 250, course: 200,
}));
const trip = { steps: [...steps, { ...steps[4], prog: 10 }], departMs: T0, arrMs: T0 + 2 * H } as SimResult;
const uur = (key: string, g: number[]) => g.map((gustKn, i) => ({ ms: T0 + i * H, gustKn, key }));
// A (0 nm): 20 kn; B (10 nm): 40 kn, constant in de tijd
const gusts = [...uur("a", [20, 20, 20]), ...uur("b", [40, 40, 40])];
const stations = [{ key: "a", nm: 0 }, { key: "b", nm: 10 }];

const g = gustsOnTrip(trip, stations, gusts);
ok("één sample per stap (zonder eindpunt)", g.length === 5, String(g.length));
ok("bij vertrek: de vlaag van station A", Math.round(g[0].gustKn) === 20, String(g[0].gustKn));
ok("halverwege: gemiddelde van A en B", Math.round(g[2].gustKn) === 30, String(g[2].gustKn));
ok("vlaag van B telt niet mee zolang je bij A bent", g[0].gustKn < 25);
ok("alleen de eindstap bereikt B", g.slice(0, 4).every((x) => x.gustKn < 40) && Math.round(g[4].gustKn) === 40);

// tijd: station A neemt toe van 20 naar 30 in het eerste uur
const g2 = gustsOnTrip(trip, stations, [...uur("a", [20, 30, 30]), ...uur("b", [40, 40, 40])]);
ok("interpolatie in de tijd", Math.abs(g2[1].gustKn - (25 * 0.75 + 40 * 0.25)) < 0.01, String(g2[1].gustKn));
ok("zonder gustdata: leeg", gustsOnTrip(trip, stations, []).length === 0);

// letOp: zonder positiegebonden vlagen zou 40 kn hier "harde wind" geven; nu blijft het bij ≤ ~35 kn
ok("letOp: eindstation-vlaag van 40 kn alleen op het eind", letOp(trip, 200, g).hardWind === true);
const lage = gustsOnTrip(trip, stations, [...uur("a", [10, 10, 10]), ...uur("b", [40, 40, 40])]);
ok("letOp: vlaag 40 bij B niet gevlagd bij 10 kn bij A halverwege", Math.max(...lage.slice(0, 2).map((x) => x.gustKn)) < 28);

// etappes: vlagen per leg op positie
const legs: EtappeLeg[] = [{ label: "A → B", distNm: 10, keys: ["a", "b"], stroom: false }];
const [e] = etappes(trip, legs, g);
ok("etappe-vlag = max van de positiegebonden samples", e.vlaagKn != null && Math.round(e.vlaagKn) === Math.round(Math.max(...g.filter((x) => x.prog! < 10).map((x) => x.gustKn))), String(e.vlaagKn));

// windPerUur: één punt per klokuur, gemiddelde wind en hardste vlaag langs de boot
const wu = windPerUur(trip, g);
ok("windPerUur: uren 13:00, 14:00 en 15:00", wu.length === 3 && wu[0].time === "2026-10-22T13:00" && wu[2].time === "2026-10-22T15:00", wu.map((x) => x.time).join(","));
ok("windPerUur: gemiddelde wind en hardste vlaag per uur", Math.round(wu[0].speed_kn) === 10 && wu[0].gust_kn > 20 && wu[2].gust_kn > wu[1].gust_kn && wu[1].gust_kn > wu[0].gust_kn, JSON.stringify(wu.map((x) => Math.round(x.gust_kn))));

if (fail) process.exit(1);
