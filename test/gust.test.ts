// Verifieert de vlaag-kalibratie (correctGust): de geleerde bias wordt van de
// modelvlaag afgetrokken, de vlaag zakt nooit onder de (gecorrigeerde) gemiddelde
// wind (floor), en zonder vlaagmodel blijft de ruwe vlaag staan — óók dan gefloord.
// Draai met: npx tsx test/gust.test.ts
import { correctGust } from "../lib/correction";
import type { BiasModel } from "../lib/types";

// Model met alleen een globale bias (fc - obs). +3 = model overschat de vlaag met 3 kn.
const g3: BiasModel = { min_cell: 30, full: {}, season_band: {}, band: {}, global: [3, 500] };
const ISO = "2026-07-08T14:00";   // zomer (JJA), maakt niet uit: alleen global gevuld

let fail = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const check = (label: string, ok: boolean) => { if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${label}`); };

console.log("— vlaag-kalibratie —");

// 1. bias afgetrokken: fcGust 20 - bias 3 = 17 (floor laag)
check("bias afgetrokken (20 - 3 = 17)", near(correctGust(g3, 20, 270, 12, ISO, 5).gust, 17));

// 2. floor: gecorrigeerde vlaag (20-3=17) mag niet onder de wind (18) -> 18
check("vlaag >= gemiddelde wind (floor 18)", near(correctGust(g3, 20, 270, 12, ISO, 18).gust, 18));

// 3. negatieve bias verhoogt de vlaag (model onderschat): 15 - (-2) = 17
const gm2: BiasModel = { min_cell: 30, full: {}, season_band: {}, band: {}, global: [-2, 500] };
check("negatieve bias verhoogt (15 + 2 = 17)", near(correctGust(gm2, 15, 270, 10, ISO, 5).gust, 17));

// 4. geen vlaagmodel -> ruwe vlaag, maar wel gefloord
check("geen model: ruwe vlaag blijft (15)", near(correctGust(null, 15, 270, 10, ISO, 5).gust, 15));
check("geen model: toch gefloord op wind (12)", near(correctGust(null, 8, 270, 12, ISO, 12).gust, 12));

// 5. ontbrekende vlaag -> null (niets te tonen)
check("ontbrekende vlaag -> null", correctGust(g3, null as unknown as number, 270, 10, ISO, 5).gust == null);

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
