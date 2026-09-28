// dagVenster / dagWind (lib/dagweer.ts): uurvenster en windsamenvatting per gekozen dag.
import { dagVenster, dagWind } from "../lib/dagweer";
import type { CorrectedPoint } from "../lib/types";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
// uurreeks vanaf ma 28 sep 06:00 UTC (08:00 lokaal) t/m +50 uur; snelheid = uurindex
const T0 = Date.UTC(2026, 8, 28, 6);
const pts = Array.from({ length: 50 }, (_, i) => ({
  time: new Date(T0 + i * 3_600_000).toISOString().slice(0, 16), speed_kn: i, gust_kn: i + 5, dir_deg: 0,
})) as unknown as CorrectedPoint[];

const nu = dagVenster(pts, "2026-09-28", "2026-09-28");
ok("vandaag: vanaf nu, 13 uur", nu.length === 13 && nu[0] === pts[0]);
const di = dagVenster(pts, "2026-09-29", "2026-09-28");
ok("morgen: vanaf 09:00 lokaal (07:00 UTC)", di[0]?.time === "2026-09-29T07:00", di[0]?.time);
ok("buiten de reeks: leeg", dagVenster(pts, "2026-10-02", "2026-09-28").length === 0);
const w = dagWind(pts, "2026-09-28");
ok("vandaag: resterende uren tot middernacht lokaal", w?.min === 0 && w?.max === 15 && w?.gust === 20, JSON.stringify(w));
ok("geen uren: null", dagWind(pts, "2026-10-05") === null);

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
