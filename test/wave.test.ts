// Verifieert Deel A (getijgolf-looprichting): de afgeleide richting klopt met het
// HW-tijdsverschil (eerder HW = bovenstrooms), en alleen getijstations met HW-extremen
// doen mee. Draai met: npx tsx test/wave.test.ts
import { buildWavePairs, type WaveStation } from "../lib/wave";
import type { TideExtreme } from "../lib/types";

// Twee HW's per station, ~12u25 uit elkaar (semidiurnaal), met een bekende
// verschuiving tussen de stations.
function station(key: string, name: string, hwOffsetMin: number): WaveStation {
  const base = Date.parse("2026-07-07T02:00:00Z");
  const off = hwOffsetMin * 60000;
  const mk = (t: number, kind: "HW" | "LW"): TideExtreme => ({ kind, t: new Date(t).toISOString(), v: kind === "HW" ? 90 : -60 });
  const extremes: TideExtreme[] = [
    mk(base + off, "HW"),
    mk(base + off + 6.2 * 3600000, "LW"),
    mk(base + off + 12.42 * 3600000, "HW"),
  ];
  return { key, name, extremes };
}

let fail = 0;
const check = (label: string, ok: boolean) => { if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${label}`); };

console.log("— getijgolf-looprichting —");

// A heeft HW 40 min eerder dan B => golf loopt A -> B, A bovenstrooms, verschil ~40 min.
const pairsAB = buildWavePairs([station("a", "A", 0), station("b", "B", 40)]);
check("één paar afgeleid", pairsAB.length === 1);
check("eerder HW (A) is bovenstrooms", pairsAB[0].upstream === "a" && pairsAB[0].downstream === "b");
check("looprichting = A -> B", pairsAB[0].upstreamName === "A" && pairsAB[0].downstreamName === "B");
check("verschil ~40 min", Math.abs(pairsAB[0].lagMinutes - 40) <= 1);

// Omgekeerd: als B eerder HW heeft, is B bovenstrooms — ongeacht paar-volgorde.
const pairsBA = buildWavePairs([station("a", "A", 55), station("b", "B", 0)]);
check("later HW (A) is benedenstrooms", pairsBA[0].upstream === "b" && pairsBA[0].downstream === "a");
check("verschil ~55 min", Math.abs(pairsBA[0].lagMinutes - 55) <= 1);

// Drie stations -> 3 paren.
const three = buildWavePairs([station("a", "A", 0), station("b", "B", 30), station("c", "C", 70)]);
check("3 stations -> 3 paren", three.length === 3);

// Stations zonder HW-extremen vallen weg (alleen getijstations doen mee).
const noHw: WaveStation = { key: "x", name: "X", extremes: [] };
const withEmpty = buildWavePairs([station("a", "A", 0), noHw]);
check("station zonder getij valt weg", withEmpty.length === 0);

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
