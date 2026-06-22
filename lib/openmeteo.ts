// Live forecast from the REGULAR Open-Meteo forecast API (not Previous Runs,
// which was only for the retrospective analysis). Knots, UTC, 3-day horizon.
import type { RawSeries } from "./types";

const BASE = "https://api.open-meteo.com/v1/forecast";

export async function fetchModel(lat: number, lon: number, modelId: string): Promise<RawSeries> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    models: modelId,
    wind_speed_unit: "kn",
    timezone: "UTC",
    // forecast_days counts CALENDAR days from today 00:00 UTC, so 3 only reaches
    // ~48h when "now" is late in the day. Fetch 4 to guarantee a full 72h ahead;
    // the series is capped to 72h downstream so the three leads stay equal-length.
    forecast_days: "4",
  });
  const res = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${modelId}: HTTP ${res.status}`);
  const j = await res.json();
  const h = j.hourly ?? {};
  return {
    time: h.time ?? [],
    speed: h.wind_speed_10m ?? [],
    dir: h.wind_direction_10m ?? [],
    gust: h.wind_gusts_10m ?? [],
  };
}
