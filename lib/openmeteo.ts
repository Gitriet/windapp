// Live forecast from the REGULAR Open-Meteo forecast API (not Previous Runs,
// which was only for the retrospective analysis). Knots, UTC, 3-day horizon.
import { WEEK_MODEL } from "./constants";
import type { RawSeries, WeekDay } from "./types";

const BASE = "https://api.open-meteo.com/v1/forecast";

export async function fetchModel(
  lat: number, lon: number, modelId: string, withWeather = false,
): Promise<RawSeries> {
  // Weather variables ride along on the SAME request (same model, timezone and
  // forecast_days) so they share the wind hourly grid exactly — no second fetch
  // with deviating timing. Requested only for the designated weather model.
  const hourly = ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"];
  if (withWeather) hourly.push(
    "weather_code", "temperature_2m", "cloud_cover", "precipitation", "precipitation_probability", "visibility",
  );
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: hourly.join(","),
    models: modelId,
    wind_speed_unit: "kn",
    timezone: "UTC",
    // forecast_days counts CALENDAR days from today 00:00 UTC, so 3 only reaches
    // ~48h when "now" is late in the day. Fetch 4 to guarantee a full 72h ahead;
    // the series is capped to 72h downstream so the three leads stay equal-length.
    forecast_days: "4",
  });
  if (withWeather) params.set("daily", "sunrise,sunset");
  const res = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${modelId}: HTTP ${res.status}`);
  const j = await res.json();
  const h = j.hourly ?? {};
  const out: RawSeries = {
    time: h.time ?? [],
    speed: h.wind_speed_10m ?? [],
    dir: h.wind_direction_10m ?? [],
    gust: h.wind_gusts_10m ?? [],
  };
  if (withWeather) {
    const d = j.daily ?? {};
    out.weather_code = h.weather_code ?? [];
    out.temp = h.temperature_2m ?? [];
    out.cloud = h.cloud_cover ?? [];
    out.precip = h.precipitation ?? [];
    out.pop = h.precipitation_probability ?? [];
    out.vis = h.visibility ?? [];
    out.sunrise = d.sunrise ?? [];
    out.sunset = d.sunset ?? [];
  }
  return out;
}

// 7-day daily outlook for the 7-day tab. timezone=Europe/Amsterdam so the daily
// aggregates land on NL-local calendar days. Daily has no wind minimum, so it's
// derived from the hourly wind grouped by local day.
export async function fetchWeek(lat: number, lon: number): Promise<WeekDay[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "weather_code,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant," +
      "precipitation_probability_max,temperature_2m_max,temperature_2m_min",
    hourly: "wind_speed_10m",
    models: WEEK_MODEL,
    wind_speed_unit: "kn",
    timezone: "Europe/Amsterdam",
    forecast_days: "7",
  });
  const res = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${WEEK_MODEL}: HTTP ${res.status}`);
  const j = await res.json();
  const d = j.daily ?? {}, h = j.hourly ?? {};

  // min + mean hourly wind per local day (daily reports max but no min/mean)
  const minByDay = new Map<string, number>();
  const sumByDay = new Map<string, { sum: number; n: number }>();
  const ht: string[] = h.time ?? [], hw: number[] = h.wind_speed_10m ?? [];
  for (let i = 0; i < ht.length; i++) {
    const day = ht[i].slice(0, 10), v = hw[i];
    if (v == null) continue;
    const cur = minByDay.get(day);
    if (cur == null || v < cur) minByDay.set(day, v);
    const acc = sumByDay.get(day) ?? { sum: 0, n: 0 };
    acc.sum += v; acc.n += 1; sumByDay.set(day, acc);
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const dates: string[] = d.time ?? [];
  return dates.map((date, i) => ({
    date,
    code: d.weather_code?.[i] ?? null,
    gust: d.wind_gusts_10m_max?.[i] ?? null,
    speedMax: d.wind_speed_10m_max?.[i] ?? null,
    dir: d.wind_direction_10m_dominant?.[i] ?? null,
    pop: d.precipitation_probability_max?.[i] ?? null,
    tmax: d.temperature_2m_max?.[i] ?? null,
    tmin: d.temperature_2m_min?.[i] ?? null,
    windMin: minByDay.has(date) ? r1(minByDay.get(date)!) : null,
    windMean: sumByDay.has(date) ? r1(sumByDay.get(date)!.sum / sumByDay.get(date)!.n) : null,
  }));
}
