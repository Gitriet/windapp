// Fase 5: export naar de plotter. Bewijst dat het bestand leesbaar is, de waarden
// uit boatSpeed komen, alles gevuld en oplopend is, en performance meeschuift.
import { toPlr, plrFilename, boatSpeed, PLR_ANGLES, TWS_COLS, DEFAULT_BOAT, type BoatProfile } from "../lib/polar";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const B: BoatProfile = { ...DEFAULT_BOAT, performance: 0.85 };
const text = toPlr(B);
const rows = text.trimEnd().split("\n").map((r) => r.split("\t"));

console.log("— vorm —");
ok("eerste cel leeg", rows[0][0] === "");
ok("bovenste rij = windsnelheden", rows[0].slice(1).join(",") === TWS_COLS.join(","), rows[0].join("|"));
ok("aantal regels = hoeken + kop", rows.length === PLR_ANGLES.length + 1, `${rows.length}`);
ok("eerste kolom = hoeken", rows.slice(1).map((r) => Number(r[0])).join(",") === PLR_ANGLES.join(","));

console.log("\n— hoeken en windsnelheden lopen op —");
ok("hoeken oplopend", PLR_ANGLES.every((a, i) => i === 0 || a > PLR_ANGLES[i - 1]));
ok("windsnelheden oplopend", TWS_COLS.every((w, i) => i === 0 || w > TWS_COLS[i - 1]));

console.log("\n— alle cellen gevuld en gelijk aan boatSpeed —");
{
  let bad = 0, empty = 0;
  PLR_ANGLES.forEach((twa, ri) => {
    TWS_COLS.forEach((tws, ci) => {
      const cell = rows[ri + 1][ci + 1];
      if (cell === undefined || cell === "" || Number.isNaN(Number(cell))) empty++;
      else if (Math.abs(Number(cell) - boatSpeed(B, twa, tws)) > 0.005) bad++;
    });
  });
  ok("geen lege cellen", empty === 0, `${empty} leeg`);
  ok("waarden = boatSpeed", bad === 0, `${bad} afwijkend`);
}

console.log("\n— performance schuift mee, en zit in de bestandsnaam —");
{
  const low = toPlr({ ...B, performance: 0.7 }).trimEnd().split("\n").map((r) => r.split("\t"));
  const a = Number(rows[7][3]), b = Number(low[7][3]);
  ok("lagere performance = lagere waarden", b < a, `${b} < ${a}`);
  ok("verhouding klopt met 0.70/0.85", Math.abs(b / a - 0.7 / 0.85) < 0.01, `${(b / a).toFixed(4)}`);
  ok("bestandsnaam draagt archetype + performance",
    plrFilename(B) === "polar-cruiser-racer-p85.plr", plrFilename(B));
  ok("bestandsnaam volgt performance", plrFilename({ ...B, performance: 0.7 }) === "polar-cruiser-racer-p70.plr");
}

console.log("\n— voorbeeld (eerste 4 regels) —");
console.log(text.split("\n").slice(0, 4).map((l) => "     " + l.replace(/\t/g, "  ")).join("\n"));

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
