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

// Map tab: per calibrated station, direction/speed aligned to a shared time base.
export type MapStation = {
  location_key: string; name: string; area: string; lat: number; lon: number;
  dir: number[]; spd: number[];   // aligned to MapData.times (gaps forward-filled)
};
export type MapData = { times: string[]; stations: MapStation[] };

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
