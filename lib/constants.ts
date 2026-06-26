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

// The weather overlay (icon/temp/precip/cloud/visibility/sun) is sourced from the
// KNMI HARMONIE 2 km model (seamless: HARMONIE near-term, ECMWF beyond ~3.3 days),
// far finer than the global band models over this Dutch coastal water. It is NOT
// one of the band models, so it gets its own fetch on the same coordinate; Open-
// Meteo normalises to the same hourly UTC grid, so it aligns on timestamp.
// (precipitation/cloud/weather_code/visibility are native 2 km; precipitation_
// probability is filled by the seamless ECMWF side, HARMONIE has none.)
export const WEATHER_MODEL = "knmi_seamless";

// The 7-day outlook uses Open-Meteo's seamless best_match: high-res near-term,
// falling back to a global model past ~3 days — exactly the transition the tab's
// "verder vooruit · globaal model · minder zeker" divider communicates. It is
// uncorrected (no per-station bias), and best_match guarantees every daily field
// is populated.
export const WEEK_MODEL = "best_match";

// Punt deterministic recap + warning thresholds — central config, never hardcoded
// in the components. veer* = degrees of veering/backing before we call it a turn.
export const RECAP = { edgeHours: 8, veerDay: 15, veer3d: 20 };
export const WARN = {
  hardWind: { amberKn: 22, amberGust: 28, redKn: 28, redGust: 34 },
  // wind-against-current needs verified per-location current direction (stroomatlas
  // / RWS). Until that exists it stays OFF so we never render a wrong warning;
  // flip enabled (or gate per location) once real current data is wired in.
  windVsCurrent: { enabled: false, angleDeg: 135, minBft: 4, minHours: 2 },
};
