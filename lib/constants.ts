// The seven core models (full-period archive). AIFS is excluded from the live
// app (subperiod only, no gusts) — it never feeds serving or the spread band.
export const CORE_MODEL_IDS = [
  "ecmwf_ifs025",
  "gfs_global",
  "icon_global",
  "icon_eu",
  "icon_d2",
  "ukmo_global_deterministic_10km",
  "knmi_harmonie_arome_netherlands",
];

export const TTL_MINUTES = Number(process.env.FORECAST_TTL_MINUTES || 60);
