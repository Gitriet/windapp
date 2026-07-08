// Pure speed-bias correction engine — mirrors the Python analysis exactly so the
// live app reproduces the offline correction. The cell is chosen from the
// FORECAST values (the only thing known live); this is the unavoidable
// approximation noted in the analysis (the fit keyed cells the same way).
import type { BiasModel } from "./types";

const WIND_BANDS = [0, 8, 16, 22, 999];
const BAND_LABELS = ["0-8", "8-16", "16-22", "22-999"];
const MONTH_SEASON: Record<number, string> = {
  12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM",
  6: "JJA", 7: "JJA", 8: "JJA", 9: "SON", 10: "SON", 11: "SON",
};

export function seasonFromIso(iso: string): string {
  // iso is UTC "YYYY-MM-DDTHH:MM"; read the month directly to avoid tz drift.
  return MONTH_SEASON[parseInt(iso.slice(5, 7), 10)];
}

export function dirSector(dirDeg: number): number {
  const d = ((dirDeg % 360) + 360) % 360;
  return Math.floor((d + 22.5) / 45) % 8;
}

export function speedBand(speedKn: number): string {
  for (let i = 0; i < BAND_LABELS.length; i++) {
    if (speedKn < WIND_BANDS[i + 1]) return BAND_LABELS[i];
  }
  return BAND_LABELS[BAND_LABELS.length - 1];
}

// Finest populated cell -> { offset, level }. "raw" => no correction available.
export function lookupOffset(model: BiasModel, sector: number, season: string, band: string) {
  const full = model.full[`${sector}|${season}|${band}`];
  if (full) return { offset: full[0], level: "full" };
  const sb = model.season_band[`${season}|${band}`];
  if (sb) return { offset: sb[0], level: "season_band" };
  const bd = model.band[band];
  if (bd) return { offset: bd[0], level: "band" };
  if (model.global && model.global[1] > 0) return { offset: model.global[0], level: "global" };
  return { offset: 0, level: "raw" };
}

// Corrected speed = forecast speed minus the learned signed bias (fc - obs).
export function correctSpeed(
  model: BiasModel | null,
  fcSpeedKn: number,
  fcDirDeg: number,
  iso: string,
): { speed: number; level: string } {
  if (model == null || fcSpeedKn == null || fcDirDeg == null) {
    return { speed: fcSpeedKn, level: "raw" };
  }
  const { offset, level } = lookupOffset(
    model, dirSector(fcDirDeg), seasonFromIso(iso), speedBand(fcSpeedKn),
  );
  return { speed: Math.max(0, fcSpeedKn - offset), level };
}

// Corrected gust = forecast gust minus the learned gust bias (fc_gust - obs_gust).
// The gust model uses the SAME forecast-side strata as the speed model (cell keyed
// on fc dir sector, season, fc-speed band), so lookupOffset is reused verbatim.
// A gust can never fall below the (corrected) mean wind, so the result is floored
// at floorKn. Without a gust model the raw forecast gust passes through unchanged.
export function correctGust(
  model: BiasModel | null,
  fcGustKn: number,
  fcDirDeg: number,
  fcSpeedKn: number,
  iso: string,
  floorKn = 0,
): { gust: number; level: string } {
  if (fcGustKn == null) return { gust: fcGustKn, level: "raw" };
  // Apply the learned bias only when a gust model + cell inputs are present; a
  // served model without a fitted gust table (e.g. ECMWF, no training gusts)
  // keeps the raw forecast gust. Either way the gust is floored at the mean wind.
  let offset = 0, level = "raw";
  if (model != null && fcDirDeg != null && fcSpeedKn != null) {
    ({ offset, level } = lookupOffset(
      model, dirSector(fcDirDeg), seasonFromIso(iso), speedBand(fcSpeedKn),
    ));
  }
  return { gust: Math.max(fcGustKn - offset, floorKn, 0), level };
}
