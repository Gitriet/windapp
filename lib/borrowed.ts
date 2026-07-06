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
// Flavour 1 (BORROWED_WIND) is empty: every point that once borrowed a neighbour's
// wind (Texel/Texelhors) has graduated to its own calibrated station in the Neon
// `locations` table since the KNMI EDR migration. Flavour 2 (UNCORRECTED_WIND) holds
// Harlingen — a Wadden getij point with an RWS tide but NO calibratable KNMI/EDR wind
// station of its own (nearest are Leeuwarden ~24 km inland and Hoorn Terschelling),
// so its wind is the raw local model, labelled "ongecorrigeerd". (Vlissingen + Hoek
// van Holland previously lived here too but graduated to calibrated stations.)
import type { Location } from "./types";

export const BORROWED_WIND: Record<string, { donor: string; donorName: string }> = {};

// Synthetic points served with uncorrected local wind (see flavour 2 above). The
// serving layer gives these a default served model per lead with no bias table, so
// the wind is the raw model value at the point's coordinate.
export const UNCORRECTED_WIND = new Set(["harlingen"]);

// Identity for a synthetic point (not in the Neon `locations` table). Coordinate = the
// Harlingen harbour (its RWS getij point sits at the same spot), so wind/weather and
// tide overlay on one location. station "" — no backing KNMI station; area groups it
// under the Waddenzee block in the picker.
export const SYNTHETIC_LOCATIONS: Record<string, Location> = {
  harlingen: {
    location_key: "harlingen",
    name: "Harlingen",
    station: "",
    area: "Waddenzee (Harlingen)",
    lat: 53.175,
    lon: 5.409,
  },
};
