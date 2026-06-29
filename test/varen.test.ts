// Vaarcondities pure-logic checks against hand-computed cases: best window,
// wind-angle buckets, and the stream projection. Same console+exit style as
// correction.test.ts (run with `npm run test:varen`).
import {
  bestWindow, twa, poBucket, streamComp, alongState, crossState, zones,
  type HourV,
} from "../lib/varen";

let fail = 0;
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
function check(name: string, ok: boolean, got?: unknown, exp?: unknown) {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}` + (ok ? "" : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`));
}

console.log("— bestWindow —");
{
  // hours 8..19; longest run of consecutive 'g' is 14,15,16,17 → [14,18]
  const v: Verdict0[] = ["g", "g", "g", "a", "r", "r", "g", "g", "g", "g", "a", "g"];
  const hours: HourV[] = v.map((x, i) => ({ h: 8 + i, v: x }));
  const bw = bestWindow(hours);
  check("longest g-run → [14,18]", JSON.stringify(bw) === "[14,18]", bw, [14, 18]);
}
{
  const hours: HourV[] = [10, 11, 12].map((h) => ({ h, v: "a" as const }));
  check("no good hours → null", bestWindow(hours) === null, bestWindow(hours), null);
}
{
  // a gap in clock hours breaks the run even if both are 'g'
  const hours: HourV[] = [{ h: 9, v: "g" }, { h: 11, v: "g" }, { h: 12, v: "g" }];
  const bw = bestWindow(hours);
  check("hour gap splits run → [11,13]", JSON.stringify(bw) === "[11,13]", bw, [11, 13]);
}

console.log("\n— twa / poBucket (wind FROM vs course) —");
check("dead upwind: from 40, course 40 → 0 → aan de wind", twa(40, 40) === 0 && poBucket(twa(40, 40)) === "aan de wind");
check("dead downwind: from 220, course 40 → 180 → voor de wind", twa(220, 40) === 180 && poBucket(twa(220, 40)) === "voor de wind");
check("beam: from 130, course 40 → 90 → halve wind", twa(130, 40) === 90 && poBucket(twa(130, 40)) === "halve wind");
check("broad: from 180, course 40 → 140 → ruime wind", twa(180, 40) === 140 && poBucket(twa(180, 40)) === "ruime wind");
check("wrap: from 10, course 350 → 20 → aan de wind", twa(10, 350) === 20 && poBucket(twa(10, 350)) === "aan de wind");

console.log("\n— streamComp (toward = where the water flows) —");
{
  const c = streamComp(2.0, 110, 110); // current straight along course
  check("along course → along=+2.0, cross≈0", approx(c.along, 2.0) && approx(c.cross, 0), c);
  check("→ along reads 'mee'", alongState(c.along) === "mee");
}
{
  const c = streamComp(1.5, 110, 290); // current dead against course
  check("against course → along=-1.5", approx(c.along, -1.5), c);
  check("→ along reads 'tegen'", alongState(c.along) === "tegen");
}
{
  const c = streamComp(1.2, 110, 20); // current 90° to starboard of course
  check("90° right → cross=+1.2, along≈0", approx(c.cross, 1.2) && approx(c.along, 0, 1e-9), c);
  check("→ cross reads 'SB'", crossState(c.cross) === "SB");
}
{
  const c = streamComp(1.2, 110, 200); // current 90° to port of course
  check("90° left → cross=-1.2", approx(c.cross, -1.2), c);
  check("→ cross reads 'BB'", crossState(c.cross) === "BB");
}
check("weak component → 'slap'", alongState(0.1) === "slap" && crossState(-0.15) === "slap");

console.log("\n— zones (run-length on the hour axis) —");
{
  const items = [
    { h: 10, key: "mee", val: 1.0 }, { h: 11, key: "mee", val: 1.8 },
    { h: 12, key: "slap", val: 0.1 }, { h: 13, key: "tegen", val: 0.9 },
  ];
  const z = zones(items);
  check("3 zones, mee peak 1.8 over [10,12)",
    z.length === 3 && z[0].a === 10 && z[0].b === 12 && approx(z[0].peak, 1.8) && z[2].key === "tegen", z);
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");

// local alias so the literal verdict array above stays readable
type Verdict0 = "g" | "a" | "r";
