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

export type WaypointForecast = {
  order: number;
  location_key: string;
  name: string;
  passage_iso: string;
  hours_ahead: number;
  lead: 1 | 2 | 3;
  point: CorrectedPoint | null;   // null = no forecast at that time (out of horizon)
};
