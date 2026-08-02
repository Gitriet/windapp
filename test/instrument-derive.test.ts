// Stap 2c: nearest-hour + worst-case-aggregatie + spreiding-over-horizon,
// geëxtraheerd uit app/vensters, app/kaart en LocationDetailSheet naar lib/instrument.ts.
import { worstCaseWind, nearestIndex, horizonSpread, WORST_CASE_TOL_MS } from "../lib/instrument";
import type { CorrectedPoint } from "../lib/types";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const T0 = Date.parse("2026-08-02T12:00:00Z");
const H = 3600_000;
const iso = (h: number) => new Date(T0 + h * H).toISOString();
function mk(hAfter: number, speed: number, gust: number, dir: number, bl = 0, bh = 0): CorrectedPoint {
  return {
    time: iso(hAfter), lead: 1, model_id: "m", model_label: "M",
    speed_kn: speed, dir_deg: dir, gust_kn: gust, band_low_kn: bl, band_high_kn: bh, corrected: true,
  };
}

console.log("— worstCaseWind: zwaarste wind (met richting) + zwaarste vlaag —");
{
  const A = [mk(0, 12, 15, 200)];
  const B = [mk(0, 14, 18, 250)];
  const w = worstCaseWind([A, B], T0);
  ok("tolerantie = 90 min", WORST_CASE_TOL_MS === 90 * 60000);
  ok("max wind 14", w.windKn === 14, `${w.windKn}`);
  ok("richting van de max-wind (250)", w.dir === 250, `${w.dir}`);
  ok("max vlaag 18", w.gustKn === 18, `${w.gustKn}`);
  ok("any = true", w.any === true);
  // een reeks waarvan het dichtstbijzijnde punt > 90 min weg ligt telt niet mee
  const far = [mk(2, 30, 40, 100)];   // 2 u van T0
  ok("buiten tolerantie -> any false", worstCaseWind([far], T0).any === false);
}

console.log("\n— nearestIndex —");
{
  ok("dichtstbij 0 -> index 0", nearestIndex([0, 100, 250], 40) === 0);
  ok("dichtstbij 100 -> index 1", nearestIndex([0, 100, 250], 90) === 1);
  ok("gelijkspel pakt de eerste", nearestIndex([0, 100], 50) === 0);
}

console.log("\n— horizonSpread: grootste bandbreedte voorbij de horizon —");
{
  const pts = [mk(10, 10, 12, 100, 8, 10), mk(22, 10, 12, 100, 9, 14), mk(40, 10, 12, 100, 8, 11)];
  // banden (band_high − band_low): 10u->2, 22u->5, 40u->3
  ok("vanaf 20 u -> 5 (max van 22u en 40u)", horizonSpread(pts, T0, 20) === 5, `${horizonSpread(pts, T0, 20)}`);
  ok("vanaf 0 u -> 5 (nog steeds de 22u-piek)", horizonSpread(pts, T0, 0) === 5);
  ok("voorbij alles -> 0", horizonSpread(pts, T0, 48) === 0);
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
