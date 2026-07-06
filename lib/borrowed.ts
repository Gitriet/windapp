// Synthetic locations: getij points that are NOT in the Neon `locations` table.
// Client-safe (no DB import) so both the serving layer and the client page read it.
// Two flavours, both driven by SYNTHETIC_LOCATIONS below:
//
//  1. Borrowed wind (BORROWED_WIND) — a point with no calibrated series of its own,
//     shown with the wind of the nearest calibrated station, labelled as borrowed.
//
//  2. Uncorrected local wind (UNCORRECTED_WIND) — a point with no calibrated station,
//     shown with the raw global-model wind on its OWN coordinate (no fase-1 bias
//     correction), labelled "ongecorrigeerd".
//
// Both are EMPTY right now: every getij point that once lived here has graduated to a
// real calibrated station in the Neon `locations` table since the KNMI EDR migration
// exposed its validated hourly series — Texel (Texelhors) from flavour 1, and
// Vlissingen + Hoek van Holland from flavour 2. The mechanisms are kept as seams for
// any future point that has a tide but no calibratable wind station of its own.
import type { Location } from "./types";

export const BORROWED_WIND: Record<string, { donor: string; donorName: string }> = {};

// Synthetic points served with uncorrected local wind (see flavour 2 above). The
// serving layer gives these a default served model per lead with no bias table, so
// the wind is the raw model value at the point's coordinate.
export const UNCORRECTED_WIND = new Set<string>();

// Identity for a synthetic point (not in the Neon `locations` table).
export const SYNTHETIC_LOCATIONS: Record<string, Location> = {};
