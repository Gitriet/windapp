// Stap 2a: zicht-classificatie, geëxtraheerd uit app/nu/page.tsx naar lib/weather.ts.
// Bewijst dat de labels op de grenzen 10 km (goed) en 4 km (matig) omslaan.
import { classifyVisibility, VIS_GOOD_KM, VIS_FAIR_KM } from "../lib/weather";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("— grenzen 10 km (goed) en 4 km (matig) —");
ok("grenzen zijn 10 en 4 km", VIS_GOOD_KM === 10 && VIS_FAIR_KM === 4);
ok("12 km -> goed", classifyVisibility(12000) === "goed");
ok("exact 10 km -> goed", classifyVisibility(10000) === "goed");
ok("net onder 10 km -> matig", classifyVisibility(9999) === "matig");
ok("exact 4 km -> matig", classifyVisibility(4000) === "matig");
ok("net onder 4 km -> slecht", classifyVisibility(3999) === "slecht");
ok("0 m -> slecht", classifyVisibility(0) === "slecht");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
