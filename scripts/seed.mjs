// Seed Neon from the fase-1 artifacts. Idempotent (upserts). Run once and on
// each re-calibration. Loads: locations, serving (best single corrected model
// per lead), and the speed-bias tables. Direction tables are NOT loaded (v1).
import { readFileSync, readdirSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = globalThis.WebSocket; // Node 24 global WS

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (see .env.example)."); process.exit(1); }

const OUT = new URL("../../outputs/", import.meta.url);
const ART = new URL("artifacts/", OUT);
const readCsv = (name) => {
  const lines = readFileSync(new URL(name, OUT), "utf8").trim().split("\n");
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
};

const pool = new Pool({ connectionString: url });
const q = (text, params) => pool.query(text, params);

try {
  // schema — run as one multi-statement query (don't split on ';': SQL comments
  // may contain semicolons, which would break a naive split).
  const schema = readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8");
  await q(schema);

  // locations
  const locs = readCsv("app_locations.csv");
  const stationToKey = {};
  for (const l of locs) {
    stationToKey[l.station] = l.location_key;
    await q(
      `INSERT INTO locations (location_key,name,station,area,lat,lon)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (location_key) DO UPDATE SET
         name=EXCLUDED.name, station=EXCLUDED.station, area=EXCLUDED.area,
         lat=EXCLUDED.lat, lon=EXCLUDED.lon`,
      [l.location_key, l.name, l.station, l.area, Number(l.lat), Number(l.lon)],
    );
  }

  // serving
  const serv = readCsv("app_serving.csv");
  for (const s of serv) {
    await q(
      `INSERT INTO serving (location_key,lead,model_id,model_label)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (location_key,lead) DO UPDATE SET
         model_id=EXCLUDED.model_id, model_label=EXCLUDED.model_label`,
      [s.location_key, Number(s.lead), s.model_id, s.model_label],
    );
  }

  // speed-bias tables (skip AIFS; v1 uses core models only)
  let nBias = 0;
  for (const file of readdirSync(ART).filter((f) => f.startsWith("bias_") && f.endsWith(".json"))) {
    const base = file.slice("bias_".length, -".json".length);  // <station>_<model>_day<lead>
    const parts = base.split("_");
    const station = parts[0];
    const lead = Number(parts[parts.length - 1].replace("day", ""));
    const model = parts.slice(1, -1).join("_");
    const key = stationToKey[station];
    if (!key || model === "ecmwf_aifs025_single") continue;
    const json = readFileSync(new URL(file, ART), "utf8");
    await q(
      `INSERT INTO bias_speed (location_key,model_id,lead,model_json)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (location_key,model_id,lead) DO UPDATE SET model_json=EXCLUDED.model_json`,
      [key, model, lead, json],
    );
    nBias++;
  }

  console.log(`Seeded ${locs.length} locations, ${serv.length} serving rows, ${nBias} bias tables.`);
} catch (e) {
  console.error("Seed failed:", e);
  process.exit(1);
} finally {
  await pool.end();
}
