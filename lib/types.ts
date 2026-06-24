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
  gust: number | null;       // wind_gusts_10m_max, kn
  windMin: number | null;    // min hourly wind_speed_10m over the local day, kn
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
};
