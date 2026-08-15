export type Location = {
  location_key: string;
  name: string;
  station: string;
  area: string;
  lat: number;
  lon: number;
};

// A fitted speed-bias model, exactly as produced by the Python analysis.
export type BiasModel = {
  min_cell: number;
  full: Record<string, [number, number]>;        // "sector|season|band" -> [offset_kn, n]
  season_band: Record<string, [number, number]>; // "season|band" -> [offset, n]
  band: Record<string, [number, number]>;        // "band" -> [offset, n]
  global: [number, number];                       // [offset, n]
};

export type RawSeries = {
  time: string[];   // ISO UTC
  speed: number[];  // knots
  dir: number[];    // degrees
  gust: number[];   // knots
  // weather overlay — only present for the designated weather model
  // (knmi_seamless), requested with withWeather; shares the same hourly UTC grid.
  weather_code?: (number | null)[];
  temp?: (number | null)[];       // °C
  cloud?: (number | null)[];      // %
  precip?: (number | null)[];     // mm
  pop?: (number | null)[];        // % probability of precipitation
  vis?: (number | null)[];        // metres
  pressure?: (number | null)[];   // hPa, mean sea level
  sunrise?: string[];             // ISO UTC, one per day
  sunset?: string[];
};

// Weather overlay aligned 1:1 with the forecast points (same time[] as the wind).
// A separate display layer beside the wind — no in-situ calibration.
export type WeatherSeries = {
  time: string[];                 // identical to the wind points' times
  code: (number | null)[];
  temp: (number | null)[];
  cloud: (number | null)[];
  precip: (number | null)[];
  pop: (number | null)[];
  vis: (number | null)[];
  pressure: (number | null)[];    // hPa, mean sea level
  wave: (number | null)[];        // significante golfhoogte, m (Open-Meteo Marine API)
  sunrise: string[];
  sunset: string[];
};

// 7-day outlook (separate tab): daily aggregates straight from Open-Meteo daily,
// NL-local days, uncorrected — NOT the per-station bias pipeline.
export type WeekDay = {
  date: string;              // local date "YYYY-MM-DD" (Europe/Amsterdam)
  code: number | null;       // weather_code
  pop: number | null;        // precipitation_probability_max, %
  dir: number | null;        // wind_direction_10m_dominant (source bearing)
  speedMax: number | null;   // wind_speed_10m_max, kn — headline + bar marker
  gust: number | null;       // wind_gusts_10m_max, kn — the day's "piek" (bar high end)
  windMin: number | null;    // min hourly wind_speed_10m over the local day, kn (bar low)
  windMean: number | null;   // mean hourly wind_speed_10m over the local day, kn (bar mean tick)
  tmax: number | null;       // °C
  tmin: number | null;       // °C
};

export type CorrectedPoint = {
  time: string;
  lead: 1 | 2 | 3;
  model_id: string;
  model_label: string;
  speed_kn: number;        // corrected served-model speed
  dir_deg: number;         // raw (v1 applies no direction correction)
  gust_kn: number;
  band_low_kn: number;     // model-spread band (corrected models)
  band_high_kn: number;
  corrected: boolean;
  beyond?: boolean;        // past the 72h corrected horizon — shown, but less certain
};

// Model current layer (spoor 1: operationele voorspelling), straight from the
// stroom-ingestielaag. MODEL, niet gekalibreerd -> model_unvalidated is altijd
// true en moet tot in de UI meereizen. u/v in m/s exact zoals geleverd; een droge/
// ontbrekende cel is NaN in de opslag en wordt hier als null geserialiseerd (nooit 0).
// Geen conversie server-side: knopen/magnitude/weergave doet de frontend.
export type StroomGrid = {
  nx: number;
  ny: number;
  lat: number[];                            // degrees_north, lengte ny
  lon: number[];                            // degrees_east, lengte nx
  bbox: [number, number, number, number];   // [lonMin, latMin, lonMax, latMax]
};
export type StroomSlice = {
  valid_time: string;                       // UTC ISO
  analysis_time: string;                    // UTC ISO — herkomst-run (latest-wins per valid_time)
  u: (number | null)[];                     // m/s, row-major ny*nx, null = droog/ontbrekend
  v: (number | null)[];
};
export type StroomData = {
  box: string;
  source: string;
  units: "m/s";
  model_unvalidated: true;
  analysis_time: string | null;             // nieuwste run die het venster dekt; null als leeg
  grid: StroomGrid;
  times: StroomSlice[];                      // [] = venster buiten de horizon (expliciet leeg)
};

// Tide layer (Wad stations only): water level vs NAP in cm, straight from RWS.
// A separate data layer beside the wind — no correction, no model blend.
export type TidePoint = { t: string; v: number };           // t = UTC ISO, v = cm NAP
export type TideExtreme = { kind: "HW" | "LW"; t: string; v: number };
export type TideData = {
  code: string;            // RWS getij location code
  name: string;            // human label for the getij point
  expected: TidePoint[];   // verwachting (incl. wind setup), ~48h horizon
  astro: TidePoint[];      // astronomical, full window
  extremes: TideExtreme[]; // HW/LW from the expected curve, astro beyond its reach
  // resilience flags when RWS is partly/fully unreachable
  unavailable?: boolean;     // tide station, but no data at all (RWS down, no cache)
  expectedMissing?: boolean; // verwachting (windopzet) failed; only astronomical shown
  astroStale?: boolean;      // astronomical served from cache, not live
};
