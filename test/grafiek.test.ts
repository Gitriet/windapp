import { gladReeks, rasterWaarden } from "../lib/grafiek";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const H = 3_600_000;

console.log("— gladReeks —");
const sprong = Array.from({ length: 13 }, (_, i) => ({ ms: i * 10 * 60_000, v: i < 6 ? 2 : 8 }));   // sprong van 2 naar 8
const g = gladReeks(sprong, 0, 2 * H);
ok("begin en eind op van en tot", g[0].ms === 0 && g[g.length - 1].ms === 2 * H);
ok("sprong wordt een helling", g.some((p) => p.v > 2.5 && p.v < 7.5));
ok("niet buiten het bereik van de data", g.every((p) => p.v >= 2 - 1e-9 && p.v <= 8 + 1e-9));
ok("constante reeks blijft constant", gladReeks([{ ms: 0, v: 5 }, { ms: H, v: 5 }], 0, H).every((p) => p.v === 5));
ok("lege reeks → leeg", gladReeks([], 0, H).length === 0);

console.log("— rasterWaarden —");
ok("snelheid 7,6 kn → 2,4,6,8", rasterWaarden(0, 7.6, 4).waarden.join() === "8,6,4,2", rasterWaarden(0, 7.6, 4).waarden.join());
ok("wind 25 kn → 10,20,30", rasterWaarden(0, 25, 4).waarden.join() === "30,20,10", rasterWaarden(0, 25, 4).waarden.join());
const st = rasterWaarden(-0.7, 1.0, 2);
ok("stroom ±1 kn → ±0,5 en ±1", st.waarden.join() === "1,0.5,-0.5,-1", st.waarden.join());
ok("top afgerond op de stap", rasterWaarden(0, 7.6, 4).top === 8);
ok("alleen positief: geen negatieve lijnen", rasterWaarden(0, 3, 4).waarden.every((v) => v > 0));

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
