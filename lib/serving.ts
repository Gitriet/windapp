// Serving layer: read artifacts from Neon, fetch live forecasts (TTL-cached),
// apply the speed-bias correction, and build the corrected series + model-spread
// band for single points. v1: best single corrected model, no blend,
// no direction correction.
import { sql } from "./db";
import { fetchModel, fetchWeek } from "./openmeteo";
import { CORE_MODEL_IDS, TTL_MINUTES, WEATHER_MODEL } from "./constants";
import { correctSpeed } from "./correction";
import { hoursToLead } from "./leads";
import { BORROWED_WIND, SYNTHETIC_LOCATIONS, UNCORRECTED_WIND } from "./borrowed";
import type {
  BiasModel, Location, RawSeries, CorrectedPoint, WeatherSeries, WeekDay,
} from "./types";

type WeatherCell = {
  code: number | null; temp: number | null; cloud: number | null;
  precip: number | null; pop: number | null; vis: number | null; pressure: number | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const HORIZON_HOURS = 72;   // 3 equal-length leads (day1/2/3); cap the 4-day fetch

export async function getLocations(): Promise<Location[]> {
  const rows = (await sql`SELECT location_key, name, station, area, lat, lon
                          FROM locations ORDER BY name`) as Location[];
  // append borrowed-wind points (not in the DB), then sort by name for the picker
  const have = new Set(rows.map((r) => r.location_key));
  const extra = Object.values(SYNTHETIC_LOCATIONS).filter((l) => !have.has(l.location_key));
  return [...rows, ...extra].sort((a, b) => a.name.localeCompare(b.name, "nl"));
}

async function getLocation(key: string): Promise<Location | undefined> {
  if (SYNTHETIC_LOCATIONS[key]) return SYNTHETIC_LOCATIONS[key];
  const r = (await sql`SELECT location_key, name, station, area, lat, lon
                       FROM locations WHERE location_key = ${key}`) as Location[];
  return r[0];
}

type LoadedLocation = {
  loc: Location;
  serving: Map<number, { model_id: string; model_label: string }>;
  bias: Map<string, BiasModel>;                 // key `${model_id}|${lead}`
  rawMaps: Map<string, Map<string, { speed: number; dir: number; gust: number }>>;
  times: string[];
  weather: Map<string, WeatherCell>;            // by iso, from the weather model
  weatherTimes: string[];                       // the weather model's own (longer) grid
  sunrise: string[];
  sunset: string[];
};

function toTimeMap(s: RawSeries) {
  const m = new Map<string, { speed: number; dir: number; gust: number }>();
  for (let i = 0; i < s.time.length; i++) {
    m.set(s.time[i], { speed: s.speed[i], dir: s.dir[i], gust: s.gust[i] });
  }
  return m;
}

async function ensureRaw(loc: Location, modelId: string, withWeather = false): Promise<RawSeries> {
  // Synthetic points aren't in the `locations` table, and forecast_cache has a FK
  // to it — so we can't cache under their key. Fetch them live every visit. (Texel
  // never reaches here with its own key: it reuses the donor's real, cached row.)
  const synthetic = !!SYNTHETIC_LOCATIONS[loc.location_key];
  if (!synthetic) {
    const rows = (await sql`
      SELECT payload, fetched_at FROM forecast_cache
      WHERE location_key = ${loc.location_key} AND model_id = ${modelId}`) as
      { payload: RawSeries; fetched_at: string }[];
    if (rows.length) {
      const ageMin = (Date.now() - Date.parse(rows[0].fetched_at)) / 60000;
      // require pressure too, so payloads cached before pressure was added refetch
      const hasWeather = !withWeather ||
        (rows[0].payload.weather_code != null && rows[0].payload.pressure != null);
      if (ageMin < TTL_MINUTES && hasWeather) return rows[0].payload;
    }
  }
  const raw = await fetchModel(loc.lat, loc.lon, modelId, withWeather);
  if (!synthetic) {
    await sql`
      INSERT INTO forecast_cache (location_key, model_id, payload, fetched_at)
      VALUES (${loc.location_key}, ${modelId}, ${JSON.stringify(raw)}, now())
      ON CONFLICT (location_key, model_id)
      DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`;
  }
  return raw;
}

async function loadLocation(key: string): Promise<LoadedLocation | null> {
  // borrowed-wind point: reuse the donor's serving/bias/forecast/weather verbatim
  // (its calibrated wind), keeping only this point's own identity for display + the
  // tide coupling. The donor's fetch caches under the donor key, so no duplication.
  const borrowed = BORROWED_WIND[key];
  if (borrowed) {
    const donor = await loadLocation(borrowed.donor);
    if (!donor || !SYNTHETIC_LOCATIONS[key]) return null;
    return { ...donor, loc: SYNTHETIC_LOCATIONS[key] };
  }

  const loc = await getLocation(key);
  if (!loc) return null;

  const sv = (await sql`SELECT lead, model_id, model_label FROM serving
                        WHERE location_key = ${key}`) as
    { lead: number; model_id: string; model_label: string }[];
  const serving = new Map(sv.map((r) => [r.lead, { model_id: r.model_id, model_label: r.model_label }]));

  // Uncorrected local-wind points have no fase-1 serving/bias rows. Serve a default
  // model per lead (HARMONIE NL near-term where it reaches ~day 1, ECMWF beyond) and
  // leave `bias` empty, so correctSpeed applies no offset (level "raw") — the wind is
  // the raw model value at this coordinate. Both model_ids are in CORE_MODEL_IDS, so
  // rawMaps already holds them.
  if (UNCORRECTED_WIND.has(key)) {
    serving.set(1, { model_id: "knmi_harmonie_arome_netherlands", model_label: "HARMONIE NL" });
    serving.set(2, { model_id: "ecmwf_ifs025", model_label: "ECMWF IFS" });
    serving.set(3, { model_id: "ecmwf_ifs025", model_label: "ECMWF IFS" });
  }

  const bs = (await sql`SELECT model_id, lead, model_json FROM bias_speed
                        WHERE location_key = ${key}`) as
    { model_id: string; lead: number; model_json: BiasModel }[];
  const bias = new Map(bs.map((r) => [`${r.model_id}|${r.lead}`, r.model_json]));

  const rawMaps = new Map<string, Map<string, { speed: number; dir: number; gust: number }>>();
  let times: string[] = [];
  for (const m of CORE_MODEL_IDS) {
    const raw = await ensureRaw(loc, m);
    rawMaps.set(m, toTimeMap(raw));
    if (raw.time.length > times.length) times = raw.time;
  }

  // weather overlay from a separate KNMI fetch on the same coordinate; Open-Meteo
  // normalises to the same hourly UTC grid, so it aligns with the wind on timestamp.
  const weatherRaw = await ensureRaw(loc, WEATHER_MODEL, true);
  const weather = new Map<string, WeatherCell>();
  for (let i = 0; i < weatherRaw.time.length; i++) {
    weather.set(weatherRaw.time[i], {
      code: weatherRaw.weather_code?.[i] ?? null,
      temp: weatherRaw.temp?.[i] ?? null,
      cloud: weatherRaw.cloud?.[i] ?? null,
      precip: weatherRaw.precip?.[i] ?? null,
      pop: weatherRaw.pop?.[i] ?? null,
      vis: weatherRaw.vis?.[i] ?? null,
      pressure: weatherRaw.pressure?.[i] ?? null,
    });
  }
  return {
    loc, serving, bias, rawMaps, times, weather, weatherTimes: weatherRaw.time,
    sunrise: weatherRaw.sunrise ?? [], sunset: weatherRaw.sunset ?? [],
  };
}

// Corrected served-model value + model-spread band at one timestamp.
function pointAt(L: LoadedLocation, iso: string, lead: number): CorrectedPoint | null {
  const served = L.serving.get(lead);
  if (!served) return null;
  const sv = L.rawMaps.get(served.model_id)?.get(iso);
  if (!sv || sv.speed == null) return null;

  const c = correctSpeed(L.bias.get(`${served.model_id}|${lead}`) ?? null, sv.speed, sv.dir, iso);
  const band: number[] = [];
  for (const m of CORE_MODEL_IDS) {
    const r = L.rawMaps.get(m)?.get(iso);
    if (!r || r.speed == null || r.dir == null) continue;
    band.push(correctSpeed(L.bias.get(`${m}|${lead}`) ?? null, r.speed, r.dir, iso).speed);
  }
  return {
    time: iso,
    lead: lead as 1 | 2 | 3,
    model_id: served.model_id,
    model_label: served.model_label,
    speed_kn: round1(c.speed),
    dir_deg: Math.round(sv.dir),
    gust_kn: round1(sv.gust),
    band_low_kn: round1(Math.min(...band)),
    band_high_kn: round1(Math.max(...band)),
    corrected: c.level !== "raw",
  };
}

export async function buildSeries(
  key: string,
): Promise<{ location: Location; points: CorrectedPoint[]; weather: WeatherSeries } | null> {
  const L = await loadLocation(key);
  if (!L) return null;
  const now = Date.now();
  // wind points across the full fetched range. Up to 72h the three leads apply as
  // usual; past 72h there is no dedicated lead, so the furthest (lead 3) model +
  // correction carries on, flagged `beyond` so the UI can mark it less certain.
  const points: CorrectedPoint[] = [];
  for (const iso of L.times) {
    const hoursAhead = (Date.parse(iso + "Z") - now) / 3600000;
    if (hoursAhead < -1) continue;                 // drop already-past hours
    const lead = hoursToLead(Math.max(0, hoursAhead));
    const p = pointAt(L, iso, lead);
    if (!p) continue;
    if (hoursAhead > HORIZON_HOURS) p.beyond = true;
    points.push(p);
  }
  // weather overlay: a separate display layer on its OWN horizon (the full 4-day
  // fetch), so future days still show sky/temp past the 72h wind cap. Positioned
  // on the shared time axis by timestamp, so it need not match points 1:1.
  const w: WeatherSeries = {
    time: [], code: [], temp: [], cloud: [], precip: [], pop: [], vis: [], pressure: [],
    sunrise: L.sunrise, sunset: L.sunset,
  };
  for (const iso of L.weatherTimes) {
    const hoursAhead = (Date.parse(iso + "Z") - now) / 3600000;
    if (hoursAhead < -1) continue;
    const c = L.weather.get(iso);
    w.time.push(iso);
    w.code.push(c?.code ?? null); w.temp.push(c?.temp ?? null); w.cloud.push(c?.cloud ?? null);
    w.precip.push(c?.precip ?? null); w.pop.push(c?.pop ?? null); w.vis.push(c?.vis ?? null);
    w.pressure.push(c?.pressure ?? null);
  }
  return { location: L.loc, points, weather: w };
}

// 7-day outlook for one location. Daily aggregates only, uncorrected — a separate
// layer from buildSeries. Fetched live (no DB cache); one request per visit.
export async function buildWeek(
  key: string,
): Promise<{ location: Location; days: WeekDay[] } | null> {
  const loc = await getLocation(key);
  if (!loc) return null;
  const days = await fetchWeek(loc.lat, loc.lon);
  return { location: loc, days };
}
