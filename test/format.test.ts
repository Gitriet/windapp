// Tijdblok-formatter (lib/format.ts) en advies-titel (lib/tocht.ts).
import { aankomstLabel, tijdblok } from "../lib/format";
import { adviesTitel } from "../lib/tocht";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const t = (iso: string) => Date.parse(iso);

console.log("— tijdblok —");
ok("zelfde dag", tijdblok(t("2026-09-19T12:30:00Z"), t("2026-09-19T13:19:00Z")) === "14:30 → 15:19");
ok("over middernacht (lokaal)", tijdblok(t("2026-09-19T20:30:00Z"), t("2026-09-19T22:05:00Z")) === "22:30 → ZO 00:05",
  tijdblok(t("2026-09-19T20:30:00Z"), t("2026-09-19T22:05:00Z")));
ok("UTC-dag gelijk, lokale dag niet → dag tonen", aankomstLabel(t("2026-09-19T21:00:00Z"), t("2026-09-19T22:30:00Z")) === "ZO 00:30");
ok("UTC-dag anders, lokale dag gelijk → geen dag", aankomstLabel(t("2026-09-18T23:00:00Z"), t("2026-09-19T01:00:00Z")) === "03:00");
ok("geen aankomst", tijdblok(t("2026-09-19T12:30:00Z"), null) === "14:30 → —");
ok("wintertijd (CET)", tijdblok(t("2026-12-05T22:30:00Z"), t("2026-12-05T23:10:00Z")) === "23:30 → ZO 00:10",
  tijdblok(t("2026-12-05T22:30:00Z"), t("2026-12-05T23:10:00Z")));

console.log("— adviesTitel —");
const dep = t("2026-09-19T12:30:00Z");
ok("GA NU zonder LET OP", adviesTitel("ga-nu", dep, false) === "GA NU");
ok("GA NU met LET OP → BESTE VERTREK", adviesTitel("ga-nu", dep, true) === "BESTE VERTREK 14:30");
ok("VERTREK blijft VERTREK", adviesTitel("vertrek", dep, true) === "VERTREK 14:30");
ok("GEEN VENSTER", adviesTitel("geen-venster", null, false) === "GEEN VENSTER");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
