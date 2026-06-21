// Live smoke test of the fetch -> correct -> band pipeline (no DB): pulls live
// Open-Meteo for IJmuiden, applies the day1 bias tables, prints raw vs corrected
// + the model-spread band. Run: npx tsx scripts/smoke.ts
import { readFileSync } from "node:fs";
import { fetchModel } from "../lib/openmeteo";
import { correctSpeed } from "../lib/correction";
import { CORE_MODEL_IDS } from "../lib/constants";
import type { BiasModel, RawSeries } from "../lib/types";

const OUT = new URL("../../outputs/", import.meta.url);
const lat = 52.463, lon = 4.555, station = "IJmuiden", served = "icon_eu"; // day1 serving

const bias: Record<string, BiasModel | null> = {};
for (const m of CORE_MODEL_IDS) {
  try {
    bias[m] = JSON.parse(readFileSync(new URL(`artifacts/bias_${station}_${m}_day1.json`, OUT), "utf8"));
  } catch { bias[m] = null; }
}

async function main() {
  const raws: Record<string, RawSeries> = {};
  for (const m of CORE_MODEL_IDS) raws[m] = await fetchModel(lat, lon, m);

  const sv = raws[served];
  console.log(`IJmuiden — served day1 model: ${served} (gecorrigeerd) — first 8 hours\n`);
  console.log("time              raw   corr   band(corr)        dir");
  for (let i = 0; i < 8; i++) {
    const iso = sv.time[i];
    const corr = correctSpeed(bias[served], sv.speed[i], sv.dir[i], iso).speed;
    const band: number[] = [];
    for (const m of CORE_MODEL_IDS) {
      const r = raws[m]; const idx = r.time.indexOf(iso);
      if (idx >= 0) band.push(correctSpeed(bias[m], r.speed[idx], r.dir[idx], iso).speed);
    }
    console.log(
      `${iso}  ${sv.speed[i].toFixed(1).padStart(4)}  ${corr.toFixed(1).padStart(4)}   ` +
      `[${Math.min(...band).toFixed(1)}, ${Math.max(...band).toFixed(1)}]`.padEnd(16) +
      `  ${sv.dir[i].toFixed(0)}°`,
    );
  }
}
main();
