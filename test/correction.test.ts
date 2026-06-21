// Proves the TS correction engine reproduces the Python analysis exactly:
// loads a real fitted bias table + a golden file of (dir, speed, time) inputs
// with Python-computed corrected speeds, and checks the TS output matches.
import { readFileSync } from "node:fs";
import { correctSpeed } from "../lib/correction";
import { haversineKm, hoursToLead, routePassages } from "../lib/leads";
import type { BiasModel } from "../lib/types";

const root = new URL("../../outputs/", import.meta.url);
const golden = JSON.parse(readFileSync(new URL("correction_golden.json", root), "utf8"));
const model = JSON.parse(
  readFileSync(new URL(`artifacts/${golden.bias_file}`, root), "utf8"),
) as BiasModel;

let fail = 0;
console.log("— correction engine vs Python golden —");
for (const s of golden.samples) {
  const got = correctSpeed(model, s.speed, s.dir, s.iso).speed;
  const ok = Math.abs(got - s.expected_corrected) < 1e-5;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} dir=${s.dir} spd=${s.speed} ${s.iso} [${s.level}] ` +
    `got=${got.toFixed(4)} exp=${s.expected_corrected}`);
}

console.log("\n— geometry / lead sanity —");
const d = haversineKm(52.463, 4.555, 53.218, 3.220);
console.log(`IJmuiden->K13-A ≈ ${d.toFixed(0)} km (expect ~120)`);
const leadOk = hoursToLead(10) === 1 && hoursToLead(30) === 2 && hoursToLead(60) === 3;
console.log(`hoursToLead 10/30/60 -> ${hoursToLead(10)}/${hoursToLead(30)}/${hoursToLead(60)} ${leadOk ? "ok" : "FAIL"}`);
const p = routePassages([{ lat: 52.928, lon: 4.781 }, { lat: 53.218, lon: 3.220 }], 0, 6);
const travelH = (p[1] - p[0]) / 3600000;
console.log(`DeKooy->K13-A at 6 kn ≈ ${travelH.toFixed(1)} h`);

if (fail || !leadOk || d < 100 || d > 140) {
  console.error(`\nFAILED (${fail} correction mismatches)`);
  process.exit(1);
}
console.log("\nALL OK");
